import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

export interface OfferPdfInput {
  candidateName:   string;
  position:        string;
  bodyHtml:        string;  // HTML string — rendered with mixed bold/italic/color
  signatureBase64: string;
  signedAt:        Date;
}

/** Strip basic HTML tags — kept for backward compat */
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

// ─── HTML → Typed blocks ──────────────────────────────────────────────────────

interface Seg { text: string; bold: boolean; italic: boolean; }

type Block =
  | { kind: 'h2';  text: string }
  | { kind: 'p';   segs: Seg[]; isClosing: boolean }
  | { kind: 'li';  segs: Seg[] }
  | { kind: 'gap' };

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseSegs(html: string): Seg[] {
  const out: Seg[] = [];
  let bold = false;
  let italic = false;
  const re = /<(strong|b|em|i|br)(\s[^>]*)?>|<\/(strong|b|em|i)>|([^<]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, openTag, , closeTag, rawText] = m;
    if (openTag) {
      const t = openTag.toLowerCase();
      if (t === 'strong' || t === 'b') bold = true;
      else if (t === 'em' || t === 'i') italic = true;
      else if (t === 'br') out.push({ text: '\n', bold, italic });
    } else if (closeTag) {
      const t = closeTag.toLowerCase();
      if (t === 'strong' || t === 'b') bold = false;
      else if (t === 'em' || t === 'i') italic = false;
    } else if (rawText) {
      const decoded = decodeEntities(rawText);
      if (decoded) out.push({ text: decoded, bold, italic });
    }
  }
  return out;
}

function parseHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>|<ul[^>]*>([\s\S]*?)<\/ul>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const text = decodeEntities(m[1].replace(/<[^>]+>/g, '').trim());
      if (text) blocks.push({ kind: 'h2', text });
    } else if (m[2] !== undefined) {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(m[2])) !== null) {
        const segs = parseSegs(li[1]);
        if (segs.length) blocks.push({ kind: 'li', segs });
      }
    } else if (m[3] !== undefined) {
      const inner = m[3].trim();
      if (!inner) { blocks.push({ kind: 'gap' }); continue; }
      const segs = parseSegs(inner);
      if (segs.length) {
        blocks.push({ kind: 'p', segs, isClosing: inner.includes('¡Nos encanta') });
      }
    }
  }
  return blocks;
}

// ─── Token-based line layout (mixed bold/italic per line) ─────────────────────

type Color = ReturnType<typeof rgb>;

interface WordTok { kind: 'word'; text: string; font: PDFFont; color: Color; w: number; }
interface SpaceTok { kind: 'space'; w: number; }
interface NLTok    { kind: 'nl'; }
type Tok = WordTok | SpaceTok | NLTok;

interface RunWord { text: string; font: PDFFont; color: Color; x: number; }
type RenderedLine = RunWord[];

function segsToToks(
  segs: Seg[],
  fReg: PDFFont, fBold: PDFFont, fObl: PDFFont,
  sz: number,
  cDark: Color, cGray: Color, cGreen: Color,
  forceGreen = false,
): Tok[] {
  const toks: Tok[] = [];
  for (const seg of segs) {
    if (seg.text === '\n') { toks.push({ kind: 'nl' }); continue; }
    const font  = (seg.bold || forceGreen) ? fBold : (seg.italic ? fObl : fReg);
    const color = forceGreen ? cGreen : (seg.italic ? cGray : cDark);
    const parts = seg.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        toks.push({ kind: 'space', w: font.widthOfTextAtSize(' ', sz) });
      } else {
        toks.push({ kind: 'word', text: part, font, color, w: font.widthOfTextAtSize(part, sz) });
      }
    }
  }
  return toks;
}

