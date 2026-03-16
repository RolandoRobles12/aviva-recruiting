import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { updateCandidateDocument, updateCandidateCompletion, getCandidateById } from '../utils/candidates';
import { createGmailTransport, getFromAddress } from '../email/gmailClient';
import { ocrErrorTemplate } from '../email/templates';

const DOCUMENT_LABELS: Record<string, string> = {
  ine: 'INE / Identificación oficial',
  curp: 'CURP',
  rfc: 'RFC con homoclave',
  comprobante_domicilio: 'Comprobante de domicilio',
  comprobante_estudios: 'Comprobante de estudios',
};

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

    const transport = await createGmailTransport();
    await transport.sendMail({
      from: getFromAddress(),
      to: candidate.email as string,
      subject,
      html,
    });

    await db.collection('email_logs').add({
      candidateId,
      templateType: 'ocr_error',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: 'ocr_trigger',
      success: true,
      metadata: { documentType, errors },
    });
  } catch (err) {
    // Non-fatal: log but don't throw — OCR result is already saved
    console.error('Failed to send OCR error email:', err);
  }
}

const vision = new ImageAnnotatorClient();

// Validation rules per document type
const VALIDATION_RULES: Record<string, (text: string) => { passed: boolean; errors: string[]; data: Record<string, string> }> = {
  ine: (text) => {
    const errors: string[] = [];
    const data: Record<string, string> = {};
    const normalized = text.toUpperCase();

    // CURP pattern in INE: 18 chars alphanumeric
    const curpMatch = normalized.match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}/);
    if (curpMatch) data['curp'] = curpMatch[0];
    else errors.push('No se detectó un CURP válido en el documento');

    if (!normalized.includes('INSTITUTO NACIONAL ELECTORAL') && !normalized.includes('INE') && !normalized.includes('IFE')) {
      errors.push('No se detectó como documento INE/IFE válido');
    }

    return { passed: errors.length === 0, errors, data };
  },

  curp: (text) => {
    const errors: string[] = [];
    const data: Record<string, string> = {};
    const normalized = text.toUpperCase().replace(/\s/g, '');

    const curpMatch = normalized.match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}/);
    if (curpMatch) {
      data['curp'] = curpMatch[0];
    } else {
      errors.push('No se encontró una CURP válida en el documento');
    }

    if (!normalized.includes('CURP') && !normalized.includes('REGISTRONACIONAL')) {
      errors.push('El documento no parece ser una constancia de CURP oficial');
    }

    return { passed: errors.length === 0, errors, data };
  },

  rfc: (text) => {
    const errors: string[] = [];
    const data: Record<string, string> = {};
    const normalized = text.toUpperCase().replace(/\s/g, '');

    // RFC with homoclave: 12-13 chars
    const rfcMatch = normalized.match(/[A-Z]{3,4}\d{6}[A-Z0-9]{3}/);
    if (rfcMatch) {
      data['rfc'] = rfcMatch[0];
    } else {
      errors.push('No se encontró un RFC con homoclave válido');
    }

    if (!text.toUpperCase().includes('SERVICIO DE ADMINISTRACIÓN TRIBUTARIA') &&
        !text.toUpperCase().includes('SAT') &&
        !text.toUpperCase().includes('RFC')) {
      errors.push('El documento no parece ser emitido por el SAT');
    }

    return { passed: errors.length === 0, errors, data };
  },

  comprobante_domicilio: (text) => {
    const errors: string[] = [];
    const data: Record<string, string> = {};
    const lower = text.toLowerCase();

    const isUtility = ['cfe', 'comisión federal', 'telmex', 'izzi', 'totalplay', 'megacable',
      'cablemás', 'infinitum', 'axtel', 'banco', 'estado de cuenta', 'agua'].some((k) => lower.includes(k));
    if (!isUtility) errors.push('No se reconoce como comprobante de domicilio válido');

    // Try to detect address
    const addressMatch = text.match(/calle|av\.|avenida|blvd\.|boulevard|col\.|colonia/i);
    if (addressMatch) data['address_detected'] = 'true';
    else errors.push('No se detectó una dirección clara en el documento');

    return { passed: errors.length === 0, errors, data };
  },

  comprobante_estudios: (text) => {
    const errors: string[] = [];
    const data: Record<string, string> = {};
    const lower = text.toLowerCase();

    const isStudiesDoc = ['universidad', 'instituto', 'tecnológico', 'escuela', 'título',
      'certificado', 'constancia', 'bachillerato', 'licenciatura', 'maestría', 'doctorado',
      'sep', 'secretaría de educación'].some((k) => lower.includes(k));

    if (!isStudiesDoc) {
      errors.push('No se reconoce como comprobante de estudios válido');
    } else {
      data['studies_detected'] = 'true';
    }

    return { passed: errors.length === 0, errors, data };
  },
};

