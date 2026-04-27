import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as crypto from 'crypto';

export interface ContractPdfInput {
  candidateName: string;
  position: string;
  bodyText: string;       // plain text used for hashing / evidence
  signatureBase64: string; // data:image/png;base64,...
  /** When provided, this Puppeteer-rendered PDF is used as the base instead of
   *  generating a plain-text PDF from bodyText. The signature is overlaid on top. */
  htmlPdfBuffer?: Buffer;
  signedAt: Date;
  signerIp: string;
  signerUserAgent: string;
  /** Candidate initials text (e.g. "JGR") — placed on each page */
  candidateInitials?: string;
  /** Initials drawn as image (base64 PNG) — overrides text initials */
  initialsBase64?: string;
}

export interface SigningEvidence {
  documentHashBefore: string;  // SHA-256 of contract content before signature
  documentHashAfter: string;   // SHA-256 of signed PDF
  signatureHash: string;       // SHA-256 of signature image
  signedAt: string;            // ISO 8601 timestamp
  signerIp: string;
  signerUserAgent: string;
  evidenceId: string;          // unique ID for this signing event
}

/** Strip basic HTML tags for plain-text PDF rendering */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrapText(text: string, font: import('pdf-lib').PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Generate a signed contract PDF with the candidate's signature embedded.
 * If input.htmlPdfBuffer is provided (Puppeteer-rendered HTML), the signature
 * is overlaid on that PDF. Otherwise a plain-text PDF is built from bodyText.
 */
export async function generateContractPdf(
  input: ContractPdfInput
): Promise<{ pdfBuffer: Buffer; evidence: SigningEvidence }> {
  const evidenceId = crypto.randomUUID();

  const documentHashBefore = crypto
    .createHash('sha256')
    .update(`${input.candidateName}|${input.position}|${input.bodyText}`)
    .digest('hex');

  const sigBase64 = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const signatureHash = crypto
    .createHash('sha256')
    .update(sigBase64)
    .digest('hex');

  // ── If we have a Puppeteer-rendered HTML PDF, overlay signature on it ──────
  if (input.htmlPdfBuffer) {
    const pdfDoc = await PDFDocument.load(input.htmlPdfBuffer);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const dark = rgb(0.216, 0.255, 0.318);
    const gray = rgb(0.42, 0.447, 0.502);

    const sigImage = await pdfDoc.embedPng(Buffer.from(sigBase64, 'base64'));

    // Embed initials image if provided
    let initialsImage: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
    if (input.initialsBase64) {
      const initBase64 = input.initialsBase64.replace(/^data:image\/png;base64,/, '');
      initialsImage = await pdfDoc.embedPng(Buffer.from(initBase64, 'base64'));
    }

    const pages = pdfDoc.getPages();
    const margin = 40;

    // Place initials on every page (bottom-right)
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width } = page.getSize();
      const initX = width - margin - 50;
      const initY = 30;
      const initW = 46;
      const initH = 20;

      if (initialsImage) {
        const d = initialsImage.scale(Math.min(initW / initialsImage.width, initH / initialsImage.height, 0.4));
        page.drawImage(initialsImage, { x: initX + (initW - d.width) / 2, y: initY, width: d.width, height: d.height });
      } else if (input.candidateInitials) {
        const fs = 9;
        const tw = fontBold.widthOfTextAtSize(input.candidateInitials, fs);
        page.drawText(input.candidateInitials, { x: initX + (initW - tw) / 2, y: initY + 4, size: fs, font: fontBold, color: dark });
      }
    }

    // Place candidate signature on the LAST page (bottom area)
    const lastPage = pages[pages.length - 1];
    const { width: lw, height: lh } = lastPage.getSize();
    const sigAreaY = 80;
    const sigDims = sigImage.scale(Math.min(180 / sigImage.width, 50 / sigImage.height, 0.35));
    lastPage.drawImage(sigImage, { x: margin, y: sigAreaY + 10, width: sigDims.width, height: sigDims.height });
    lastPage.drawLine({ start: { x: margin, y: sigAreaY + 6 }, end: { x: margin + 200, y: sigAreaY + 6 }, thickness: 0.5, color: dark });
    lastPage.drawText('El Empleado – Por mi propio derecho', { x: margin, y: sigAreaY - 8, size: 8, font: fontRegular, color: gray });
    lastPage.drawText(input.candidateName, { x: margin, y: sigAreaY - 18, size: 7, font: fontBold, color: dark });

    const dateStr = input.signedAt.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    lastPage.drawText(`Firmado el ${dateStr}`, { x: lw / 2, y: sigAreaY + 20, size: 8, font: fontRegular, color: gray });
    lastPage.drawText(`ID de firma: ${evidenceId}`, { x: margin, y: sigAreaY - 28, size: 7, font: fontRegular, color: rgb(0.6, 0.6, 0.6) });

    // Suppress unused var warning — lh used implicitly via lw
    void lh;

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);
    const documentHashAfter = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    return {
      pdfBuffer,
      evidence: { documentHashBefore, documentHashAfter, signatureHash, signedAt: input.signedAt.toISOString(), signerIp: input.signerIp, signerUserAgent: input.signerUserAgent, evidenceId },
    };
  }

  // ── Fallback: plain-text PDF (PDF-based templates or legacy) ─────────────
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const pageWidth = 595;
  const pageHeight = 842;
  const contentWidth = pageWidth - margin * 2;
  const green = rgb(0.086, 0.722, 0.467);
  const dark = rgb(0.216, 0.255, 0.318);
  const gray = rgb(0.42, 0.447, 0.502);

  // Prepare body text lines
  const bodyLines = wrapText(input.bodyText, fontRegular, 10, contentWidth);

  // Calculate pages needed (leave room for signature on last page)
  const linesPerPage = 48;
  const signatureSpace = 8; // lines reserved for signature block
  const totalContentLines = bodyLines.length;
  const pages: string[][] = [];
  let lineIndex = 0;

  while (lineIndex < totalContentLines) {
    const isLastChunk = lineIndex + linesPerPage >= totalContentLines;
    const available = isLastChunk ? linesPerPage - signatureSpace : linesPerPage;
    const chunk = bodyLines.slice(lineIndex, lineIndex + available);
    pages.push(chunk);
    lineIndex += available;
  }

  if (pages.length === 0) pages.push([]);

  // Embed initials image if provided
  let initialsImage: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null;
  if (input.initialsBase64) {
    const initBase64 = input.initialsBase64.replace(/^data:image\/png;base64,/, '');
    initialsImage = await pdfDoc.embedPng(Buffer.from(initBase64, 'base64'));
  }
  const initialsText = input.candidateInitials || '';

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Header (first page only)
    if (pageIdx === 0) {
      page.drawRectangle({ x: 0, y: pageHeight - 72, width: pageWidth, height: 72, color: green });
      page.drawText('Aviva', { x: margin, y: pageHeight - 44, size: 22, font: fontBold, color: rgb(1, 1, 1) });
      page.drawText('Contrato de Trabajo', { x: margin, y: pageHeight - 62, size: 11, font: fontRegular, color: rgb(0.9, 0.98, 0.95) });

      y = pageHeight - 96;
      page.drawText(input.candidateName, { x: margin, y, size: 15, font: fontBold, color: dark });
      y -= 18;
      page.drawText(input.position, { x: margin, y, size: 11, font: fontRegular, color: gray });
      y -= 28;
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
      y -= 20;
    }

    // Body text
    for (const line of pages[pageIdx]) {
      if (y < 50) break;
      page.drawText(line, { x: margin, y, size: 10, font: fontRegular, color: dark });
      y -= 14;
    }

    // ── Initials on every page (bottom-right, above footer) ──
    const initX = pageWidth - margin - 50;
    const initY = 36;
    const initW = 46;
    const initH = 22;

    if (initialsImage) {
      const initDims = initialsImage.scale(
        Math.min(initW / initialsImage.width, initH / initialsImage.height, 0.4)
      );
      page.drawImage(initialsImage, {
        x: initX + (initW - initDims.width) / 2,
        y: initY + (initH - initDims.height) / 2,
        width: initDims.width,
        height: initDims.height,
      });
    } else if (initialsText) {
      const initFontSize = 10;
      const tw = fontBold.widthOfTextAtSize(initialsText, initFontSize);
      page.drawText(initialsText, {
        x: initX + (initW - tw) / 2,
        y: initY + (initH - initFontSize) / 2,
        size: initFontSize,
        font: fontBold,
        color: dark,
      });
    }

    // Thin border around initials area
    if (initialsImage || initialsText) {
      const borderColor = rgb(0.8, 0.82, 0.85);
      page.drawLine({ start: { x: initX, y: initY }, end: { x: initX + initW, y: initY }, thickness: 0.3, color: borderColor });
      page.drawLine({ start: { x: initX + initW, y: initY }, end: { x: initX + initW, y: initY + initH }, thickness: 0.3, color: borderColor });
      page.drawLine({ start: { x: initX + initW, y: initY + initH }, end: { x: initX, y: initY + initH }, thickness: 0.3, color: borderColor });
      page.drawLine({ start: { x: initX, y: initY + initH }, end: { x: initX, y: initY }, thickness: 0.3, color: borderColor });
    }

    // Signature block on last page
    if (pageIdx === pages.length - 1) {
      const sigAreaTop = Math.min(y - 20, 160);
      const sigW = 200;
      const col2 = margin + contentWidth / 2 + 10;

      page.drawLine({
        start: { x: margin, y: sigAreaTop + 65 },
        end: { x: pageWidth - margin, y: sigAreaTop + 65 },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.93),
      });

      // ── Company signature line (left column — image is in the HTML via {{firmaEmpresa}}) ──
      page.drawLine({
        start: { x: margin, y: sigAreaTop + 4 },
        end: { x: margin + sigW, y: sigAreaTop + 4 },
        thickness: 0.5,
        color: dark,
      });
      page.drawText('La Empresa', { x: margin, y: sigAreaTop - 10, size: 8, font: fontBold, color: dark });
      page.drawText('Salvador Hernández Díaz de León', { x: margin, y: sigAreaTop - 22, size: 7, font: fontRegular, color: gray });
      page.drawText('Representante Legal', { x: margin, y: sigAreaTop - 32, size: 7, font: fontRegular, color: gray });

      // ── Candidate signature (right column) ───────────────────────────────────
      const sigImageBytes = Buffer.from(sigBase64, 'base64');
      const sigImage = await pdfDoc.embedPng(sigImageBytes);
      const sigDims = sigImage.scale(Math.min(sigW / sigImage.width, 52 / sigImage.height, 0.35));
      page.drawImage(sigImage, {
        x: col2,
        y: sigAreaTop + 8,
        width: sigDims.width,
        height: sigDims.height,
      });
      page.drawLine({
        start: { x: col2, y: sigAreaTop + 4 },
        end: { x: col2 + sigW, y: sigAreaTop + 4 },
        thickness: 0.5,
        color: dark,
      });
      page.drawText('El Empleado', { x: col2, y: sigAreaTop - 10, size: 8, font: fontBold, color: dark });
      page.drawText(input.candidateName, { x: col2, y: sigAreaTop - 22, size: 7, font: fontRegular, color: gray });
      page.drawText('Por mi propio derecho', { x: col2, y: sigAreaTop - 32, size: 7, font: fontRegular, color: gray });

      const dateStr = input.signedAt.toLocaleDateString('es-MX', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      page.drawText(`Firmado el ${dateStr}`, { x: margin, y: sigAreaTop - 48, size: 8, font: fontRegular, color: gray });

      // Evidence ID watermark
      page.drawText(`ID de firma: ${evidenceId}`, {
        x: margin, y: sigAreaTop - 60, size: 7, font: fontRegular, color: rgb(0.7, 0.7, 0.7),
      });
    }

    // Footer on every page
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: 32, color: rgb(0.976, 0.98, 0.984) });
    page.drawText(
      `Contrato laboral con firma electrónica simple. © ${new Date().getFullYear()} Aviva`,
      { x: margin, y: 10, size: 8, font: fontRegular, color: gray }
    );

    // Page number
    if (pages.length > 1) {
      const pageNum = `${pageIdx + 1} / ${pages.length}`;
      const numWidth = fontRegular.widthOfTextAtSize(pageNum, 8);
      page.drawText(pageNum, { x: pageWidth - margin - numWidth, y: 10, size: 8, font: fontRegular, color: gray });
    }
  }

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  // Hash the final signed PDF
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

