/**
 * submitViterbitQuestionnaire
 *
 * Automates completing the "Documentos para tu incorporación a AVIVA" questionnaire
 * in Viterbit on behalf of a candidate, using data already stored in Firestore.
 *
 * Flow:
 *  1. Load candidate from Firestore (formAnswers + document paths).
 *  2. Temporarily swap the candidate's email in Viterbit to an internal address
 *     so the questionnaire-creation email is not visible to the real candidate.
 *  3. Send email/compose with {{ questionnaire_link.<templateId> }} to create the instance.
 *  4. Restore the original email immediately (try/finally).
 *  5. Poll until the questionnaire instance appears on the candidate record.
 *  6. Fetch the template to get each question's ID and type.
 *  7. Submit text/boolean/choice answers in one JSON call.
 *  8. Upload file answers (one multipart POST per file question).
 *
 * Assumed Viterbit API endpoints (update if Viterbit publishes official docs):
 *  - PUT  /v1/candidates/{candidateViterbitId}                       → update email
 *  - POST /v1/candidatures/{candidatureId}/emails                    → compose + send email
 *  - GET  /v1/candidates/{candidateViterbitId}?includes[]=questionnaires → poll for instance
 *  - GET  /v1/questionnaire_templates/{templateId}                   → fetch question definitions
 *  - PUT  /v1/questionnaires/{questionnaireId}                       → submit text answers
 *  - POST /v1/questionnaires/{questionnaireId}/questions/{questionId}/file → upload file answer
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { db } from '../utils/admin';

// ─── Config ────────────────────────────────────────────────────────────────────

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
/** Internal email that receives the questionnaire-creation email instead of the candidate. */
const VITERBIT_INTERNAL_EMAIL = defineString('VITERBIT_INTERNAL_EMAIL');
/** Viterbit questionnaire template ID for "Documentos para tu incorporación a AVIVA". */
const VITERBIT_QUESTIONNAIRE_TEMPLATE_ID = defineString('VITERBIT_QUESTIONNAIRE_TEMPLATE_ID', {
  default: '68c0e99c81ab6c92ec0329bb',
});

const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

// ─── Viterbit types ────────────────────────────────────────────────────────────

type ViterbitQuestionType = 'text' | 'date' | 'single_choice' | 'boolean' | 'long_text' | 'numeric' | 'file';

interface ViterbitQuestionOption {
  id: string;
  label: string;
}

interface ViterbitQuestion {
  id: string;
  label: string;
  type: ViterbitQuestionType;
  options?: ViterbitQuestionOption[];
}

interface ViterbitQuestionnaireTemplate {
  id: string;
  questions: ViterbitQuestion[];
}

interface ViterbitQuestionnaireInstance {
  questionnaire_id: string;
  candidate_id: string;
  job_id: string;
  template: { id: string };
  answers: Record<string, unknown>;
}

// ─── Viterbit API helpers ──────────────────────────────────────────────────────