function layoutToks(toks: Tok[], maxWidth: number): RenderedLine[] {
  const lines: RenderedLine[] = [];
  let row: RunWord[] = [];
  let endX = 0;
  let pendingSpace = 0;

  const flush = () => {
    lines.push(row);
    row = [];
    endX = 0;
    pendingSpace = 0;
  };

  for (const tok of toks) {
    if (tok.kind === 'nl') {
      flush();
    } else if (tok.kind === 'space') {
      if (row.length > 0) pendingSpace += tok.w;
    } else {
      const xStart = row.length === 0 ? 0 : endX + pendingSpace;
      if (row.length > 0 && xStart + tok.w > maxWidth) {
        flush();
        // place at start of new line
        row.push({ text: tok.text, font: tok.font, color: tok.color, x: 0 });
        endX = tok.w;
        pendingSpace = 0;
      } else {
        row.push({ text: tok.text, font: tok.font, color: tok.color, x: xStart });
        endX = xStart + tok.w;
        pendingSpace = 0;
      }
    }
  }
  if (row.length > 0) flush();
  return lines;
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

interface PageState {
  page: PDFPage;
  y: number;
}

function newPage(pdfDoc: PDFDocument, margin: number): PageState {
  const page = pdfDoc.addPage([595, 842]);
  return { page, y: page.getSize().height - margin };
}


// ─── Main PDF generator ───────────────────────────────────────────────────────

export async function generateOfferPdf(input: OfferPdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const fReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fObl  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const margin       = 56;
  const PAGE_W       = 595;
  const PAGE_H       = 842;
  const contentWidth = PAGE_W - margin * 2;
  const SIG_RESERVE  = 150;
  const LINE_H       = 14;

  const green = rgb(0.086, 0.722, 0.467);   // #16B878
  const dark  = rgb(0.216, 0.255, 0.318);   // #373F51
  const gray  = rgb(0.42,  0.447, 0.502);   // #6B727F
  const white = rgb(1, 1, 1);
  const lightMint = rgb(0.88, 0.98, 0.95);

  // ── First page ──────────────────────────────────────────────────────────────
  const firstPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const { width, height } = firstPage.getSize();

  // ── Header bar ──────────────────────────────────────────────────────────────
  firstPage.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: green });

  // Logo icon: white rounded-ish square with "A"
  firstPage.drawRectangle({ x: margin, y: height - 56, width: 32, height: 32, color: white });
  firstPage.drawText('A', {
    x: margin + 9,
    y: height - 44,
    size: 18,
    font: fBold,
    color: green,
  });

  // "aviva" logotype
  firstPage.drawText('aviva', {
    x: margin + 40,
    y: height - 40,
    size: 20,
    font: fBold,
    color: white,
  });
  firstPage.drawText('Carta Oferta de Trabajo', {
    x: margin + 40,
    y: height - 57,
    size: 9,
    font: fReg,
    color: lightMint,
  });

  // Company name right-aligned
  const company = 'Aviva';
  const compW = fBold.widthOfTextAtSize(company, 11);
  firstPage.drawText(company, {
    x: width - margin - compW,
    y: height - 44,
    size: 11,
    font: fBold,
    color: white,
  });

  // Green separator line below header
  firstPage.drawLine({
    start: { x: 0, y: height - 72 },
    end:   { x: width, y: height - 72 },
    thickness: 2,
    color: rgb(0.06, 0.6, 0.38),
  });

  let y = height - 96;

  // ── Candidate name + position ───────────────────────────────────────────────
  if (input.candidateName) {
    firstPage.drawText(input.candidateName, {
      x: margin, y, size: 15, font: fBold, color: dark,
    });
    y -= 20;
  }
  firstPage.drawText(input.position, {
    x: margin, y, size: 11, font: fReg, color: gray,
  });
  y -= 28;

  // Thin divider
  firstPage.drawLine({
    start: { x: margin, y },
    end:   { x: width - margin, y },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  y -= 18;

  // ── Body: render HTML blocks ─────────────────────────────────────────────────
  let st: PageState = { page: firstPage, y };

  const blocks = parseHtml(input.bodyHtml);

  for (const block of blocks) {
    if (block.kind === 'gap') {
      st.y -= LINE_H * 0.5;
      continue;
    }

    if (block.kind === 'h2') {
      st.y -= 8;
      if (st.y < SIG_RESERVE) { st = newPage(pdfDoc, margin); }
      // Left green accent bar
      st.page.drawRectangle({ x: margin, y: st.y - 2, width: 3, height: 15, color: green });
      st.page.drawText(block.text, {
        x: margin + 9, y: st.y, size: 11, font: fBold, color: green,
      });
      st.y -= LINE_H + 6;
      continue;
    }

    if (block.kind === 'li') {
      if (st.y < SIG_RESERVE) { st = newPage(pdfDoc, margin); }
      // Green dash bullet
      st.page.drawText('-', { x: margin + 2, y: st.y, size: 10, font: fBold, color: green });
      const toks = segsToToks(block.segs, fReg, fBold, fObl, 10, dark, gray, green);
      const lines = layoutToks(toks, contentWidth - 14);
      for (let i = 0; i < lines.length; i++) {
        if (st.y < SIG_RESERVE) { st = newPage(pdfDoc, margin); }
        for (const w of lines[i]) {
          if (w.text) {
            st.page.drawText(w.text, {
              x: margin + 14 + w.x, y: st.y, size: 10, font: w.font, color: w.color,
            });
          }
        }
        st.y -= LINE_H;
      }
      continue;
    }

    if (block.kind === 'p') {
      const forceGreen = block.isClosing;
      const toks = segsToToks(block.segs, fReg, fBold, fObl, 10, dark, gray, green, forceGreen);
      const lines = layoutToks(toks, contentWidth);

      for (const line of lines) {
        if (st.y < SIG_RESERVE) { st = newPage(pdfDoc, margin); }
        if (line.length === 0) {
          // empty line from <br>
          st.y -= LINE_H * 0.6;
          continue;
        }
        for (const w of line) {
          if (w.text) {
            st.page.drawText(w.text, {
              x: margin + w.x, y: st.y, size: 10, font: w.font, color: w.color,
            });
          }
        }
        st.y -= LINE_H;
      }
      // paragraph spacing
      st.y -= LINE_H * 0.5;
      continue;
    }
  }

  // ── Signature section — always on the last page ───────────────────────────
  if (st.y < SIG_RESERVE) {
    st = newPage(pdfDoc, margin);
  }

  st.y -= 20;

  // Horizontal rule above signature
  st.page.drawLine({
    start: { x: margin,         y: st.y },
    end:   { x: width - margin, y: st.y },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  st.y -= 8;

  // Embed signature image
  const base64Data = input.signatureBase64.replace(/^data:image\/png;base64,/, '');
  const sigImageBytes = Buffer.from(base64Data, 'base64');
  const sigImage = await pdfDoc.embedPng(sigImageBytes);
  const sigDims  = sigImage.scale(0.35);
  const sigWidth  = Math.min(sigDims.width,  200);
  const sigHeight = Math.min(sigDims.height,  52);

  const sigImgY = st.y - sigHeight;
  st.page.drawImage(sigImage, { x: margin, y: sigImgY, width: sigWidth, height: sigHeight });

  // Underline
  st.page.drawLine({
    start: { x: margin,       y: sigImgY - 4 },
    end:   { x: margin + 200, y: sigImgY - 4 },
    thickness: 0.5,
    color: dark,
  });
  st.page.drawText('Firma del Candidato', {
    x: margin, y: sigImgY - 18, size: 9, font: fReg, color: gray,
  });

  // Date signed — right column
  const dateStr = input.signedAt.toLocaleDateString('es-MX', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const col2 = margin + contentWidth / 2;
  st.page.drawText(`Firmado el ${dateStr}`, {
    x: col2, y: st.y - sigHeight / 2, size: 9, font: fReg, color: gray,
  });

  // ── Footer ───────────────────────────────────────────────────────────────────
  st.page.drawRectangle({ x: 0, y: 0, width, height: 32, color: rgb(0.976, 0.98, 0.984) });
  st.page.drawText('Este documento tiene validez como carta oferta de trabajo. © Aviva', {
    x: margin, y: 10, size: 8, font: fReg, color: gray,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
