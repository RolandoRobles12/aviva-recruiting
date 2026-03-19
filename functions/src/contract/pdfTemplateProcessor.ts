/**
 * PDF Template Processor
 *
 * Handles:
 * 1. Analyzing uploaded PDF templates to detect signature fields
 * 2. Detecting initials and signature areas via AcroForm fields and text patterns
 * 3. Overlaying variables, initials, and signatures onto PDF templates
 * 4. Generating the final signed contract from a PDF template
 */

import { PDFDocument, PDFName, PDFDict, PDFArray, rgb, StandardFonts, PDFPage } from 'pdf-lib';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PdfFieldPosition {
  id: string;
  type: 'signature' | 'initials' | 'date' | 'text';
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  required: boolean;
}

export interface PdfVariableMapping {
  variableName: string;
  pageIndex: number;
  x: number;
  y: number;
  fontSize: number;
  fontWeight?: 'normal' | 'bold';
}

export interface PdfAnalysisResult {
  pageCount: number;
  pageDimensions: Array<{ width: number; height: number }>;
  detectedFields: PdfFieldPosition[];
  hasAcroForm: boolean;
  fileSize: number;
}

export interface PdfContractInput {
  /** The original PDF template bytes */
  templatePdfBytes: Buffer;
  /** Candidate's full name */
  candidateName: string;
  /** Candidate's initials (e.g. "JGR") */
  candidateInitials: string;
  /** Position/job title */
  position: string;
  /** Signature as base64 PNG */
  signatureBase64: string;
  /** Initials signature as base64 PNG (optional — falls back to text initials) */
  initialsBase64?: string;
  /** When the document was signed */
  signedAt: Date;
  /** Signer's IP */
  signerIp: string;
  /** Signer's user-agent */
  signerUserAgent: string;
  /** Variable values for interpolation */
  variables: Record<string, string>;
  /** Where to place signatures/initials */
  signatureFields: PdfFieldPosition[];
  /** Where to overlay variable text */
  variableMappings?: PdfVariableMapping[];
  /** Place initials on every page */
  initialsOnEveryPage: boolean;
  /** Default initials position (used when initialsOnEveryPage is true) */
  initialsPosition?: { x: number; y: number; width: number; height: number };
  /** Employer (apoderado legal) signature as base64 PNG */
  employerSignatureBase64?: string;
  /** Employer name */
  employerName?: string;
  /** Employer title */
  employerTitle?: string;
}

export interface SigningEvidence {
  documentHashBefore: string;
  documentHashAfter: string;
  signatureHash: string;
  signedAt: string;
  signerIp: string;
  signerUserAgent: string;
  evidenceId: string;
}

// ─── PDF Analysis ───────────────────────────────────────────────────────────

/**
 * Analyze a PDF template to detect:
 * - Number of pages and dimensions
 * - AcroForm fields (especially signature fields)
 * - Annotation-based signature widgets
 * - Common text patterns that indicate signature areas
 */
