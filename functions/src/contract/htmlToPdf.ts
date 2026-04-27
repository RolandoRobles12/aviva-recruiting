import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

/**
 * Renders a full HTML document to a PDF buffer using headless Chromium.
 * Used for HTML-based contract templates so the PDF looks exactly like the preview.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const executablePath = await chromium.executablePath();

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}
