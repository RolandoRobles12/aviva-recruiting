import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from '../email/gmailClient';
import { offerTemplate, contractTemplate } from '../email/templates';
import { createEmailTicket } from '../integrations/jiraService';
import { getLinkDuration } from '../utils/linkDuration';

// ─── Config params ─────────────────────────────────────────────────────────────
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_WEBHOOK_SECRET = defineString('VITERBIT_WEBHOOK_SECRET', { default: '' });
const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
// Comma-separated job IDs to filter. Leave empty to allow all.
const HIRING_JOB_NAMES = defineString('HIRING_JOB_NAMES', { default: '' });

// Stage names (configurable, matched case-insensitively against webhook payload)
const STAGE_APROBADO     = defineString('STAGE_APROBADO',     { default: 'Aprobado' });
const STAGE_DOCUMENTOS   = defineString('STAGE_DOCUMENTOS',   { default: 'Documentos' });
const STAGE_CONTRATO     = defineString('STAGE_CONTRATO',     { default: 'Contrato' });
const STAGE_CORREOS      = defineString('STAGE_CORREOS',      { default: 'Correos' });
const STAGE_INDUCCION    = defineString('STAGE_INDUCCION',    { default: 'Inducción' });

const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function verifyViterbitSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Strip optional "sha256=" prefix that some webhook providers include
  const normalizedSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(normalizedSignature, 'hex'));
  } catch {
    return false;
  }
}

function buildInitialDocuments() {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [type, { id: type, type, status: 'pending' }])
  );
}

// ─── Viterbit webhook payload parser ──────────────────────────────────────────
// Supports two known Viterbit payload formats:
//
// Format A (spec / newer):
// {
//   "event": "candidature.stage_changed",
//   "data": {
//     "candidature_id": "<candidature_id>",
//     "stage_id": "<stage_id>",
//     "candidate_id": "<candidate_id>",
//     "job_id": "<job_id>",
//     "previous_stage_id": "<prev_stage_id>",
//     "timestamp": "..."
//   }
// }
//
// Format B (legacy / observed):
// {
//   "event": "recruitment_candidature_stage_was_changed",
//   "payload": {
//     "id": "<candidature_id>",
//     "current_stage": { "id": "...", "name": "..." },
//     "candidate_id": "<candidate_id>",
//     "job_id": "<job_id>"
//   }
// }
//
// Candidate name/email are NOT included — must be fetched via API.
interface ParsedViterbitEvent {
  event: string;
  stageName: string;
  stageId: string;
  candidatureId: string;
  candidateViterbitId: string;
  jobId: string;
}

function parseViterbitPayload(body: Record<string, unknown>): ParsedViterbitEvent | null {
  const event = (body.event as string) ?? (body.type as string) ?? '';

  // Support Format A ("data") and Format B ("payload"), falling back to root body.
  const data = (body.data as Record<string, unknown>) ?? (body.payload as Record<string, unknown>) ?? body;

  // Stage info — Format A uses a flat stage_id; Format B uses current_stage object.
  const currentStage = (data.current_stage as Record<string, unknown>) ?? {};
  const stageName = (currentStage.name as string) ?? (currentStage.title as string) ?? '';
  const stageId = (data.stage_id as string) ?? (currentStage.id as string) ?? '';

  // IDs — Format A uses "candidature_id"; Format B uses "id".
  const candidatureId = (data.candidature_id as string) ?? (data.id as string) ?? '';
  const candidateViterbitId = (data.candidate_id as string) ?? '';
  const jobId = (data.job_id as string) ?? '';

  if (!candidateViterbitId) return null;

  return { event, stageName, stageId, candidatureId, candidateViterbitId, jobId };
}

// ─── Viterbit API helpers ──────────────────────────────────────────────────────

interface ViterbitStage {
  id: string;
  name: string;
}

interface ViterbitCandidate {
  name: string;
  email: string;
  phone?: string;
}

interface ViterbitJobInfo {
  title: string;
  stages: ViterbitStage[];
  // Fields from the Viterbit job endpoint
  salary: string;
  startDate: string;
  hiringManager: string;
  company: string;
  departmentProfile: string;
}

