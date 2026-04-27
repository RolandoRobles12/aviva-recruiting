import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface OfferPdfInput {
  candidateName:   string;
  position:        string;
  bodyHtml:        string;  // HTML string — stripped to plain text for rendering
  signatureBase64: string;
  signedAt:        Date;
  /** Company logo URL — embedded as image in the header if provided */
  logoUrl?:        string;
}

/** Strip HTML tags, preserving structure as plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Wrap a paragraph into lines that fit within maxWidth */
function wrapText(
  text: string,
  font: import('pdf-lib').PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
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

// ─── Main PDF generator ───────────────────────────────────────────────────────

export async function generateOfferPdf(input: OfferPdfInput): Promise<Buffer> {
  console.log('[pdfGenerator] PDFDocument.create...');
  const pdfDoc = await PDFDocument.create();

  console.log('[pdfGenerator] embedFont Helvetica...');
  const fReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  console.log('[pdfGenerator] embedFont HelveticaBold...');
  const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  console.log('[pdfGenerator] fonts embedded, building PDF...');

  const margin       = 56;
  const PAGE_W       = 595;
  const PAGE_H       = 842;
  const contentWidth = PAGE_W - margin * 2;
  const LINE_H       = 14;
  const SIG_RESERVE  = 140; // space reserved at bottom for signature

  const green    = rgb(0.086, 0.722, 0.467);
  const dark     = rgb(0.216, 0.255, 0.318);
  const gray     = rgb(0.42,  0.447, 0.502);
  const white    = rgb(1, 1, 1);
  const lightMint = rgb(0.88, 0.98, 0.95);

  // ── Convert HTML body to structured plain-text lines ──────────────────────
  // Split into sections: headings (##) and body lines
  const plainText = stripHtml(input.bodyHtml);

  interface TextLine { text: string; isHeading: boolean; isBullet: boolean; }
  const textLines: TextLine[] = [];
  for (const line of plainText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      textLines.push({ text: trimmed.slice(3), isHeading: true, isBullet: false });
    } else if (trimmed.startsWith('- ')) {
      // Wrap bullet text to fit content width (with indent)
      const bulletIndent = 12;
      const bulletText = trimmed.slice(2);
      const wrapped = wrapText(bulletText, fReg, 10, contentWidth - bulletIndent);
      for (let i = 0; i < wrapped.length; i++) {
        textLines.push({
          text: (i === 0 ? '- ' : '  ') + wrapped[i],
          isHeading: false,
          isBullet: true,
        });
      }
    } else {
      const wrapped = wrapText(trimmed, fReg, 10, contentWidth);
      for (const wl of wrapped) {
        textLines.push({ text: wl, isHeading: false, isBullet: false });
      }
    }
  }

  // ── Build pages ────────────────────────────────────────────────────────────
  // First page: header uses 96px, body starts at PAGE_H - 96
  const FIRST_PAGE_START_Y = PAGE_H - 96;
  const OTHER_PAGE_START_Y = PAGE_H - margin;

  // Pre-split lines into pages
  const pages: TextLine[][] = [];
  let currentPage: TextLine[] = [];
  let currentY = FIRST_PAGE_START_Y;

  for (const line of textLines) {
    const h = line.isHeading ? LINE_H + 10 : LINE_H;
    if (currentY - h < SIG_RESERVE) {
      pages.push(currentPage);
      currentPage = [];
      currentY = OTHER_PAGE_START_Y;
    }
    currentPage.push(line);
    currentY -= h;
  }
  pages.push(currentPage);

  // ── Render each page ───────────────────────────────────────────────────────
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const { width, height } = page.getSize();

    // ── Header bar (first page only) ─────────────────────────────────────────
    if (pageIdx === 0) {
      page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: green });

      // Logo: try to embed the real logo image; fall back to the 'A' monogram
      let logoEndX = margin;
      if (input.logoUrl) {
        try {
          const resp = await fetch(input.logoUrl);
          const logoBytes = Buffer.from(await resp.arrayBuffer());
          const isJpeg = input.logoUrl.toLowerCase().includes('.jpg') || input.logoUrl.toLowerCase().includes('.jpeg');
          const logoImg = isJpeg ? await pdfDoc.embedJpg(logoBytes) : await pdfDoc.embedPng(logoBytes);
          const logoDims = logoImg.scale(Math.min(120 / logoImg.width, 40 / logoImg.height, 1));
          page.drawImage(logoImg, { x: margin, y: height - 58, width: logoDims.width, height: logoDims.height });
          logoEndX = margin + logoDims.width + 10;
        } catch {
          // Fall through to monogram
          page.drawRectangle({ x: margin, y: height - 56, width: 32, height: 32, color: white });
          page.drawText('A', { x: margin + 9, y: height - 44, size: 18, font: fBold, color: green });
          logoEndX = margin + 42;
        }
      } else {
        page.drawRectangle({ x: margin, y: height - 56, width: 32, height: 32, color: white });
        page.drawText('A', { x: margin + 9, y: height - 44, size: 18, font: fBold, color: green });
        logoEndX = margin + 42;
      }

      // Aviva logotype
      page.drawText('aviva', { x: logoEndX, y: height - 40, size: 20, font: fBold, color: white });
      page.drawText('Carta Oferta de Trabajo', { x: logoEndX, y: height - 57, size: 9, font: fReg, color: lightMint });

      // Company name right-aligned
      const company = 'Aviva';
      const compW = fBold.widthOfTextAtSize(company, 11);
      page.drawText(company, { x: width - margin - compW, y: height - 44, size: 11, font: fBold, color: white });

      // Candidate name + position below header
      let nameY = height - 96;
      if (input.candidateName) {
        page.drawText(input.candidateName, { x: margin, y: nameY, size: 15, font: fBold, color: dark });
        nameY -= 20;
      }
      page.drawText(input.position, { x: margin, y: nameY, size: 11, font: fReg, color: gray });
      nameY -= 28;
      page.drawLine({ start: { x: margin, y: nameY }, end: { x: width - margin, y: nameY }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
    }

    // ── Body text ─────────────────────────────────────────────────────────────
    // First page: header=72px, name=20px, position=20px, gap=28px, sep=1px, pad=16px → 157px total
    let y = pageIdx === 0 ? PAGE_H - 157 : OTHER_PAGE_START_Y;

    for (const line of pages[pageIdx]) {
      if (!line.text.trim()) {
        y -= LINE_H * 0.5;
        continue;
      }

      if (line.isHeading) {
        y -= 8;
        // Green accent bar
        page.drawRectangle({ x: margin, y: y - 2, width: 3, height: 15, color: green });
        page.drawText(line.text, {
          x: margin + 9, y, size: 11, font: fBold, color: green,
        });
        y -= LINE_H + 6;
      } else {
        page.drawText(line.text, {
          x: margin, y, size: 10, font: fReg, color: dark,
        });
        y -= LINE_H;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width, height: 32, color: rgb(0.976, 0.98, 0.984) });
    page.drawText('Este documento tiene validez como carta oferta de trabajo. © Aviva', {
      x: margin, y: 10, size: 8, font: fReg, color: gray,
    });

    if (pages.length > 1) {
      const pageNum = `${pageIdx + 1} / ${pages.length}`;
      const numW = fReg.widthOfTextAtSize(pageNum, 8);
      page.drawText(pageNum, {
        x: width - margin - numW, y: 10, size: 8, font: fReg, color: gray,
      });
    }
  }

  // ── Signature section on last page ────────────────────────────────────────
  // Re-open the last page to add the signature (pdf-lib returns existing page refs)
  const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
  const { width: lw } = lastPage.getSize();

  // Find where the last body line ends — approximate based on content
  const lastPageLines = pages[pages.length - 1];
  let sigY = (pages.length === 1 ? FIRST_PAGE_START_Y - 18 : OTHER_PAGE_START_Y);
  for (const line of lastPageLines) {
    if (!line.text.trim()) { sigY -= LINE_H * 0.5; continue; }
    sigY -= line.isHeading ? LINE_H + 14 : LINE_H;
  }
  sigY = Math.max(sigY - 20, SIG_RESERVE - 10);

  lastPage.drawLine({
    start: { x: margin, y: sigY },
    end:   { x: lw - margin, y: sigY },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  sigY -= 8;

  console.log('[pdfGenerator] embedPng signature...');
  const base64Data = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const sigImageBytes = Buffer.from(base64Data, 'base64');
  const sigImage = await pdfDoc.embedPng(sigImageBytes);
  console.log('[pdfGenerator] embedPng done');

  const sigDims   = sigImage.scale(0.35);
  const sigWidth  = Math.min(sigDims.width,  200);
  const sigHeight = Math.min(sigDims.height,  52);
  const sigImgY   = sigY - sigHeight;

  lastPage.drawImage(sigImage, { x: margin, y: sigImgY, width: sigWidth, height: sigHeight });

  lastPage.drawLine({
    start: { x: margin,       y: sigImgY - 4 },
    end:   { x: margin + 200, y: sigImgY - 4 },
    thickness: 0.5,
    color: dark,
  });
  lastPage.drawText('Firma del Candidato', {
    x: margin, y: sigImgY - 18, size: 9, font: fReg, color: gray,
  });

  const dateStr = input.signedAt.toLocaleDateString('es-MX', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const col2 = margin + (lw - margin * 2) / 2;
  lastPage.drawText(`Firmado el ${dateStr}`, {
    x: col2, y: sigY - sigHeight / 2, size: 9, font: fReg, color: gray,
  });

  console.log('[pdfGenerator] saving PDF...');
  const pdfBytes = await pdfDoc.save();
  console.log('[pdfGenerator] PDF saved.');
  return Buffer.from(pdfBytes);
}