export async function analyzePdfTemplate(pdfBytes: Buffer): Promise<PdfAnalysisResult> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  const pageDimensions = pages.map((page) => ({
    width: page.getWidth(),
    height: page.getHeight(),
  }));

  const detectedFields: PdfFieldPosition[] = [];
  let fieldCounter = 0;

  // ── 1) Detect AcroForm fields ──────────────────────────────────────────
  let hasAcroForm = false;
  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    hasAcroForm = fields.length > 0;

    for (const field of fields) {
      const fieldName = field.getName().toLowerCase();
      const widgets = field.acroField.getWidgets();

      for (const widget of widgets) {
        const rect = widget.getRectangle();
        // Find which page this widget belongs to
        const pageRef = widget.P();
        let pageIndex = 0;
        if (pageRef) {
          const pageRefs = pdfDoc.getPages().map((p) => p.ref);
          pageIndex = pageRefs.findIndex((ref) => ref === pageRef);
          if (pageIndex < 0) pageIndex = 0;
        }

        // Determine field type from name
        let fieldType: PdfFieldPosition['type'] = 'text';
        if (fieldName.includes('firma') || fieldName.includes('signature') || fieldName.includes('sign')) {
          fieldType = 'signature';
        } else if (fieldName.includes('inicial') || fieldName.includes('rubrica') || fieldName.includes('initial')) {
          fieldType = 'initials';
        } else if (fieldName.includes('fecha') || fieldName.includes('date')) {
          fieldType = 'date';
        }

        detectedFields.push({
          id: `acro_${fieldCounter++}`,
          type: fieldType,
          pageIndex,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          label: field.getName(),
          required: field.isRequired(),
        });
      }
    }
  } catch {
    // No AcroForm or error parsing — that's fine
  }

  // ── 2) Detect signature/initials annotations on each page ──────────────
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const annotsRaw = page.node.lookup(PDFName.of('Annots'));
    if (!annotsRaw || !(annotsRaw instanceof PDFArray)) continue;
    const annots = annotsRaw;

    for (let i = 0; i < annots.size(); i++) {
      try {
        const annotRaw = annots.lookup(i);
        if (!annotRaw || !(annotRaw instanceof PDFDict)) continue;
        const annotRef = annotRaw;

        const subtype = annotRef.lookup(PDFName.of('Subtype'));
        if (!subtype) continue;

        const subtypeStr = subtype.toString();
        // Widget annotations that are signature-type
        if (subtypeStr === '/Widget' || subtypeStr === '/Sig') {
          const rect = annotRef.lookup(PDFName.of('Rect'), PDFArray);
          if (!rect || rect.size() < 4) continue;

          const x = Number(rect.lookup(0)) || 0;
          const y = Number(rect.lookup(1)) || 0;
          const x2 = Number(rect.lookup(2)) || x + 200;
          const y2 = Number(rect.lookup(3)) || y + 50;

          // Check if already found via AcroForm
          const isDuplicate = detectedFields.some(
            (f) => f.pageIndex === pageIdx && Math.abs(f.x - x) < 5 && Math.abs(f.y - y) < 5
          );
          if (isDuplicate) continue;

          const ft = annotRef.lookup(PDFName.of('FT'));
          const ftStr = ft ? ft.toString() : '';

          let fieldType: PdfFieldPosition['type'] = 'text';
          if (ftStr === '/Sig' || subtypeStr === '/Sig') {
            fieldType = 'signature';
          }

          detectedFields.push({
            id: `annot_${fieldCounter++}`,
            type: fieldType,
            pageIndex: pageIdx,
            x,
            y,
            width: x2 - x,
            height: y2 - y,
            label: `Annotation ${pageIdx + 1}-${i}`,
            required: true,
          });
        }
      } catch {
        // Skip malformed annotations
      }
    }
  }

  // ── 3) Heuristic: if no signature fields found, suggest likely positions ─
  if (!detectedFields.some((f) => f.type === 'signature')) {
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    // Common signature position: bottom third of last page, left-aligned
    detectedFields.push({
      id: `suggested_sig_${fieldCounter++}`,
      type: 'signature',
      pageIndex: pages.length - 1,
      x: 56,
      y: height * 0.15,
      width: 200,
      height: 60,
      label: 'Firma del Trabajador (sugerido)',
      required: true,
    });

    // Employer signature on the right
    detectedFields.push({
      id: `suggested_sig_${fieldCounter++}`,
      type: 'signature',
      pageIndex: pages.length - 1,
      x: width / 2 + 20,
      y: height * 0.15,
      width: 200,
      height: 60,
      label: 'Firma del Patrón (sugerido)',
      required: false,
    });
  }

  // ── 4) Suggest initials position on each page if none found ────────────
  if (!detectedFields.some((f) => f.type === 'initials')) {
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const { width } = pages[pageIdx].getSize();
      detectedFields.push({
        id: `suggested_init_${fieldCounter++}`,
        type: 'initials',
        pageIndex: pageIdx,
        x: width - 100,
        y: 40,
        width: 50,
        height: 25,
        label: `Iniciales pág. ${pageIdx + 1}`,
        required: true,
      });
    }
  }

  return {
    pageCount: pages.length,
    pageDimensions,
    detectedFields,
    hasAcroForm,
    fileSize: pdfBytes.length,
  };
}

// ─── PDF Contract Generation ────────────────────────────────────────────────

/**
 * Generate a signed contract from a PDF template.
 * Overlays: variable text, candidate signature, initials on every page,
 * and cryptographic evidence watermark.
 */
