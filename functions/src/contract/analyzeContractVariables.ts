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
- name: Full name of the candidate (e.g. "María García López")
- firstName: First name only
- lastName: Last name(s) only
- nacionalidad: Nationality (e.g. "Mexicana")
- sexo: Sex/gender written out (e.g. "Masculino" or "Femenino")
- curp: CURP 18-character code
- rfc: RFC tax ID with homoclave
- nss: IMSS Social Security Number (11 digits)
- domicilio: Full address
- position: Job title / position
- salary: Monthly salary as a number/currency (e.g. "$18,000")
- salarioTexto: Monthly salary written in words (e.g. "dieciocho mil pesos 00/100 moneda nacional")
- startDate: Employment start date
- beneficiario: Full name of the designated beneficiary
- parentesco: Relationship of the beneficiary (e.g. "Esposo/a", "Hijo/a", "Madre", "Padre")
- date: Today's date (auto-filled when signing)
- hiringManager: Direct manager / hiring manager name
- company: Company name (defaults to "Aviva")
- clabe: 18-digit CLABE bank account number
- banco: Bank name
`.trim();

const SYSTEM_PROMPT = `You are a legal document analyzer specializing in Mexican employment contracts.
Your task has TWO parts:

PART 1 — Identify every *** placeholder and map it to a variable.
${VARIABLES_DOC}

PART 2 — Detect signature, initials, and date fields.
Look for: lines where someone would physically sign (long underscores ____), boxes or spaces labeled "Firma", "Rúbrica", "Sello", "Iniciales", blank areas at section endings or page footers that appear to be for a signature, and date lines near signatures.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "placeholders": [
    {
      "occurrence": 1,
      "variable": "name",
      "context": "...~60 chars around the ***...",
      "pageIndex": 0,
      "xPercent": 55.2,
      "yPercent": 12.4,
      "fontSize": 10
    }
  ],
  "signatureFields": [
    {
      "type": "signature",
      "label": "Firma del Trabajador",
      "pageIndex": 5,
      "xPercent": 10.5,
      "yPercent": 87.0,
      "widthPts": 200,
      "heightPts": 55
    }
  ]
}

Rules for placeholders:
- occurrence is 1-based, counting *** from the top of the document
- pageIndex is 0-based
- xPercent/yPercent: position on its page (0=left/top, 100=right/bottom)
- fontSize: estimate from surrounding text (body ~10-11pt, headings ~12-14pt)
- context: ~60 characters around the ***
- "$***.00 M.N." → variable "salary"; "( *** pesos 00/100...)" right after → "salarioTexto"
- Return EVERY *** occurrence, do not skip any

Rules for signatureFields:
- type: "signature" for full signatures, "initials" for initials/rúbrica, "date" for date next to signature
- widthPts: estimated width in PDF points (signature ~200, initials ~80, date ~120)
- heightPts: estimated height in PDF points (signature ~55, initials ~30, date ~25)
- Only include fields that are clearly for signing/initialing — do not include *** placeholders here`;

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

      // Get page dimensions from pdf-lib (needed to convert % to points later)
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const pageDimensions = pages.map((p) => {
        const { width, height } = p.getSize();
        return { width, height };
      });

      // Send the PDF to Claude for analysis
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

      const pdfBase64 = pdfBytes.toString('base64');

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBase64,
                },
              },
              {
                type: 'text',
                text: 'Analyze this contract PDF and find all *** placeholders. Return the JSON as instructed.',
              },
            ],
          },
        ],
      });

      // Extract JSON from Claude response
      const rawText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
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
        const placeholderWidth = approxCharWidth * 3;
        const placeholderHeight = p.fontSize * 1.2;

        return {
          variableName: p.variable,
          pageIndex: p.pageIndex,
          x: Math.round(x),
          y: Math.round(yFromBottom),
          fontSize: p.fontSize || 10,
          erasePlaceholder: true,
          placeholderWidth: Math.round(placeholderWidth),
          placeholderHeight: Math.round(placeholderHeight),
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