/**
 * Generate a signing evidence certificate PDF.
 * This is a separate document that proves the signing event.
 */
export async function generateEvidencePdf(
  evidence: SigningEvidence,
  candidateName: string,
  position: string,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const margin = 56;
  const dark = rgb(0.216, 0.255, 0.318);
  const gray = rgb(0.42, 0.447, 0.502);
  const blue = rgb(0.082, 0.396, 0.753);

  let y = height - margin;

  // Header
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: blue });
  page.drawText('Certificado de Firma Electrónica', {
    x: margin, y: height - 44, size: 18, font: fontBold, color: rgb(1, 1, 1),
  });
  page.drawText('Evidencia criptográfica de firmado', {
    x: margin, y: height - 62, size: 10, font: fontRegular, color: rgb(0.8, 0.87, 0.95),
  });

  y = height - 100;

  const drawField = (label: string, value: string) => {
    page.drawText(label, { x: margin, y, size: 9, font: fontBold, color: gray });
    y -= 16;
    page.drawText(value, { x: margin, y, size: 10, font: fontMono, color: dark });
    y -= 22;
  };

  page.drawText('Datos del firmante', { x: margin, y, size: 13, font: fontBold, color: dark });
  y -= 24;

  drawField('Nombre completo', candidateName);
  drawField('Puesto', position);
  drawField('Fecha y hora de firma (UTC)', evidence.signedAt);
  drawField('Dirección IP', evidence.signerIp);
  drawField('Dispositivo', evidence.signerUserAgent.substring(0, 80));

  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  y -= 24;

  page.drawText('Evidencia criptográfica', { x: margin, y, size: 13, font: fontBold, color: dark });
  y -= 24;

  drawField('ID de evento de firma', evidence.evidenceId);
  drawField('Hash del documento (pre-firma, SHA-256)', evidence.documentHashBefore);
  drawField('Hash del documento firmado (SHA-256)', evidence.documentHashAfter);
  drawField('Hash de la imagen de firma (SHA-256)', evidence.signatureHash);

  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  y -= 24;

  page.drawText('Validez legal', { x: margin, y, size: 13, font: fontBold, color: dark });
  y -= 20;

  const legalText = [
    'Este documento constituye evidencia de una firma electrónica simple',
    'conforme a los artículos 89 a 94 del Código de Comercio de México',
    'y los artículos 1803 y 1834 bis del Código Civil Federal.',
    '',
    'El hash SHA-256 del documento garantiza su integridad: cualquier',
    'modificación posterior al documento firmado invalidará este hash.',
    '',
    'La firma electrónica simple tiene la misma validez que la firma',
    'autógrafa cuando las partes así lo acuerdan (Art. 1834 bis CCF).',
  ];

  for (const line of legalText) {
    page.drawText(line, { x: margin, y, size: 9, font: fontRegular, color: gray });
    y -= 14;
  }

  // Footer
  page.drawRectangle({ x: 0, y: 0, width, height: 32, color: rgb(0.976, 0.98, 0.984) });
  page.drawText(
    `Certificado generado automáticamente. © ${new Date().getFullYear()} Aviva`,
    { x: margin, y: 10, size: 8, font: fontRegular, color: gray }
  );

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