export async function generatePdfContract(
  input: PdfContractInput
): Promise<{ pdfBuffer: Buffer; evidence: SigningEvidence }> {
  const evidenceId = crypto.randomUUID();

  // Hash template content before modifications
  const documentHashBefore = crypto
    .createHash('sha256')
    .update(input.templatePdfBytes)
    .digest('hex');

  // Hash the signature image
  const sigBase64 = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const signatureHash = crypto
    .createHash('sha256')
    .update(sigBase64)
    .digest('hex');

  // Load the PDF template
  const pdfDoc = await PDFDocument.load(input.templatePdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  // Embed fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Embed the signature image
  const sigImageBytes = Buffer.from(sigBase64, 'base64');
  const sigImage = await pdfDoc.embedPng(sigImageBytes);

  // Embed initials image if provided
  let initialsImage: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
  if (input.initialsBase64) {
    const initBase64 = input.initialsBase64.replace(/^data:image\/png;base64,/, '');
    const initImageBytes = Buffer.from(initBase64, 'base64');
    initialsImage = await pdfDoc.embedPng(initImageBytes);
  }

  const gray = rgb(0.42, 0.447, 0.502);
  const dark = rgb(0.216, 0.255, 0.318);

  // ── 1) Overlay variable text ─────────────────────────────────────────────
  if (input.variableMappings) {
    for (const mapping of input.variableMappings) {
      const value = input.variables[mapping.variableName] ?? '';
      if (!value) continue;
      const pageIndex = Math.min(mapping.pageIndex, pages.length - 1);
      const page = pages[pageIndex];
      const font = mapping.fontWeight === 'bold' ? fontBold : fontRegular;

      page.drawText(value, {
        x: mapping.x,
        y: mapping.y,
        size: mapping.fontSize || 10,
        font,
        color: dark,
      });
    }
  }

  // ── 2) Place signatures ──────────────────────────────────────────────────
  const sigFields = input.signatureFields.filter((f) => f.type === 'signature');
  for (const field of sigFields) {
    const pageIndex = Math.min(field.pageIndex, pages.length - 1);
    const page = pages[pageIndex];

    // Scale signature to fit the field
    const sigDims = sigImage.scale(
      Math.min(field.width / sigImage.width, field.height / sigImage.height, 0.5)
    );

    page.drawImage(sigImage, {
      x: field.x,
      y: field.y + (field.height - sigDims.height) / 2,
      width: sigDims.width,
      height: sigDims.height,
    });

    // Draw a line under the signature
    page.drawLine({
      start: { x: field.x, y: field.y },
      end: { x: field.x + field.width, y: field.y },
      thickness: 0.5,
      color: dark,
    });

    // Label
    const label = field.label || 'Firma del Trabajador';
    page.drawText(label, {
      x: field.x,
      y: field.y - 12,
      size: 8,
      font: fontRegular,
      color: gray,
    });
  }

  // ── 2b) Place employer signature on fields labelled "Patrón" or second sig field ─
  if (input.employerSignatureBase64) {
    const empBase64 = input.employerSignatureBase64.replace(/^data:image\/png;base64,/, '');
    const empImageBytes = Buffer.from(empBase64, 'base64');
    const empImage = await pdfDoc.embedPng(empImageBytes);

    // Find employer-specific signature fields, or use second signature field on last page
    const employerFields = sigFields.filter((f) =>
      f.label?.toLowerCase().includes('patrón') ||
      f.label?.toLowerCase().includes('patron') ||
      f.label?.toLowerCase().includes('empresa') ||
      f.label?.toLowerCase().includes('employer')
    );

    // If no explicit employer field, use the second signature field (if any)
    const fieldsToUse = employerFields.length > 0
      ? employerFields
      : sigFields.length > 1 ? [sigFields[1]] : [];

    for (const field of fieldsToUse) {
      const pageIndex = Math.min(field.pageIndex, pages.length - 1);
      const page = pages[pageIndex];

      const empDims = empImage.scale(
        Math.min(field.width / empImage.width, field.height / empImage.height, 0.5)
      );

      page.drawImage(empImage, {
        x: field.x,
        y: field.y + (field.height - empDims.height) / 2,
        width: empDims.width,
        height: empDims.height,
      });

      page.drawLine({
        start: { x: field.x, y: field.y },
        end: { x: field.x + field.width, y: field.y },
        thickness: 0.5,
        color: dark,
      });

      const empName = input.employerName || 'La Empresa';
      const empTitle = input.employerTitle || 'Representante Legal';
      page.drawText(empName, { x: field.x, y: field.y - 12, size: 8, font: fontBold, color: dark });
      page.drawText(empTitle, { x: field.x, y: field.y - 22, size: 7, font: fontRegular, color: gray });
    }
  }

  // ── 3) Place initials on every page ──────────────────────────────────────
  const initialsFieldsByPage = new Map<number, PdfFieldPosition>();
  const initFields = input.signatureFields.filter((f) => f.type === 'initials');
  for (const f of initFields) {
    initialsFieldsByPage.set(f.pageIndex, f);
  }

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const { width } = page.getSize();

    // Determine position: use field position if defined, or default position
    let initX: number, initY: number, initW: number, initH: number;

    const fieldDef = initialsFieldsByPage.get(pageIdx);
    if (fieldDef) {
      initX = fieldDef.x;
      initY = fieldDef.y;
      initW = fieldDef.width;
      initH = fieldDef.height;
    } else if (input.initialsOnEveryPage && input.initialsPosition) {
      initX = input.initialsPosition.x;
      initY = input.initialsPosition.y;
      initW = input.initialsPosition.width;
      initH = input.initialsPosition.height;
    } else if (input.initialsOnEveryPage) {
      // Default: bottom-right corner
      initX = width - 100;
      initY = 40;
      initW = 50;
      initH = 25;
    } else {
      continue; // No initials on this page
    }

    if (initialsImage) {
      // Draw initials image
      const initDims = initialsImage.scale(
        Math.min(initW / initialsImage.width, initH / initialsImage.height, 0.4)
      );
      page.drawImage(initialsImage, {
        x: initX + (initW - initDims.width) / 2,
        y: initY + (initH - initDims.height) / 2,
        width: initDims.width,
        height: initDims.height,
      });
    } else {
      // Draw text initials
      const initials = input.candidateInitials;
      const initFontSize = Math.min(12, initH * 0.7);
      const textWidth = fontBold.widthOfTextAtSize(initials, initFontSize);
      page.drawText(initials, {
        x: initX + (initW - textWidth) / 2,
        y: initY + (initH - initFontSize) / 2,
        size: initFontSize,
        font: fontBold,
        color: dark,
      });
    }

    // Thin border around initials area
    drawRectOutline(page, initX, initY, initW, initH, gray, 0.3);
  }

  // ── 4) Add signing date next to signatures ───────────────────────────────
  const dateFields = input.signatureFields.filter((f) => f.type === 'date');
  const dateStr = input.signedAt.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  for (const field of dateFields) {
    const pageIndex = Math.min(field.pageIndex, pages.length - 1);
    const page = pages[pageIndex];
    page.drawText(dateStr, {
      x: field.x,
      y: field.y + field.height / 2 - 5,
      size: 9,
      font: fontRegular,
      color: dark,
    });
  }

  // ── 5) Evidence watermark on last page ────────────────────────────────────
  const lastPage = pages[pages.length - 1];
  const evidenceText = `ID: ${evidenceId} | FES SHA-256 | ${input.signedAt.toISOString()}`;
  lastPage.drawText(evidenceText, {
    x: 56,
    y: 14,
    size: 6,
    font: fontRegular,
    color: rgb(0.75, 0.75, 0.75),
  });

  // ── 6) Page numbering ────────────────────────────────────────────────────
  if (pages.length > 1) {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width } = page.getSize();
      const pageNum = `${i + 1} / ${pages.length}`;
      const numW = fontRegular.widthOfTextAtSize(pageNum, 7);
      page.drawText(pageNum, {
        x: width / 2 - numW / 2,
        y: 14,
        size: 7,
        font: fontRegular,
        color: rgb(0.7, 0.7, 0.7),
      });
    }
  }

  // ── Save and hash ────────────────────────────────────────────────────────
  // Remove AcroForm to flatten the document (prevents form editing after signing)
  try {
    pdfDoc.catalog.delete(PDFName.of('AcroForm'));
  } catch {
    // No AcroForm to remove
  }

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  const documentHashAfter = crypto
    .createHash('sha256')
    .update(pdfBuffer)
    .digest('hex');

  const evidence: SigningEvidence = {
    documentHashBefore,
    documentHashAfter,
    signatureHash,
    signedAt: input.signedAt.toISOString(),
    signerIp: input.signerIp,
    signerUserAgent: input.signerUserAgent,
    evidenceId,
  };

  return { pdfBuffer, evidence };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function drawRectOutline(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: ReturnType<typeof rgb>,
  thickness: number
) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
  page.drawLine({ start: { x: x + w, y }, end: { x: x + w, y: y + h }, thickness, color });
  page.drawLine({ start: { x: x + w, y: y + h }, end: { x, y: y + h }, thickness, color });
  page.drawLine({ start: { x, y: y + h }, end: { x, y }, thickness, color });
}

/**
 * Extract candidate initials from full name.
 * "Juan García Rodríguez" → "JGR"
 */
export function extractInitials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}
