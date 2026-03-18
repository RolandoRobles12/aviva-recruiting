/**
 * Cloud Function: analyzePdfTemplate
 *
 * Receives a PDF file (via Firebase Storage path) and returns analysis results
 * including detected signature fields, page dimensions, and suggested positions.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { analyzePdfTemplate } from './pdfTemplateProcessor';

export const analyzePdfTemplateEndpoint = onRequest(
  { region: 'us-central1', cors: true, maxInstances: 10 },
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
      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);

      const [exists] = await file.exists();
      if (!exists) {
        res.status(404).json({ ok: false, error: 'PDF file not found in storage' });
        return;
      }

      const [pdfBytes] = await file.download();
      const analysis = await analyzePdfTemplate(Buffer.from(pdfBytes));

      res.status(200).json({ ok: true, analysis });
    } catch (err) {
      console.error('[analyzePdfTemplate] Error:', err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Error analyzing PDF',
      });
    }
  }
);