async function viterbitRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const resp = await fetch(`${VITERBIT_API_BASE}${path}`, {
    method,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: Record<string, unknown> = {};
  try {
    const json = await resp.json() as Record<string, unknown>;
    data = (json.data as Record<string, unknown>) ?? json;
  } catch {
    // non-JSON response
  }
  return { ok: resp.ok, status: resp.status, data };
}

/** Update a candidate's email in Viterbit. */
async function updateCandidateEmail(
  candidateViterbitId: string,
  email: string,
  apiKey: string,
): Promise<void> {
  const result = await viterbitRequest('PUT', `/candidates/${candidateViterbitId}`, apiKey, { email });
  if (!result.ok) {
    throw new Error(`PUT /candidates/${candidateViterbitId} → HTTP ${result.status}`);
  }
}

/**
 * Send an email through Viterbit that contains the questionnaire link marker.
 * This causes Viterbit to create a questionnaire instance for the candidature.
 */
async function sendQuestionnaireEmail(
  candidatureId: string,
  templateId: string,
  apiKey: string,
): Promise<void> {
  const body = {
    subject: 'Documentos para tu incorporación',
    body: `{{ questionnaire_link.${templateId} }}`,
  };
  const result = await viterbitRequest('POST', `/candidatures/${candidatureId}/emails`, apiKey, body);
  if (!result.ok) {
    throw new Error(`POST /candidatures/${candidatureId}/emails → HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  }
}

/**
 * Poll until a questionnaire instance for the given template appears on the candidate,
 * or until maxAttempts is exhausted.
 */
async function pollForQuestionnaire(
  candidateViterbitId: string,
  templateId: string,
  apiKey: string,
  maxAttempts = 8,
  delayMs = 4000,
): Promise<ViterbitQuestionnaireInstance | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? 3000 : delayMs));
    const resp = await fetch(
      `${VITERBIT_API_BASE}/candidates/${candidateViterbitId}?includes[]=questionnaires`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) {
      console.warn(`[submitQuestionnaire] poll attempt ${attempt}: HTTP ${resp.status}`);
      continue;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const questionnaires = (data.questionnaires as ViterbitQuestionnaireInstance[]) ?? [];
    const found = questionnaires.find((q) => q.template?.id === templateId);
    if (found) {
      console.info(`[submitQuestionnaire] questionnaire found on attempt ${attempt}: ${found.questionnaire_id}`);
      return found;
    }
    console.info(`[submitQuestionnaire] poll attempt ${attempt}/${maxAttempts}: instance not yet visible`);
  }
  return null;
}

/** Fetch the questionnaire template to get the full question list with IDs. */
async function fetchQuestionnaireTemplate(
  templateId: string,
  apiKey: string,
): Promise<ViterbitQuestionnaireTemplate | null> {
  const result = await viterbitRequest('GET', `/questionnaire_templates/${templateId}`, apiKey);
  if (!result.ok) {
    console.error(`[submitQuestionnaire] fetchQuestionnaireTemplate → HTTP ${result.status}`);
    return null;
  }
  const questions = (result.data.questions as ViterbitQuestion[]) ?? [];
  return { id: templateId, questions };
}

/** Submit all non-file answers in a single PUT call. */
async function submitTextAnswers(
  questionnaireId: string,
  answers: Record<string, unknown>,
  apiKey: string,
): Promise<void> {
  const result = await viterbitRequest('PUT', `/questionnaires/${questionnaireId}`, apiKey, { answers });
  if (!result.ok) {
    throw new Error(`PUT /questionnaires/${questionnaireId} → HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  }
}

/** Upload a single file answer for a questionnaire question. */
async function uploadFileAnswer(
  questionnaireId: string,
  questionId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
): Promise<void> {
  const form = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  form.append('file', blob, fileName);

  const resp = await fetch(
    `${VITERBIT_API_BASE}/questionnaires/${questionnaireId}/questions/${questionId}/file`,
    {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: form,
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `POST /questionnaires/${questionnaireId}/questions/${questionId}/file → HTTP ${resp.status}: ${text}`,
    );
  }
}

// ─── Answer mapping ────────────────────────────────────────────────────────────

/**
 * Maps a Viterbit question label to the value we can supply from Firestore data.
 * Uses substring matching (case-insensitive) against known question labels.
 * Returns null when we have no data for that question, causing it to be skipped.
 */
function resolveTextAnswer(
  question: ViterbitQuestion,
  formAnswers: Record<string, unknown>,
  customAnswers: Record<string, string>,
): unknown | null {
  const lbl = question.label.toLowerCase();

  if (lbl.includes('género') || lbl.includes('genero')) {
    return customAnswers['genero'] ?? customAnswers['gender'] ?? customAnswers['sexo'] ?? null;
  }
  if (lbl.includes('fecha de nacimiento') || lbl.includes('nacimiento')) {
    return customAnswers['fechaNacimiento'] ?? customAnswers['fecha_nacimiento'] ?? customAnswers['birthDate'] ?? null;
  }
  if (lbl.includes('estado civil')) {
    const map: Record<string, string> = { soltero: 'Soltero/a', casado: 'Casado/a', union_libre: 'Unión libre' };
    const v = formAnswers['estadoCivil'] as string | undefined;
    return v ? (map[v] ?? v) : null;
  }
  if (lbl.includes('hijos')) {
    return formAnswers['tieneHijos'] ?? null;
  }
  if (lbl.includes('infonavit')) {
    return formAnswers['tieneInfonavit'] ?? null;
  }
  if (lbl.includes('fonacot')) {
    return formAnswers['tieneFonacot'] ?? null;
  }
  if (lbl.includes('talla')) {
    return formAnswers['tallaPlayera'] ?? null;
  }
  if (lbl.includes('sobre ti') || lbl.includes('cuéntanos')) {
    return formAnswers['sobreTi'] ?? null;
  }
  if (lbl.includes('entidad financiera') || lbl.includes('financiera')) {
    return formAnswers['trabajoEntidadFinanciera'] ?? null;
  }
  if (lbl.includes('nombre') && lbl.includes('beneficiario')) {
    return formAnswers['beneficiarioNombre'] ?? null;
  }
  if (lbl.includes('teléfono') && lbl.includes('beneficiario')) {
    return formAnswers['beneficiarioTelefono'] ?? null;
  }
  if ((lbl.includes('correo') || lbl.includes('email')) && lbl.includes('beneficiario')) {
    return formAnswers['beneficiarioCorreo'] ?? null;
  }
  return null;
}

/** Maps a Viterbit file question label to the Firestore document type key. */
function resolveFileDocumentType(label: string): string | null {
  const lbl = label.toLowerCase();
  if (lbl.includes('aviso de retenci')) return 'aviso_retencion';
  if (lbl.includes('fonacot') && lbl.includes('cuenta')) return 'estado_cuenta_fonacot';
  if (lbl.includes('foto') || lbl.includes('fotografía')) return 'foto_profesional';
  if (lbl.includes('acta de nacimiento')) return 'acta_nacimiento';
  if (lbl.includes('curp')) return 'curp';
  if (lbl.includes('seguridad social') || lbl.includes('nss')) return 'nss';
  if (lbl.includes('ine') || lbl.includes('credencial')) return 'ine';
  if (lbl.includes('comprobante de domicilio') || lbl.includes('domicilio')) return 'comprobante_domicilio';
  return null;
}

// ─── Callable function ─────────────────────────────────────────────────────────

export const submitViterbitQuestionnaire = onCall(
  { region: 'us-central1', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId requerido');

    // ── 1. Load candidate from Firestore ────────────────────────────────────────
    const snap = await db.collection('candidates').doc(candidateId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato no encontrado');

    const candidate = snap.data()!;
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;
    let candidateViterbitId = candidate.viterbitCandidateId as string | undefined;

    if (!candidatureId) {
      throw new HttpsError('failed-precondition', 'El candidato no tiene viterbitCandidatureId.');
    }

    const apiKey = VITERBIT_API_KEY.value();
    const internalEmail = VITERBIT_INTERNAL_EMAIL.value();
    const templateId = VITERBIT_QUESTIONNAIRE_TEMPLATE_ID.value();

    if (!internalEmail) {
      throw new HttpsError('failed-precondition', 'VITERBIT_INTERNAL_EMAIL no configurado.');
    }

    // Resolve candidateViterbitId from candidature if not yet stored
    if (!candidateViterbitId) {
      const candidatureResp = await fetch(
        `${VITERBIT_API_BASE}/candidatures/${candidatureId}`,
        { headers: { 'X-API-Key': apiKey } },
      );
      if (!candidatureResp.ok) {
        throw new HttpsError('unavailable', `No se pudo obtener la candidatura: HTTP ${candidatureResp.status}`);
      }
      const candidatureJson = (await candidatureResp.json()) as Record<string, unknown>;
      const candidatureData = (candidatureJson.data as Record<string, unknown>) ?? candidatureJson;
      candidateViterbitId = (candidatureData.candidate_id as string) ?? '';
      if (candidateViterbitId) {
        await snap.ref.update({ viterbitCandidateId: candidateViterbitId, updatedAt: FieldValue.serverTimestamp() });
      }
    }

    if (!candidateViterbitId) {
      throw new HttpsError('failed-precondition', 'No se pudo resolver el candidateViterbitId.');
    }

    // ── 2. Resolve original email from Viterbit ─────────────────────────────────
    const candidateApiResp = await fetch(
      `${VITERBIT_API_BASE}/candidates/${candidateViterbitId}`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!candidateApiResp.ok) {
      throw new HttpsError('unavailable', `No se pudo obtener el candidato en Viterbit: HTTP ${candidateApiResp.status}`);
    }
    const candidateApiJson = (await candidateApiResp.json()) as Record<string, unknown>;
    const candidateApiData = (candidateApiJson.data as Record<string, unknown>) ?? candidateApiJson;
    const originalEmail = (candidateApiData.email as string) ?? candidate.email as string;

    console.info(`[submitQuestionnaire] candidateId=${candidateId} candidatureId=${candidatureId} originalEmail=${originalEmail}`);

    // Log progress to Firestore so recruiters can see what's happening
    const logRef = await db.collection('questionnaire_automation_logs').add({
      candidateId,
      candidatureId,
      templateId,
      startedAt: FieldValue.serverTimestamp(),
      startedBy: request.auth.uid,
      status: 'started',
    });

    let questionnaireInstance: ViterbitQuestionnaireInstance | null = null;

    // ── 3–4. Swap email → generate questionnaire → restore email ───────────────
    try {
      console.info(`[submitQuestionnaire] swapping email to internal: ${internalEmail}`);
      await updateCandidateEmail(candidateViterbitId, internalEmail, apiKey);
      await logRef.update({ emailSwapped: true });

      console.info(`[submitQuestionnaire] sending questionnaire email for candidature ${candidatureId}`);
      await sendQuestionnaireEmail(candidatureId, templateId, apiKey);
      await logRef.update({ emailSent: true });
    } finally {
      // Always restore the original email, even on error
      try {
        await updateCandidateEmail(candidateViterbitId, originalEmail, apiKey);
        console.info(`[submitQuestionnaire] original email restored: ${originalEmail}`);
        await logRef.update({ emailRestored: true });
      } catch (restoreErr) {
        console.error('[submitQuestionnaire] CRITICAL: failed to restore original email:', restoreErr);
        await logRef.update({ emailRestoreError: String(restoreErr) });
        // Don't swallow — recruiters need to know
        throw new HttpsError(
          'internal',
          `El email del candidato NO fue restaurado automáticamente. Email actual: ${internalEmail}. Email original: ${originalEmail}. Error: ${restoreErr}`,
        );
      }
    }

    // ── 5. Poll for questionnaire instance ──────────────────────────────────────
    console.info('[submitQuestionnaire] polling for questionnaire instance...');
    questionnaireInstance = await pollForQuestionnaire(candidateViterbitId, templateId, apiKey);
    if (!questionnaireInstance) {
      await logRef.update({ status: 'error', error: 'questionnaire instance not found after polling' });
      throw new HttpsError(
        'deadline-exceeded',
        'La instancia del cuestionario no apareció en Viterbit después de varios intentos. ' +
        'Verifica que el email fue recibido en la bandeja interna y vuelve a intentar.',
      );
    }

    const questionnaireId = questionnaireInstance.questionnaire_id;
    await logRef.update({ questionnaireId, status: 'instance_found' });

    // ── 6. Fetch template to get question IDs ───────────────────────────────────
    const template = await fetchQuestionnaireTemplate(templateId, apiKey);
    if (!template || template.questions.length === 0) {
      await logRef.update({ status: 'error', error: 'could not fetch questionnaire template' });
      throw new HttpsError('unavailable', 'No se pudo obtener la plantilla del cuestionario de Viterbit.');
    }

    console.info(`[submitQuestionnaire] template has ${template.questions.length} questions`);

    // ── 7. Build answers payload ────────────────────────────────────────────────
    const formAnswers = (candidate.formAnswers as Record<string, unknown>) ?? {};
    const customAnswers = (formAnswers['customAnswers'] as Record<string, string>) ?? {};
    const documents = (candidate.documents as Record<string, Record<string, unknown>>) ?? {};

    const textAnswers: Record<string, unknown> = {};
    const fileQuestions: Array<{ question: ViterbitQuestion; docType: string }> = [];

    for (const question of template.questions) {
      if (question.type === 'file') {
        const docType = resolveFileDocumentType(question.label);
        if (docType) fileQuestions.push({ question, docType });
        continue;
      }
      const value = resolveTextAnswer(question, formAnswers, customAnswers);
      if (value !== null && value !== undefined) {
        // For single_choice, find the option ID that matches the value label
        if (question.type === 'single_choice' && question.options?.length) {
          const valStr = String(value).toLowerCase();
          const matched = question.options.find(
            (o) => o.label.toLowerCase().includes(valStr) || valStr.includes(o.label.toLowerCase()),
          );
          textAnswers[question.id] = matched?.id ?? value;
        } else {
          textAnswers[question.id] = value;
        }
      }
    }

    // ── 8. Submit text/boolean/choice answers ───────────────────────────────────
    if (Object.keys(textAnswers).length > 0) {
      console.info(`[submitQuestionnaire] submitting ${Object.keys(textAnswers).length} text answers`);
      await submitTextAnswers(questionnaireId, textAnswers, apiKey);
      await logRef.update({ textAnswersSubmitted: Object.keys(textAnswers).length });
    }

    // ── 9. Upload file answers ──────────────────────────────────────────────────
    const storage = getStorage();
    const fileResults: Record<string, string> = {};

    for (const { question, docType } of fileQuestions) {
      const doc = documents[docType];
      if (!doc?.storagePath) {
        console.warn(`[submitQuestionnaire] no file for doc type "${docType}" — skipping question "${question.label}"`);
        fileResults[docType] = 'skipped_no_file';
        continue;
      }

      try {
        const storagePath = doc.storagePath as string;
        const fileName = (doc.fileName as string) ?? storagePath.split('/').pop() ?? 'document';
        const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
        const mimeType =
          ext === 'pdf' ? 'application/pdf' :
          ext === 'png' ? 'image/png' :
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
          ext === 'webp' ? 'image/webp' :
          'application/octet-stream';

        const [fileContents] = await storage.bucket().file(storagePath).download();
        const fileBuffer = Buffer.from(fileContents);

        console.info(`[submitQuestionnaire] uploading "${fileName}" (${fileBuffer.length} bytes) for question "${question.label}"`);
        await uploadFileAnswer(questionnaireId, question.id, fileBuffer, fileName, mimeType, apiKey);
        fileResults[docType] = 'uploaded';
      } catch (fileErr) {
        console.error(`[submitQuestionnaire] file upload error for ${docType}:`, fileErr);
        fileResults[docType] = `error: ${fileErr}`;
      }
    }

    await logRef.update({
      status: 'completed',
      fileResults,
      completedAt: FieldValue.serverTimestamp(),
    });

    console.info(`[submitQuestionnaire] completed for candidate ${candidateId}`);
    return {
      success: true,
      questionnaireId,
      textAnswersSubmitted: Object.keys(textAnswers).length,
      fileResults,
    };
  },
);