/**
 * Fetch job info from Viterbit API.
 *
 * Real Viterbit /jobs/:id response shape:
 *   title: string
 *   salary_min: { amount: number, currency: string }
 *   salary_max: { amount: number, currency: string }
 *   department_profile_id: string
 *   location_id: string
 *   external_id: string
 *   stages: ViterbitStage[]  (when ?includes[]=stages)
 */
async function fetchViterbitJob(jobId: string, apiKey: string): Promise<ViterbitJobInfo> {
  const empty: ViterbitJobInfo = {
    title: '', stages: [],
    salary: '', startDate: '', hiringManager: '', company: '', departmentProfile: '',
  };
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages&includes[]=custom_field_values&includes[]=department_profile`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) return empty;
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

    // Parse salary from salary_min / salary_max objects
    const salaryMin = data.salary_min as { amount?: number; currency?: string } | undefined;
    const salaryMax = data.salary_max as { amount?: number; currency?: string } | undefined;
    let salary = '';
    if (salaryMin?.amount && salaryMax?.amount) {
      const currency = salaryMin.currency ?? 'MXN';
      salary = salaryMin.amount === salaryMax.amount
        ? `$${salaryMin.amount.toLocaleString('es-MX')} ${currency}`
        : `$${salaryMin.amount.toLocaleString('es-MX')} - $${salaryMax.amount.toLocaleString('es-MX')} ${currency}`;
    } else if (salaryMin?.amount) {
      salary = `$${salaryMin.amount.toLocaleString('es-MX')} ${salaryMin.currency ?? 'MXN'}`;
    } else if (salaryMax?.amount) {
      salary = `$${salaryMax.amount.toLocaleString('es-MX')} ${salaryMax.currency ?? 'MXN'}`;
    }

    // Viterbit returns custom fields under custom_field_values (requires includes[]=custom_field_values)
    const custom = (data.custom_field_values as Record<string, unknown>)
      ?? (data.custom_fields as Record<string, unknown>)
      ?? {};
    const getCustom = (key: string): string => {
      const val = custom[key];
      if (val && typeof val === 'object' && 'value' in val) return String((val as Record<string, unknown>).value ?? '');
      return (val as string) ?? (data[key] as string) ?? '';
    };

    // department_profile comes as object when includes[]=department_profile is used
    const deptProfileRaw = data.department_profile;
    const deptProfileObj = (deptProfileRaw && typeof deptProfileRaw === 'object')
      ? deptProfileRaw as Record<string, unknown>
      : undefined;
    const departmentProfile =
      (deptProfileObj?.name as string) ||
      (deptProfileObj?.title as string) ||
      getCustom('job_department_profile') ||
      getCustom('department_profile') ||
      '';

    const title = (data.title as string) || (data.name as string) || '';
    console.log('[viterbit] fetchViterbitJob keys:', Object.keys(data).join(', '));
    console.log('[viterbit] fetchViterbitJob title:', JSON.stringify(title), '| department_profile:', JSON.stringify(deptProfileRaw));

    return {
      title,
      stages: (data.stages as ViterbitStage[]) ?? [],
      salary,
      startDate:      getCustom('hired_start_date_job') || getCustom('start_date') || '',
      hiringManager:  getCustom('custom_job_hiring_manager') || getCustom('hiring_manager') || '',
      company:        getCustom('custom_job_empresa') || getCustom('company') || (data.external_id as string) || 'Aviva',
      departmentProfile,
    };
  } catch (err) {
    console.error('[viterbit] fetchViterbitJob error:', err);
    return empty;
  }
}

async function moveToStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_id: stageId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
  }
}

/**
 * Fetch candidature details to resolve the current stage name.
 * Used when Format A webhooks only provide stage_id without a name.
 */
async function fetchViterbitCandidatureStage(
  candidatureId: string,
  apiKey: string
): Promise<{ stageId: string; stageName: string } | null> {
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/candidatures/${candidatureId}?includes[]=custom_field_values`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) {
      console.error(`[viterbit] fetchCandidatureStage ${candidatureId} → HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const currentStage = (data.current_stage as Record<string, unknown>) ?? {};
    const stageId   = (currentStage.id   as string) ?? '';
    const stageName = (currentStage.name as string) ?? '';
    if (!stageId) return null;
    return { stageId, stageName };
  } catch (err) {
    console.error('[viterbit] fetchCandidatureStage error:', err);
    return null;
  }
}

async function fetchViterbitCandidate(
  candidateId: string,
  apiKey: string
): Promise<ViterbitCandidate | null> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidates/${candidateId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) {
      console.error(`[viterbit] fetchCandidate ${candidateId} → HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

    // Log full response keys and raw name fields to debug Viterbit API shape
    console.log('[viterbit] fetchCandidate response keys:', Object.keys(data));
    console.log('[viterbit] fetchCandidate raw name fields:', JSON.stringify({
      name: data.name,
      first_name: data.first_name,
      last_name: data.last_name,
      surname: data.surname,
      nombre: data.nombre,
      apellido: data.apellido,
      apellidos: data.apellidos,
      full_name: data.full_name,
      fullname: data.fullname,
    }));

    // Try every field name variation Viterbit may use
    const firstName =
      (data.first_name as string) ||
      (data.nombre as string) ||
      '';
    const lastName =
      (data.last_name as string) ||
      (data.surname as string) ||
      (data.apellido as string) ||
      (data.apellidos as string) ||
      '';
    const name =
      (data.name as string) ||
      (data.full_name as string) ||
      (data.fullname as string) ||
      `${firstName} ${lastName}`.trim();

    const email =
      (data.email as string) ||
      (data.correo as string) ||
      '';
    const phone =
      (data.phone as string) ||
      (data.telephone as string) ||
      (data.mobile as string) ||
      undefined;

    console.log('[viterbit] fetchCandidate resolved → name:', name, '| email:', email);

    if (!email) return null;
    return { name, email, phone };
  } catch (err) {
    console.error('[viterbit] fetchCandidate error:', err);
    return null;
  }
}


