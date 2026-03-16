import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as crypto from 'crypto';

export interface ContractPdfInput {
  candidateName: string;
  position: string;
  bodyText: string;       // plain text, HTML already stripped
  signatureBase64: string; // data:image/png;base64,...
  signedAt: Date;
  signerIp: string;
  signerUserAgent: string;
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
 * Returns the PDF buffer and cryptographic signing evidence.
 */
export async function generateContractPdf(
  input: ContractPdfInput
): Promise<{ pdfBuffer: Buffer; evidence: SigningEvidence }> {
  const evidenceId = crypto.randomUUID();

  // Hash the contract content before signing
  const documentHashBefore = crypto
    .createHash('sha256')
    .update(`${input.candidateName}|${input.position}|${input.bodyText}`)
    .digest('hex');

  // Hash the signature image
  const sigBase64 = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const signatureHash = crypto
    .createHash('sha256')
    .update(sigBase64)
    .digest('hex');

  // ── Build PDF ──────────────────────────────────────────────────────────────
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

    // Signature block on last page
    if (pageIdx === pages.length - 1) {
      const sigAreaTop = Math.min(y - 20, 155);

      page.drawLine({
        start: { x: margin, y: sigAreaTop + 60 },
        end: { x: pageWidth - margin, y: sigAreaTop + 60 },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.93),
      });

      // Embed signature image
      const sigImageBytes = Buffer.from(sigBase64, 'base64');
      const sigImage = await pdfDoc.embedPng(sigImageBytes);
      const sigDims = sigImage.scale(0.35);
      page.drawImage(sigImage, {
        x: margin,
        y: sigAreaTop + 4,
        width: Math.min(sigDims.width, 200),
        height: Math.min(sigDims.height, 52),
      });

      page.drawLine({
        start: { x: margin, y: sigAreaTop + 2 },
        end: { x: margin + 200, y: sigAreaTop + 2 },
        thickness: 0.5,
        color: dark,
      });
      page.drawText('Firma del Trabajador', { x: margin, y: sigAreaTop - 12, size: 9, font: fontRegular, color: gray });

      const col2 = margin + contentWidth / 2;
      const dateStr = input.signedAt.toLocaleDateString('es-MX', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      page.drawText(`Firmado el ${dateStr}`, { x: col2, y: sigAreaTop + 30, size: 9, font: fontRegular, color: gray });

      // Evidence ID watermark
      page.drawText(`ID de firma: ${evidenceId}`, {
        x: margin, y: sigAreaTop - 28, size: 7, font: fontRegular, color: rgb(0.7, 0.7, 0.7),
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
