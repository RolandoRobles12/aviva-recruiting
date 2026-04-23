import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument } from 'pdf-lib';
import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = defineString('ANTHROPIC_API_KEY');

export interface DetectedPlaceholder {
  occurrence: number;
  variable: string;
  context: string;
  pageIndex: number; // 0-based
  xPercent: number;  // 0-100, left to right
  yPercent: number;  // 0-100, top to bottom
  fontSize: number;
}

const VARIABLES_DOC = `
Available variables (use the exact id):
- name: Full name (e.g. "María García López")
- firstName: First name only
- lastName: Last name(s) only
- nacionalidad: Nationality (e.g. "Mexicana")
- sexo: Sex/gender (e.g. "Masculino" or "Femenino")
- curp: CURP 18-character code
- rfc: RFC tax ID with homoclave
- nss: IMSS Social Security Number (11 digits)
- domicilio: Full address
- position: Job title / position
- salary: Monthly salary as currency (e.g. "$18,000")
- salarioTexto: Monthly salary in words (e.g. "dieciocho mil pesos 00/100 moneda nacional")
- startDate: Employment start date
- beneficiario: Full name of designated beneficiary
- parentesco: Beneficiary relationship (e.g. "Esposo/a", "Hijo/a")
- date: Today's date (auto-filled when signing)
- hiringManager: Direct manager name
- company: Company name (defaults to "Aviva")
- clabe: 18-digit CLABE bank account number
- banco: Bank name
`.trim();

const SYSTEM_PROMPT = `You are a legal document analyzer for Mexican employment contracts.
The document text below uses *** as placeholders for candidate-specific data.
Your task has TWO parts:

PART 1 — Map each *** to a variable.
${VARIABLES_DOC}

PART 2 — Detect signature/initials/date fields from patterns like ________ lines, or labels "Firma", "Rúbrica", "Iniciales", "Sello".

Return ONLY valid JSON (no markdown, no explanation):
{
  "placeholders": [
    {
      "occurrence": 1,
      "variable": "name",
      "context": "~60 chars around the ***",
      "pageIndex": 0,
      "xPercent": 50,
      "yPercent": 15,
      "fontSize": 10
    }
  ],
  "signatureFields": [
    {
      "type": "signature",
      "label": "Firma del Trabajador",
      "pageIndex": 5,
      "xPercent": 25,
      "yPercent": 85,
      "widthPts": 200,
      "heightPts": 55
    }
  ]
}

Rules:
- occurrence: 1-based, counting *** from top of document
- pageIndex: 0-based (use ---PAGE N--- markers in the text)
- xPercent/yPercent: estimate position on its page (0=left/top, 100=right/bottom); use 50/50 if unsure
- fontSize: estimate from context (body ~10-11, headings ~12-14)
- "$***.00 M.N." → "salary"; "( *** pesos 00/100...)" right after → "salarioTexto"
- Return EVERY *** occurrence without skipping
- signatureFields type: "signature" | "initials" | "date"`;

export const analyzeContractVariables = onRequest(
  {
    region: 'us-central1',
    cors: true,
    invoker: 'public',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const { storagePath } = req.body as { storagePath?: string };
    if (!storagePath) {
      res.status(400).json({ ok: false, error: 'storagePath is required' });
      return;
    }

    try {
      // Download PDF from Firebase Storage
      const bucket = getStorage().bucket();
      const [pdfBytes] = await bucket.file(storagePath).download();

      // Extract plain text using pdf-parse lib path (avoids test-file bootstrap crash)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse: (b: Buffer) => Promise<{ text: string }> =
        require('pdf-parse/lib/pdf-parse.js');
      const pdfData = await pdfParse(Buffer.from(pdfBytes));
      const extractedText = pdfData.text;

      // Get page dimensions from pdf-lib (needed to convert % → PDF points)
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const pageDimensions = pages.map((p) => {
        const { width, height } = p.getSize();
        return { width, height };
      });

      // Split text by page (pdf-parse uses \f as page separator)
      const pageTexts = extractedText.split('\f');
      const textWithPageMarkers = pageTexts
        .map((t, i) => `---PAGE ${i + 1}---\n${t.trim()}`)
        .join('\n\n');

      // Send plain text to Claude — far fewer tokens than base64 PDF
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Analyze this contract and find all *** placeholders:\n\n${textWithPageMarkers}`,
          },
        ],
      });

      // Extract JSON from Claude response
      const claudeText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Claude did not return valid JSON');
      }

      type RawSignatureField = {
        type: string;
        label?: string;
        pageIndex: number;
        xPercent: number;
        yPercent: number;
        widthPts?: number;
        heightPts?: number;
      };
      const parsed = JSON.parse(jsonMatch[0]) as {
        placeholders: DetectedPlaceholder[];
        signatureFields?: RawSignatureField[];
      };
      const placeholders = parsed.placeholders ?? [];
      const rawSigFields = parsed.signatureFields ?? [];

      // Convert placeholder positions to PDF points
      const mappings = placeholders.map((p) => {
        const dim = pageDimensions[p.pageIndex] ?? pageDimensions[0];
        const x = (p.xPercent / 100) * dim.width;
        const yFromBottom = ((100 - p.yPercent) / 100) * dim.height;
        const approxCharWidth = p.fontSize * 0.6;

        return {
          variableName: p.variable,
          pageIndex: p.pageIndex,
          x: Math.round(x),
          y: Math.round(yFromBottom),
          fontSize: p.fontSize || 10,
          erasePlaceholder: true,
          placeholderWidth: Math.round(approxCharWidth * 3),
          placeholderHeight: Math.round(p.fontSize * 1.2),
        };
      });

      // Convert signature field positions to PDF points
      const signatureFields = rawSigFields.map((sf, i) => {
        const dim = pageDimensions[sf.pageIndex] ?? pageDimensions[0];
        const x = (sf.xPercent / 100) * dim.width;
        const yFromBottom = ((100 - sf.yPercent) / 100) * dim.height;
        const type = ['signature', 'initials', 'date'].includes(sf.type)
          ? (sf.type as 'signature' | 'initials' | 'date')
          : 'signature';
        const defaultW = type === 'signature' ? 200 : type === 'initials' ? 80 : 120;
        const defaultH = type === 'signature' ? 55 : type === 'initials' ? 30 : 25;
        return {
          id: `ai_sig_${i}`,
          type,
          pageIndex: sf.pageIndex,
          x: Math.round(x),
          y: Math.round(yFromBottom),
          width: sf.widthPts || defaultW,
          height: sf.heightPts || defaultH,
          label: sf.label || (type === 'signature' ? 'Firma' : type === 'initials' ? 'Iniciales' : 'Fecha'),
          required: true,
        };
      });

      res.status(200).json({
        ok: true,
        extractedText,
        placeholders: placeholders.map((p) => ({
          ...p,
          pageDimensions: pageDimensions[p.pageIndex] ?? pageDimensions[0],
        })),
        variableMappings: mappings,
        signatureFields,
        pageDimensions,
      });
    } catch (err) {
      console.error('[analyzeContractVariables] error:', err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error al analizar el contrato',
      });
    }
  }
);