export const triggerOcrValidation = onCall(
  { region: 'us-central1' },
  async (request) => {
    const { candidateId, documentType, storagePath } = request.data as {
      candidateId: string;
      documentType: string;
      storagePath: string;
    };

    try {
      // Run OCR with Google Cloud Vision
      const gcsUri = `gs://${process.env.GCLOUD_PROJECT}.appspot.com/${storagePath}`;
      const [result] = await vision.textDetection(gcsUri);
      const detections = result.textAnnotations;
      const rawText = detections?.[0]?.description ?? '';

      // Run validation rules
      const validationFn = VALIDATION_RULES[documentType];
      const { passed, errors, data: extractedData } = validationFn
        ? validationFn(rawText)
        : { passed: true, errors: [], data: {} };

      const ocrResult = {
        rawText: rawText.substring(0, 2000), // Limit stored text
        extractedData,
        confidence: detections?.[0] ? 0.85 : 0,
        validationPassed: passed,
        validationErrors: errors,
        processedAt: FieldValue.serverTimestamp(),
      };

      const newStatus = passed ? 'valid' : 'invalid';
      const rejectionReason = errors.length > 0 ? errors.join('. ') : undefined;

      await updateCandidateDocument(candidateId, documentType, {
        status: newStatus,
        ocrResult,
        ...(rejectionReason && { rejectionReason }),
      });

      await updateCandidateCompletion(candidateId);

      return { success: true, result: { passed, errors, extractedData } };
    } catch (err) {
      // Mark as needing manual review on OCR failure
      await updateCandidateDocument(candidateId, documentType, {
        status: 'review',
        ocrResult: {
          rawText: '',
          extractedData: {},
          confidence: 0,
          validationPassed: false,
          validationErrors: ['Error al procesar el OCR. Requiere revisión manual.'],
          processedAt: FieldValue.serverTimestamp(),
        },
      });

      throw new HttpsError('internal', `OCR error: ${(err as Error).message}`);
    }
  }
);

// Storage trigger: auto-run OCR when a document is uploaded
export const onDocumentUploaded = onObjectFinalized(
  { region: 'us-central1' },
  async (event) => {
    const object = event.data;
    const filePath = object.name ?? '';
    // Pattern: candidates/{candidateId}/documents/{documentType}.{ext}
    const match = filePath.match(/^candidates\/([^/]+)\/documents\/([^.]+)\./);
    if (!match) return;

    const [, candidateId, documentType] = match;

    const validTypes = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];
    if (!validTypes.includes(documentType)) return;

    try {
      const gcsUri = `gs://${object.bucket}/${filePath}`;
      const [result] = await vision.textDetection(gcsUri);
      const rawText = result.textAnnotations?.[0]?.description ?? '';

      const validationFn = VALIDATION_RULES[documentType];
      const { passed, errors, data: extractedData } = validationFn
        ? validationFn(rawText)
        : { passed: true, errors: [], data: {} };

      const ocrResult = {
        rawText: rawText.substring(0, 2000),
        extractedData,
        confidence: result.textAnnotations?.[0] ? 0.85 : 0,
        validationPassed: passed,
        validationErrors: errors,
        processedAt: FieldValue.serverTimestamp(),
      };

      await updateCandidateDocument(candidateId, documentType, {
        status: passed ? 'valid' : 'invalid',
        ocrResult,
        ...(errors.length > 0 && { rejectionReason: errors.join('. ') }),
      });

      await updateCandidateCompletion(candidateId);

      // Notify candidate by email when a document fails OCR validation
      if (!passed && errors.length > 0) {
        await notifyOcrError(candidateId, documentType, errors);
      }
    } catch (err) {
      console.error('OCR trigger error:', err);
    }
  }
);
