import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { updateCandidateDocument, updateCandidateCompletion, getCandidateById } from '../utils/candidates';
import { validateDocument } from './documentValidator';
import { crossValidateNames, namesMatch } from './nameMatch';
import { ALL_DOCUMENT_TYPES, DOCUMENT_LABELS } from '../utils/documentTypes';

/**
 * Download a file from Cloud Storage and return its buffer and media type.
 * PDFs are passed directly to Claude (no conversion needed — Claude supports PDFs natively).
 */
async function downloadFile(
  bucket: string,
  filePath: string,
  contentType: string,
): Promise<{ buffer: Buffer; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf' }> {
  const storage = getStorage();
  const file = storage.bucket(bucket).file(filePath);
  const [fileBuffer] = await file.download();

  const mediaTypeMap: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf'> = {
    'application/pdf': 'application/pdf',
    'image/jpeg':      'image/jpeg',
    'image/jpg':       'image/jpeg',
    'image/png':       'image/png',
    'image/webp':      'image/webp',
    'image/gif':       'image/gif',
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

    // Photos are auto-approved — no OCR needed
    if (documentType === 'foto_profesional') {
      await updateCandidateDocument(candidateId, documentType, {
        status: 'valid',
        storagePath: filePath,
        ocrResult: {
          rawText: '',
          extractedData: {},
          confidence: 1,
          validationPassed: true,
          validationErrors: [],
          processedAt: FieldValue.serverTimestamp(),
        },
      });
      await updateCandidateCompletion(candidateId);
      return;
    }

    try {
      // Download file for Claude (PDFs sent natively, no conversion needed)
      const { buffer, mediaType } = await downloadFile(
        object.bucket,
        filePath,
        contentType,
      );

      // Fetch candidate once — used for context checks and name validation
      const candidate = await getCandidateById(candidateId);

      // For comprobante_domicilio: load INE address if already validated
      let extraContext: Record<string, string> | undefined;
      if (documentType === 'comprobante_domicilio') {
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

      const extraErrors: string[] = [];

      // Require nombre_completo for documents that must contain it
      if (result.valid && REQUIRES_NAME.includes(documentType) && !result.extractedData.nombre_completo) {
        extraErrors.push('No se pudo leer el nombre del titular en el documento. Asegúrate de que el nombre sea claramente visible y sube la imagen de nuevo.');
      }

      // Validate extracted name against candidate's registered name in Firestore
      if (result.valid && result.extractedData.nombre_completo && candidate) {
        const candidateName = `${(candidate.firstName as string) ?? ''} ${(candidate.lastName as string) ?? ''}`.trim();
        if (candidateName && !namesMatch(result.extractedData.nombre_completo, candidateName)) {
          extraErrors.push(
            `El nombre en el documento ("${result.extractedData.nombre_completo}") no coincide con el nombre del candidato ("${candidateName}"). Verifica que estás subiendo tu propio documento.`
          );
        }
      }

      // Cross-validate name against other valid documents
      let nameErrors: string[] = [];
      if (result.valid && result.extractedData.nombre_completo && candidate) {
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
        storagePath: filePath,
        ocrResult,
        ...(rejectionReason && { rejectionReason }),
      });

      await updateCandidateCompletion(candidateId);
    } catch (err) {
      console.error(`Document validation error for ${candidateId}/${documentType}:`, err);

      const errorMessage = (err as Error).message || 'Error al procesar el documento.';

      // Configuration errors (bad key, auth): mark for manual review — can't process until fixed.
      const isConfigError =
        errorMessage.includes('apiKey') ||
        errorMessage.includes('authToken') ||
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('ANTHROPIC_API_KEY');

      // Rate-limit exhausted after retries, or other transient errors:
      // mark invalid with a friendly "please re-upload" message so the candidate can try again.
      const isTransientError =
        errorMessage.includes('OCR_RATE_LIMIT') ||
        errorMessage.includes('rate_limit') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('429') ||
        errorMessage.includes('tokens per minute') ||
        errorMessage.includes('overloaded');

      const friendlyMessage = 'Hubo un error temporal al procesar tu documento. Por favor vuelve a subirlo.';

      const docStatus = isConfigError ? 'review' : 'invalid';
      const rejectionReason = isConfigError ? undefined : (isTransientError ? friendlyMessage : errorMessage);

      await updateCandidateDocument(candidateId, documentType, {
        status: docStatus,
        ocrResult: {
          rawText: '',
          extractedData: {},
          confidence: 0,
          validationPassed: false,
          validationErrors: [isTransientError ? friendlyMessage : errorMessage],
          processedAt: FieldValue.serverTimestamp(),
        },
        ...(rejectionReason ? { rejectionReason } : {}),
      });

      await updateCandidateCompletion(candidateId);
    }
  }
);
