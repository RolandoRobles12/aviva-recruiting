import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { db } from '../utils/admin';
import { updateCandidateDocument, updateCandidateCompletion, getCandidateById } from '../utils/candidates';
import { sendEmail } from '../email/gmailClient';
import { ocrErrorTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { validateDocument } from './documentValidator';
import { crossValidateNames } from './nameMatch';
import { ALL_DOCUMENT_TYPES, DOCUMENT_LABELS } from '../utils/documentTypes';

const APP_URL = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';

async function notifyOcrError(
  candidateId: string,
  documentType: string,
  errors: string[],
  details?: { documentTypeDetected?: string; confidence?: number }
): Promise<void> {
  try {
    const candidate = await getCandidateById(candidateId);
    if (!candidate) return;

    const documentLabel = DOCUMENT_LABELS[documentType] ?? documentType;
    const formToken = candidate.formToken as string | undefined;
    if (!formToken) {
      console.warn(`[notifyOcrError] candidate ${candidateId} has no formToken — skipping error email`);
      return;
    }
    const formUrl = `${APP_URL}/form/${formToken}`;

    const { subject, html } = ocrErrorTemplate(
      {
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        formUrl,
      },
      documentLabel,
      errors,
      details
    );

    const createdBy = candidate.createdBy as string;
    const senderEmail = await getRecruiterEmail(createdBy);
    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      senderEmail,
      recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
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

    if (!ALL_DOCUMENT_TYPES.includes(documentType)) return;

    // Document types that MUST contain a readable nombre_completo
    const REQUIRES_NAME = [
      'ine', 'curp', 'nss', 'acta_nacimiento', 'caratula_bancaria',
      'certificado_estudios', 'constancia_fiscal', 'aviso_retencion',
      'estado_cuenta_fonacot',
    ];

    try {
      // Download and prepare image for Claude
      const { buffer, mediaType } = await downloadFileAsImage(
        object.bucket,
        filePath,
        contentType,
      );

      // For comprobante_domicilio: load INE address if already validated
      let extraContext: Record<string, string> | undefined;
      if (documentType === 'comprobante_domicilio') {
        const candidate = await getCandidateById(candidateId);
        const existingDocs = (candidate?.documents ?? {}) as Record<string, {
          status: string;
          ocrResult?: { extractedData?: Record<string, string> };
        }>;
        const ineDoc = existingDocs['ine'];
        const ineAddress = ineDoc?.status === 'valid'
          ? ineDoc.ocrResult?.extractedData?.domicilio
          : undefined;
        if (ineAddress) {
          extraContext = { INE_ADDRESS: ineAddress };
        }
      }

      // Validate with Claude Haiku
      const result = await validateDocument(buffer, mediaType, documentType, extraContext);

      // Require nombre_completo for documents that must contain it
      const extraErrors: string[] = [];
      if (result.valid && REQUIRES_NAME.includes(documentType) && !result.extractedData.nombre_completo) {
        extraErrors.push('No se pudo leer el nombre del titular en el documento. Asegúrate de que el nombre sea claramente visible y sube la imagen de nuevo.');
      }

      // Cross-validate name against other valid documents
      let nameErrors: string[] = [];
      if (result.valid && result.extractedData.nombre_completo) {
        const candidate = await getCandidateById(candidateId);
        if (candidate) {
          const existingDocs = (candidate.documents ?? {}) as Record<string, {
            status: string;
            ocrResult?: { extractedData?: Record<string, string> };
          }>;
          nameErrors = crossValidateNames(
            documentType,
            DOCUMENT_LABELS[documentType] ?? documentType,
            result.extractedData.nombre_completo,
            existingDocs,
            DOCUMENT_LABELS,
          );
        }
      }

      const allErrors = [...result.errors, ...extraErrors, ...nameErrors];
      const isValid = result.valid && extraErrors.length === 0 && nameErrors.length === 0;

      const ocrResult = {
        rawText: '',
        extractedData: result.extractedData,
        confidence: result.confidence,
        validationPassed: isValid,
        validationErrors: allErrors,
        documentTypeDetected: result.documentTypeDetected,
        processedAt: FieldValue.serverTimestamp(),
      };

      const newStatus = isValid ? 'valid' : 'invalid';
      const rejectionReason = allErrors.length > 0 ? allErrors.join('. ') : undefined;

      await updateCandidateDocument(candidateId, documentType, {
        status: newStatus,
        ocrResult,
        ...(rejectionReason && { rejectionReason }),
      });

      await updateCandidateCompletion(candidateId);

      // Notify candidate by email when validation fails
      if (!isValid && allErrors.length > 0) {
        await notifyOcrError(candidateId, documentType, allErrors, {
          documentTypeDetected: result.documentTypeDetected,
          confidence: result.confidence,
        });
      }
    } catch (err) {
      console.error(`Document validation error for ${candidateId}/${documentType}:`, err);

      const errorMessage = (err as Error).message || 'Error al procesar el documento.';

      // If the failure is a configuration error (e.g. missing API key), mark for
      // manual review instead of rejecting the document and emailing the candidate.
      const isConfigError =
        errorMessage.includes('apiKey') ||
        errorMessage.includes('authToken') ||
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('ANTHROPIC_API_KEY');

      const docStatus = isConfigError ? 'review' : 'invalid';

      await updateCandidateDocument(candidateId, documentType, {
        status: docStatus,
        ocrResult: {
          rawText: '',
          extractedData: {},
          confidence: 0,
          validationPassed: false,
          validationErrors: [errorMessage],
          processedAt: FieldValue.serverTimestamp(),
        },
        ...(isConfigError ? {} : { rejectionReason: errorMessage }),
      });

      await updateCandidateCompletion(candidateId);

      // Only notify the candidate when the document itself is the problem,
      // not when OCR failed due to a server configuration issue.
      if (!isConfigError) {
        await notifyOcrError(candidateId, documentType, [errorMessage]);
      }
    }
  }
);