/** Find the best-matching offer template for a job position */
async function findOfferTemplate(
  position: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const snap = await db.collection('offer_templates').get();
  if (snap.empty) return null;

  const posLower = position.toLowerCase();
  // Try keyword match first
  for (const doc of snap.docs) {
    const data = doc.data();
    const keywords = (data.positionKeywords as string[]) ?? [];
    if (keywords.some((kw) => posLower.includes(kw.toLowerCase()))) {
      return { id: doc.id, data };
    }
  }
  // Fallback to first template
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}

// ─── Stage handlers ────────────────────────────────────────────────────────────

/**
 * Candidate reached "Aprobado":
 * 1. Fetch job stages to get IDs for Oferta Enviada, Documentos, Onboarding
 * 2. Move candidature to "Oferta Enviada" in Viterbit
 * 3. Create candidate record in Firestore (status: offer_sent)
 * 4. Send offer letter email
 */
async function handleAprobado(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference
): Promise<{ action: string; candidateId?: string }> {
  const { candidatureId, candidateViterbitId, jobId } = parsed;

  // Idempotency check
  if (candidatureId) {
    const existing = await db
      .collection('candidates')
      .where('viterbitCandidatureId', '==', candidatureId)
      .limit(1)
      .get();
    if (!existing.empty) {
      const existingId = existing.docs[0].id;
      await logRef.update({ status: 'ignored', reason: 'candidate already exists', candidateId: existingId });
      return { action: 'ignored', candidateId: existingId };
    }
  }

  // Fetch job info (stages + custom fields) and candidate in parallel
  const [viterbitCandidate, jobInfo] = await Promise.all([
    fetchViterbitCandidate(candidateViterbitId, apiKey),
    fetchViterbitJob(jobId, apiKey),
  ]);

  const { title: jobTitle, stages, salary: viterbitSalary, startDate: viterbitStartDate,
    hiringManager: viterbitHiringManager, company: viterbitCompany,
    departmentProfile: viterbitDepartmentProfile } = jobInfo;

  const findStage = (name: string) =>
    stages.find((s) => s.name.toLowerCase().includes(name.toLowerCase()))?.id;

  const ofertaEnviadaId = findStage('Oferta Enviada') ?? findStage('oferta') ?? '';
  const documentosId = findStage(STAGE_DOCUMENTOS.value()) ?? '';
  const contratoId = findStage(STAGE_CONTRATO.value()) ?? '';
  const correosId = findStage(STAGE_CORREOS.value()) ?? '';
  const induccionId = findStage(STAGE_INDUCCION.value()) ?? '';

  // Move to "Oferta Enviada" in Viterbit
  if (ofertaEnviadaId && candidatureId) {
    try {
      await moveToStage(candidatureId, ofertaEnviadaId, apiKey);
    } catch (err) {
      console.error('[webhook] moveToStage ofertaEnviada error:', err);
    }
  }

  if (!viterbitCandidate) {
    await logRef.update({ status: 'error', reason: `could not fetch candidate ${candidateViterbitId}` });
    return { action: 'error' };
  }

  const { name: candidateName, email: candidateEmail, phone: candidatePhone } = viterbitCandidate;
  const nameParts = candidateName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? candidateName;
  const lastName = nameParts.slice(1).join(' ') || '';

  console.log('[webhook] handleAprobado candidate resolved → firstName:', firstName, '| lastName:', lastName, '| email:', candidateEmail);

  // Find best offer template for this position
  const templateMatch = await findOfferTemplate(jobTitle);

  // Create offer token (configurable expiry)
  const linkDurations = await getLinkDuration();
  const offerToken = generateToken();
  const offerExpiresAt = new Date(Date.now() + linkDurations.offerDays * 24 * 60 * 60 * 1000);

  // Create candidate in Firestore
  const candidateRef = db.collection('candidates').doc();
  await candidateRef.set({
    firstName,
    lastName,
    email: candidateEmail,
    phone: candidatePhone ?? null,
    position: jobTitle,
    status: 'offer_sent',
    // Offer fields
    offerToken,
    offerExpiresAt,
    offerTemplateId: templateMatch?.id ?? null,
    // Documents (pre-created so they're ready after signing)
    formToken: null,
    formExpiresAt: null,
    documents: buildInitialDocuments(),
    completionPercentage: 0,
    reminderCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'viterbit_webhook',
    // Viterbit job custom fields (used to interpolate offer letter variables)
    viterbitSalary: viterbitSalary || null,
    viterbitStartDate: viterbitStartDate || null,
    viterbitHiringManager: viterbitHiringManager || null,
    viterbitCompany: viterbitCompany || null,
    viterbitDepartmentProfile: viterbitDepartmentProfile || null,
    // Viterbit IDs
    viterbitCandidatureId: candidatureId || null,
    viterbitJobId: jobId,
    viterbitStageIds: {
      ofertaEnviada: ofertaEnviadaId,
      documentos: documentosId,
      contrato: contratoId,
      correos: correosId,
      induccion: induccionId,
    },
  });

  // Send offer email
  const appUrl = APP_URL.value();
  const offerUrl = `${appUrl}/offer/${offerToken}`;
  const offerExpiresAtStr = format(offerExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

  const { subject, html } = offerTemplate({
    firstName,
    lastName,
    position: jobTitle,
    offerUrl,
    offerExpiresAt: offerExpiresAtStr,
  });

  await sendEmail({ to: candidateEmail, subject, html });

  await db.collection('email_logs').add({
    candidateId: candidateRef.id,
    templateType: 'offer',
    sentTo: candidateEmail,
    sentAt: FieldValue.serverTimestamp(),
    sentBy: 'viterbit_webhook',
    success: true,
  });

  await logRef.update({ status: 'processed', candidateId: candidateRef.id });
  return { action: 'offer_sent', candidateId: candidateRef.id };
}

/**
 * Candidate reached "Documentos" (moved there by signOffer, or manually):
 * - Find existing candidate and ensure status is correct (offer_signed / invited)
 * - If coming from offer flow, status was already updated by signOffer; just log it.
 * - If no candidate exists (legacy / manual), create one and send documents email.
 */
async function handleDocumentos(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference
): Promise<{ action: string; candidateId?: string }> {
  const { candidatureId, candidateViterbitId, jobId } = parsed;

  // Check if candidate already exists (came through offer flow)
  if (candidatureId) {
    const existing = await db
      .collection('candidates')
      .where('viterbitCandidatureId', '==', candidatureId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const existingId = existing.docs[0].id;
      await logRef.update({ status: 'ignored', reason: 'candidate handled by signOffer flow', candidateId: existingId });
      return { action: 'ignored', candidateId: existingId };
    }
  }

  // No existing candidate — create one (manual / legacy path)
  const [viterbitCandidate, jobInfo] = await Promise.all([
    fetchViterbitCandidate(candidateViterbitId, apiKey),
    fetchViterbitJob(jobId, apiKey),
  ]);
  const jobTitle = jobInfo.title;

  if (!viterbitCandidate) {
    await logRef.update({ status: 'error', reason: `could not fetch candidate ${candidateViterbitId}` });
    return { action: 'error' };
  }

  const { name: candidateName, email: candidateEmail, phone: candidatePhone } = viterbitCandidate;
  const nameParts = candidateName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? candidateName;
  const lastName = nameParts.slice(1).join(' ') || '';

  const formToken = generateToken();
  const linkDurations = await getLinkDuration();
  const formExpiresAt = new Date(Date.now() + linkDurations.formDays * 24 * 60 * 60 * 1000);

  const candidateRef = db.collection('candidates').doc();
  await candidateRef.set({
    firstName,
    lastName,
    email: candidateEmail,
    phone: candidatePhone ?? null,
    position: jobTitle,
    status: 'invited',
    formToken,
    formExpiresAt,
    documents: buildInitialDocuments(),
    completionPercentage: 0,
    reminderCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'viterbit_webhook',
    viterbitCandidatureId: candidatureId || null,
    viterbitJobId: jobId,
  });

  const appUrl = APP_URL.value();
  const formUrl = `${appUrl}/form/${formToken}`;
  const formExpiresAtStr = format(formExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

  const { subject, html } = (await import('../email/templates')).invitationTemplate({
    firstName,
    lastName,
    position: jobTitle,
    formUrl,
    formExpiresAt: formExpiresAtStr,
  });

  await sendEmail({ to: candidateEmail, subject, html });

  await db.collection('email_logs').add({
    candidateId: candidateRef.id,
    templateType: 'invitation',
    sentTo: candidateEmail,
    sentAt: FieldValue.serverTimestamp(),
    sentBy: 'viterbit_webhook',
    success: true,
  });

  await logRef.update({ status: 'processed', candidateId: candidateRef.id });
  return { action: 'created', candidateId: candidateRef.id };
}

/** Helper: find existing candidate by candidatureId or email */
async function findCandidateDoc(
  candidatureId: string,
  candidateViterbitId: string,
  apiKey: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData } | null> {
  if (candidatureId) {
    const existing = await db
      .collection('candidates')
      .where('viterbitCandidatureId', '==', candidatureId)
      .limit(1)
      .get();
    if (!existing.empty) {
      return { ref: existing.docs[0].ref, data: existing.docs[0].data() };
    }
  }

  const viterbitCandidate = await fetchViterbitCandidate(candidateViterbitId, apiKey);
  if (viterbitCandidate) {
    const byEmail = await db
      .collection('candidates')
      .where('email', '==', viterbitCandidate.email)
      .limit(1)
      .get();
    if (!byEmail.empty) {
      return { ref: byEmail.docs[0].ref, data: byEmail.docs[0].data() };
    }
  }

  return null;
}

/** Find the best-matching contract template for a job position */
async function findContractTemplate(
  position: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const snap = await db.collection('contract_templates').get();
  if (snap.empty) return null;

  const posLower = position.toLowerCase();
  for (const doc of snap.docs) {
    const data = doc.data();
    const keywords = (data.positionKeywords as string[]) ?? [];
    if (keywords.some((kw) => posLower.includes(kw.toLowerCase()))) {
      return { id: doc.id, data };
    }
  }
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}

/**
 * Candidate reached "Contrato":
 * 1. Generate contract token
 * 2. Send contract signing email
 * 3. Update status to 'contract_sent'
 */
async function handleContrato(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference
): Promise<{ action: string; candidateId?: string }> {
  const { candidatureId, candidateViterbitId } = parsed;

  const found = await findCandidateDoc(candidatureId, candidateViterbitId, apiKey);
  if (!found) {
    await logRef.update({ status: 'ignored', reason: 'no candidate record found for contrato' });
    return { action: 'ignored' };
  }

  const { ref: candidateRef, data: candidate } = found;

  // Find contract template
  const templateMatch = await findContractTemplate(candidate.position as string);

  // Generate contract token
  const contractTokenValue = generateToken();
  const contractLinkDuration = await getLinkDuration();
  const contractExpiresAt = new Date(Date.now() + contractLinkDuration.contractDays * 24 * 60 * 60 * 1000);

  await candidateRef.update({
    status: 'contract_sent',
    contractToken: contractTokenValue,
    contractExpiresAt,
    contractTemplateId: templateMatch?.id ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Send contract email
  const appUrl = APP_URL.value();
  const contractUrl = `${appUrl}/contract/${contractTokenValue}`;
  const contractExpiresAtStr = format(contractExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

  const { subject, html } = contractTemplate({
    firstName: candidate.firstName as string,
    lastName: candidate.lastName as string,
    position: candidate.position as string,
    contractUrl,
    contractExpiresAt: contractExpiresAtStr,
  });

  await sendEmail({ to: candidate.email as string, subject, html });

  await db.collection('email_logs').add({
    candidateId: candidateRef.id,
    templateType: 'contract',
    sentTo: candidate.email,
    sentAt: FieldValue.serverTimestamp(),
    sentBy: 'viterbit_webhook',
    success: true,
  });

  await logRef.update({ status: 'processed', candidateId: candidateRef.id });
  return { action: 'contract_sent', candidateId: candidateRef.id };
}

/**
 * Candidate reached "Correos":
 * 1. Create Jira ticket for IT to create corporate email
 * 2. Update status to 'email_pending'
 */
async function handleCorreos(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference
): Promise<{ action: string; candidateId?: string }> {
  const { candidatureId, candidateViterbitId } = parsed;

  const found = await findCandidateDoc(candidatureId, candidateViterbitId, apiKey);
  if (!found) {
    await logRef.update({ status: 'ignored', reason: 'no candidate record found for correos' });
    return { action: 'ignored' };
  }

  const { ref: candidateRef, data: candidate } = found;

  // Don't create duplicate tickets
  if (candidate.jiraTicketKey) {
    await logRef.update({ status: 'ignored', reason: 'Jira ticket already exists', candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

  // Create Jira ticket
  try {
    const { ticketKey, ticketId } = await createEmailTicket({
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      position: candidate.position as string,
      candidateId: candidateRef.id,
      personalEmail: candidate.email as string,
    });

    await candidateRef.update({
      status: 'email_pending',
      jiraTicketKey: ticketKey,
      jiraTicketId: ticketId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.info(`[webhook] Created Jira ticket ${ticketKey} for ${candidateRef.id}`);
    await logRef.update({ status: 'processed', candidateId: candidateRef.id, jiraTicketKey: ticketKey });
    return { action: 'email_pending', candidateId: candidateRef.id };
  } catch (err) {
    console.error('[webhook] Jira ticket creation failed:', err);
    // Still update status so it can be retried
    await candidateRef.update({
      status: 'email_pending',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logRef.update({ status: 'error', reason: `Jira ticket creation failed: ${err}`, candidateId: candidateRef.id });
    return { action: 'error', candidateId: candidateRef.id };
  }
}

/**
 * Candidate reached "Inducción":
 * - Update status to 'induction'
 * - The induction email is sent by checkEmailTickets when accounts are provisioned.
 *   If manually moved here, just update the status.
 */
async function handleInduccion(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference
): Promise<{ action: string; candidateId?: string }> {
  const { candidatureId, candidateViterbitId } = parsed;

  const found = await findCandidateDoc(candidatureId, candidateViterbitId, apiKey);
  if (!found) {
    await logRef.update({ status: 'ignored', reason: 'no candidate record found for induccion' });
    return { action: 'ignored' };
  }

  const { ref: candidateRef, data: candidate } = found;

  // Only update if not already in induction
  if (candidate.status !== 'induction') {
    await candidateRef.update({
      status: 'induction',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await logRef.update({ status: 'processed', candidateId: candidateRef.id });
  return { action: 'induction', candidateId: candidateRef.id };
}

// ─── Cloud Function ────────────────────────────────────────────────────────────

export const viterbitWebhook = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // Validate Viterbit signature
    const secret = VITERBIT_WEBHOOK_SECRET.value();
    const signature = (req.headers['x-viterbit-signature'] as string) ?? '';
    if (secret) {
      const valid = signature ? verifyViterbitSignature(req.rawBody, signature, secret) : false;
      if (!valid) {
        res.status(401).json({ ok: false, error: 'Invalid signature' });
        return;
      }
    }

    const body = req.body as Record<string, unknown>;

    // Always log raw payload for debugging
    const logRef = await db.collection('viterbit_webhook_logs').add({
      payload: body,
      receivedAt: FieldValue.serverTimestamp(),
    });

    const parsed = parseViterbitPayload(body);
    if (!parsed) {
      await logRef.update({ status: 'ignored', reason: 'could not parse payload' });
      res.status(200).json({ ok: true, action: 'ignored', reason: 'unparseable payload' });
      return;
    }

    const { stageName, stageId, jobId } = parsed;

    const apiKey = VITERBIT_API_KEY.value();
    if (!apiKey) {
      await logRef.update({ status: 'error', reason: 'VITERBIT_API_KEY not configured' });
      res.status(500).json({ ok: false, error: 'Server misconfiguration: missing API key' });
      return;
    }

    // Filter by allowed jobs if configured
    const allowedJobs = HIRING_JOB_NAMES.value()
      .split(',')
      .map((j) => j.trim().toLowerCase())
      .filter(Boolean);
    if (allowedJobs.length > 0) {
      const matchesById = allowedJobs.some((allowed) => jobId.toLowerCase() === allowed);
      if (!matchesById) {
        const jobTitle = (await fetchViterbitJob(jobId, apiKey)).title;
        const matchesByName = allowedJobs.some((allowed) => jobTitle.toLowerCase().includes(allowed));
        if (!matchesByName) {
          await logRef.update({ status: 'ignored', reason: `job "${jobTitle}" (${jobId}) not in allowed list` });
          res.status(200).json({ ok: true, action: 'ignored', reason: `job "${jobId}" not configured` });
          return;
        }
      }
    }

    // Format A webhooks only carry stage_id without a name.
    // Resolve the name by fetching the candidature (recommended flow per Viterbit docs).
    let resolvedStageName = stageName;
    if (!resolvedStageName && parsed.candidatureId) {
      const resolved = await fetchViterbitCandidatureStage(parsed.candidatureId, apiKey);
      if (resolved) {
        resolvedStageName = resolved.stageName;
        console.info(`[webhook] resolved stage name "${resolvedStageName}" from candidature ${parsed.candidatureId}`);
      }
    }

    // Identify which stage was reached (by name or by ID)
    const stageNameLower = resolvedStageName.toLowerCase();
    const stageIdLower = stageId.toLowerCase();

    const matches = (configName: string) => {
      const cfg = configName.toLowerCase();
      return stageNameLower.includes(cfg) || stageIdLower === cfg;
    };

    if (matches(STAGE_APROBADO.value())) {
      const result = await handleAprobado(parsed, apiKey, logRef);
      res.status(200).json({ ok: true, ...result });
    } else if (matches(STAGE_DOCUMENTOS.value())) {
      const result = await handleDocumentos(parsed, apiKey, logRef);
      res.status(200).json({ ok: true, ...result });
    } else if (matches(STAGE_CONTRATO.value())) {
      const result = await handleContrato(parsed, apiKey, logRef);
      res.status(200).json({ ok: true, ...result });
    } else if (matches(STAGE_CORREOS.value())) {
      const result = await handleCorreos(parsed, apiKey, logRef);
      res.status(200).json({ ok: true, ...result });
    } else if (matches(STAGE_INDUCCION.value()) || matches('induccion')) {
      const result = await handleInduccion(parsed, apiKey, logRef);
      res.status(200).json({ ok: true, ...result });
    } else {
      await logRef.update({
        status: 'ignored',
        reason: `stage "${resolvedStageName}" (${stageId}) not handled`,
      });
      res.status(200).json({ ok: true, action: 'ignored', reason: `stage "${resolvedStageName}" skipped` });
    }
  }
);
