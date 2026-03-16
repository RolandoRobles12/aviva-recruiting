import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { db } from '../utils/admin';
import { updateCandidateDocument, updateCandidateCompletion, getCandidateById } from '../utils/candidates';
import { sendEmail } from '../email/gmailClient';
import { ocrErrorTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { validateDocument } from './documentValidator';

const DOCUMENT_LABELS: Record<string, string> = {
  ine: 'INE / Identificación oficial',
  curp: 'CURP',
  rfc: 'RFC con homoclave',
  comprobante_domicilio: 'Comprobante de domicilio',
  comprobante_estudios: 'Comprobante de estudios',
};

const VALID_DOCUMENT_TYPES = Object.keys(DOCUMENT_LABELS);
const APP_URL = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';

async function notifyOcrError(
  candidateId: string,
  documentType: string,
  errors: string[]
): Promise<void> {
  try {
    const candidate = await getCandidateById(candidateId);
    if (!candidate) return;

    const documentLabel = DOCUMENT_LABELS[documentType] ?? documentType;
    const formUrl = `${APP_URL}/form/${candidate.formToken as string}`;

    const { subject, html } = ocrErrorTemplate(
      {
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        formUrl,
      },
      documentLabel,
      errors
    );

    const senderEmail = await getRecruiterEmail(candidate.createdBy as string);
    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      senderEmail,
    });

    await db.collection('email_logs').add({
      candidateId,
      templateType: 'ocr_error',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: 'document_validator',
      success: true,
      metadata: { documentType, errors },
    });
  } catch (err) {
    console.error('Failed to send validation error email:', err);
  }
}

/**
 * Convert a PDF stored in Cloud Storage to a JPEG image buffer.
 * Uses pdf-to-img which works in Cloud Functions (Node.js).
 * Falls back to treating as image if conversion fails.
 */
async function downloadFileAsImage(
  bucket: string,
  filePath: string,
  contentType: string,
): Promise<{ buffer: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }> {
  const storage = getStorage();
  const file = storage.bucket(bucket).file(filePath);
  const [fileBuffer] = await file.download();

  if (contentType === 'application/pdf') {
    // For PDFs: use pdf2pic to convert first page to image
    // Since pdf2pic requires filesystem, write to /tmp and convert
    const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
    const tmpPdf = `/tmp/doc_${Date.now()}.pdf`;
    const tmpPng = `/tmp/doc_${Date.now()}.png`;

    writeFileSync(tmpPdf, fileBuffer);

    try {
      // Use GraphicsMagick/ImageMagick via child_process (available in Cloud Functions)
      const { execSync } = await import('child_process');
      execSync(
        `convert -density 200 "${tmpPdf}[0]" -quality 90 "${tmpPng}"`,
        { timeout: 30000 }
      );
      const pngBuffer = readFileSync(tmpPng);
      unlinkSync(tmpPdf);
      unlinkSync(tmpPng);
      return { buffer: pngBuffer, mediaType: 'image/png' };
    } catch (convErr) {
      console.error('PDF conversion failed, attempting direct analysis:', convErr);
      // Cleanup
      try { unlinkSync(tmpPdf); } catch { /* ignore */ }
      try { unlinkSync(tmpPng); } catch { /* ignore */ }
      // Fallback: send raw PDF bytes — Claude can sometimes handle embedded images
      throw new Error('No se pudo procesar el PDF. Por favor sube una imagen (JPG o PNG) del documento.');
    }
  }

  // Map content type to Anthropic-supported media types
  const mediaTypeMap: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
    'image/jpeg': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/png': 'image/png',
    'image/webp': 'image/webp',
    'image/gif': 'image/gif',
  };

  const mediaType = mediaTypeMap[contentType];
  if (!mediaType) {
    throw new Error(`Formato no soportado: ${contentType}. Sube JPG, PNG o PDF.`);
  }

  return { buffer: fileBuffer, mediaType };
}

// ─── Storage trigger: auto-validate when a document is uploaded ──────────────

export const onDocumentUploaded = onObjectFinalized(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const object = event.data;
    const filePath = object.name ?? '';
    const contentType = object.contentType ?? '';

    // Pattern: candidates/{candidateId}/documents/{documentType}.{ext}
    const match = filePath.match(/^candidates\/([^/]+)\/documents\/([^.]+)\./);
    if (!match) return;

    const [, candidateId, documentType] = match;

    if (!VALID_DOCUMENT_TYPES.includes(documentType)) return;

    try {
      // Download and prepare image for Claude
      const { buffer, mediaType } = await downloadFileAsImage(
        object.bucket,
        filePath,
        contentType,
      );

      // Validate with Claude Haiku
      const result = await validateDocument(buffer, mediaType, documentType);

      const ocrResult = {
        rawText: '',
        extractedData: result.extractedData,
        confidence: result.confidence,
        validationPassed: result.valid,
        validationErrors: result.errors,
        documentTypeDetected: result.documentTypeDetected,
        processedAt: FieldValue.serverTimestamp(),
      };

      const newStatus = result.valid ? 'valid' : 'invalid';
      const rejectionReason = result.errors.length > 0 ? result.errors.join('. ') : undefined;

      await updateCandidateDocument(candidateId, documentType, {
        status: newStatus,
        ocrResult,
        ...(rejectionReason && { rejectionReason }),
      });

      await updateCandidateCompletion(candidateId);

      // Notify candidate by email when validation fails
      if (!result.valid && result.errors.length > 0) {
        await notifyOcrError(candidateId, documentType, result.errors);
      }
    } catch (err) {
      console.error(`Document validation error for ${candidateId}/${documentType}:`, err);

      const errorMessage = (err as Error).message || 'Error al procesar el documento.';

      // Strict: mark as invalid (not review)
      await updateCandidateDocument(candidateId, documentType, {
        status: 'invalid',
        ocrResult: {
          rawText: '',
          extractedData: {},
          confidence: 0,
          validationPassed: false,
          validationErrors: [errorMessage],
          processedAt: FieldValue.serverTimestamp(),
        },
        rejectionReason: errorMessage,
      });

      await updateCandidateCompletion(candidateId);
      await notifyOcrError(candidateId, documentType, [errorMessage]);
    }
  }
);
