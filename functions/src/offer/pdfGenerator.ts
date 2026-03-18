import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface OfferPdfInput {
  candidateName: string;
  position: string;
  bodyText: string;       // plain text, HTML tags already stripped
  signatureBase64: string; // data:image/png;base64,...
  signedAt: Date;
}

/** Strip basic HTML tags for plain-text PDF rendering */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Wrap text to fit within maxWidth, returning array of lines */
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

export async function generateOfferPdf(input: OfferPdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const contentWidth = width - margin * 2;
  const green = rgb(0.086, 0.722, 0.467);
  const dark = rgb(0.216, 0.255, 0.318);
  const gray = rgb(0.42, 0.447, 0.502);

  let y = height - margin;

  // ── Header bar ──────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: green });
  page.drawText('Aviva', { x: margin, y: height - 44, size: 22, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('Carta Oferta de Trabajo', { x: margin, y: height - 62, size: 11, font: fontRegular, color: rgb(0.9, 0.98, 0.95) });

  y = height - 96;

  // ── Candidate info ───────────────────────────────────────────────────────────
  page.drawText(input.candidateName, { x: margin, y, size: 15, font: fontBold, color: dark });
  y -= 18;
  page.drawText(input.position, { x: margin, y, size: 11, font: fontRegular, color: gray });
  y -= 28;

  // Divider
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
  y -= 18;

  // ── Body text (contains all sections: position, responsibilities, compensation) ─
  const bodyLines = wrapText(input.bodyText, fontRegular, 10, contentWidth);
  let currentPage = page;
  for (let i = 0; i < bodyLines.length; i++) {
    if (y < 160) {
      currentPage = pdfDoc.addPage([595, 842]);
      y = currentPage.getSize().height - margin;
    }
    currentPage.drawText(bodyLines[i], { x: margin, y, size: 10, font: fontRegular, color: dark });
    y -= 14;
  }
  y -= 10;

  // ── Signature section ────────────────────────────────────────────────────────
  const sigAreaTop = 155;
  page.drawLine({ start: { x: margin, y: sigAreaTop + 60 }, end: { x: width - margin, y: sigAreaTop + 60 }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });

  // Embed signature image
  const base64Data = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const sigImageBytes = Buffer.from(base64Data, 'base64');
  const sigImage = await pdfDoc.embedPng(sigImageBytes);
  const sigDims = sigImage.scale(0.35);
  page.drawImage(sigImage, {
    x: margin,
    y: sigAreaTop + 4,
    width: Math.min(sigDims.width, 200),
    height: Math.min(sigDims.height, 52),
  });

  // Signature line
  page.drawLine({ start: { x: margin, y: sigAreaTop + 2 }, end: { x: margin + 200, y: sigAreaTop + 2 }, thickness: 0.5, color: dark });
  page.drawText('Firma del Candidato', { x: margin, y: sigAreaTop - 12, size: 9, font: fontRegular, color: gray });

  // Date signed
  const dateStr = input.signedAt.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const col2 = margin + contentWidth / 2;
  page.drawText(`Firmado el ${dateStr}`, { x: col2, y: sigAreaTop + 30, size: 9, font: fontRegular, color: gray });

  // Footer
  page.drawRectangle({ x: 0, y: 0, width, height: 32, color: rgb(0.976, 0.98, 0.984) });
  page.drawText('Este documento tiene validez como carta oferta de trabajo. © Aviva', {
    x: margin, y: 10, size: 8, font: fontRegular, color: gray,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
