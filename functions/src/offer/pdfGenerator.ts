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
  if (input.candidateName) {
    page.drawText(input.candidateName, { x: margin, y, size: 15, font: fontBold, color: dark });
    y -= 18;
  }
  page.drawText(input.position, { x: margin, y, size: 11, font: fontRegular, color: gray });
  y -= 28;

  // Divider
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
  y -= 18;

  // ── Body text ────────────────────────────────────────────────────────────────
  // Reserve 140px at the bottom for the signature block.
  const SIG_RESERVE = 140;

  const bodyLines = wrapText(input.bodyText, fontRegular, 10, contentWidth);
  let currentPage = page;

  for (const line of bodyLines) {
    if (y < SIG_RESERVE) {
      // Start a new page — no header bar on continuation pages
      currentPage = pdfDoc.addPage([595, 842]);
      y = currentPage.getSize().height - margin;
    }
    currentPage.drawText(line, { x: margin, y, size: 10, font: fontRegular, color: dark });
    y -= 14;
  }

  // ── Signature section — always on the LAST page (currentPage) ──────────────

  // Ensure there's room; if not, open a new page
  if (y < SIG_RESERVE) {
    currentPage = pdfDoc.addPage([595, 842]);
    y = currentPage.getSize().height - margin;
  }

  y -= 20; // gap before signature

  // Horizontal rule above signature
  currentPage.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  y -= 8;

  // Embed signature image
  const base64Data = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const sigImageBytes = Buffer.from(base64Data, 'base64');
  const sigImage = await pdfDoc.embedPng(sigImageBytes);
  const sigDims = sigImage.scale(0.35);
  const sigWidth  = Math.min(sigDims.width, 200);
  const sigHeight = Math.min(sigDims.height, 52);

  const sigImgY = y - sigHeight;
  currentPage.drawImage(sigImage, {
    x: margin,
    y: sigImgY,
    width: sigWidth,
    height: sigHeight,
  });

  // Signature line
  currentPage.drawLine({
    start: { x: margin, y: sigImgY - 4 },
    end: { x: margin + 200, y: sigImgY - 4 },
    thickness: 0.5,
    color: dark,
  });
  currentPage.drawText('Firma del Candidato', {
    x: margin,
    y: sigImgY - 18,
    size: 9,
    font: fontRegular,
    color: gray,
  });

  // Date signed — placed to the right of the signature
  const dateStr = input.signedAt.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const col2 = margin + contentWidth / 2;
  currentPage.drawText(`Firmado el ${dateStr}`, {
    x: col2,
    y: y - sigHeight / 2,
    size: 9,
    font: fontRegular,
    color: gray,
  });

  // ── Footer ──────────────────────────────────────────────────────────────────
  currentPage.drawRectangle({ x: 0, y: 0, width, height: 32, color: rgb(0.976, 0.98, 0.984) });
  currentPage.drawText('Este documento tiene validez como carta oferta de trabajo. © Aviva', {
    x: margin, y: 10, size: 8, font: fontRegular, color: gray,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
