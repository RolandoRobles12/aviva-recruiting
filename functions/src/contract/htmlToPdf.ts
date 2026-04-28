import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export interface HtmlToPdfOptions {
  initials?: string;
  initialsBase64?: string;
}

export async function htmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const executablePath = await chromium.executablePath();

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const safeInitials = (options.initials ?? '').replace(/[<>&"]/g, '');
    const initialsHtml = options.initialsBase64
      ? `<img src="${options.initialsBase64}" style="height:24pt;max-width:70pt;display:block;object-fit:contain;" />`
      : safeInitials
        ? `<span style="font-size:11pt;font-weight:bold;color:#111;border:1.5px solid #333;padding:1pt 6pt;font-family:'Times New Roman',serif;letter-spacing:1pt;">${safeInitials}</span>`
        : '<span></span>';
    const footerTemplate = `<div style="font-size:8pt;font-family:'Times New Roman',serif;color:#555;width:100%;padding:0 2.54cm;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;">${initialsHtml}<span><span class="pageNumber"></span>&nbsp;/&nbsp;<span class="totalPages"></span></span></div>`;

    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '14mm', left: '0' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate,
    });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}
