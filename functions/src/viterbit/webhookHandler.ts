import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from '../email/gmailClient';
import { offerTemplate, contractTemplate, invitationTemplate as _invitationTemplate } from '../email/templates';
import { getLogoUrl } from '../utils/branding';
import { createEmailTicket } from '../integrations/jiraService';
import { getLinkDuration } from '../utils/linkDuration';
import { DOCUMENT_TYPES_REQUIRED } from '../utils/documentTypes';

// ─── Config params ─────────────────────────────────────────────────────────────
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
// Comma-separated department profile names to process. Leave empty to allow all.
const HIRING_PROFILES = defineString('HIRING_PROFILES', {
  default: 'Trainee Sucursal (Kiosk Trainee),Gerente de Sucursal (Kiosk Manager),Promotor/a Aviva tu Negocio,Promotor/a Aviva tu Compra',
});

// Stage names (configurable, matched case-insensitively against webhook payload)
const STAGE_APROBADO     = defineString('STAGE_APROBADO',     { default: 'Aprobado' });
const STAGE_DOCUMENTOS   = defineString('STAGE_DOCUMENTOS',   { default: 'Documentos' });
const STAGE_CONTRATO     = defineString('STAGE_CONTRATO',     { default: 'Contrato' });
const STAGE_CORREOS      = defineString('STAGE_CORREOS',      { default: 'Correo corporativo' });
const STAGE_INDUCCION    = defineString('STAGE_INDUCCION',    { default: 'Onboarding' });

const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function buildInitialDocuments() {
  return Object.fromEntries(
    DOCUMENT_TYPES_REQUIRED.map((type) => [type, { id: type, type, status: 'pending' }])
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
export interface ParsedViterbitEvent {
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
  reference?: string;
  contrasena?: string;
}

interface ViterbitJobInfo {
  title: string;
  stages: ViterbitStage[];
  hiringManagerId: string;
  company: string;
  departmentProfile: string;
}

interface ViterbitCandidatureInfo {
  stageId: string;
  stageName: string;
  salary: string;
  startDate: string;
  jobId: string;
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
    title: '', stages: [], hiringManagerId: '', company: '', departmentProfile: '',
  };
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages&includes[]=custom_field_values`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) return empty;
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

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
    let departmentProfile =
      (deptProfileObj?.name as string) ||
      (deptProfileObj?.title as string) ||
      getCustom('job_department_profile') ||
      getCustom('department_profile') ||
      '';

    // Two-step fallback: includes[]=department_profile often returns null.
    // Use department_id + department_profile_id to fetch the profile list and resolve the name.
    if (!departmentProfile) {
      const deptId = (data.department_id as string) || '';
      const profileId = (data.department_profile_id as string) || '';
      console.log('[viterbit] fetchViterbitJob profile fallback: deptId=', deptId, 'profileId=', profileId);
      if (deptId && profileId) {
        try {
          const profResp = await fetch(
            `${VITERBIT_API_BASE}/departments/${deptId}/profiles`,
            { headers: { 'X-API-Key': apiKey } },
          );
          if (profResp.ok) {
            const profJson = (await profResp.json()) as Record<string, unknown>;
            const profiles =
              (profJson.data as Array<Record<string, unknown>>) ??
              (Array.isArray(profJson) ? profJson as Array<Record<string, unknown>> : []);
            const matched = profiles.find(
              (p) => String(p.id) === String(profileId),
            );
            if (matched) {
              departmentProfile = (matched.name as string) || (matched.title as string) || '';
              console.log('[viterbit] fetchViterbitJob resolved profile via dept endpoint:', departmentProfile);
            } else {
              console.log('[viterbit] fetchViterbitJob dept profiles:', JSON.stringify(profiles.map((p) => ({ id: p.id, name: p.name }))));
            }
          } else {
            console.error('[viterbit] fetchViterbitJob dept profiles HTTP', profResp.status);
          }
        } catch (profErr) {
          console.error('[viterbit] fetchViterbitJob dept profiles error:', profErr);
        }
      }
    }

    const title = (data.title as string) || (data.name as string) || '';
    console.log('[viterbit] fetchViterbitJob keys:', Object.keys(data).join(', '));
    console.log('[viterbit] fetchViterbitJob title:', JSON.stringify(title), '| department_profile:', JSON.stringify(deptProfileRaw), '| resolved:', JSON.stringify(departmentProfile));

    return {
      title,
      stages: (data.stages as ViterbitStage[]) ?? [],
      hiringManagerId: getCustom('hiring_manager'),
      company:         getCustom('empresa') || getCustom('custom_job_empresa') || getCustom('company') || 'Aviva',
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

async function fetchViterbitCandidature(
  candidatureId: string,
  apiKey: string
): Promise<ViterbitCandidatureInfo | null> {
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/candidatures/${candidatureId}`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) {
      console.error(`[viterbit] fetchViterbitCandidature ${candidatureId} → HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

    const currentStage = (data.current_stage as Record<string, unknown>) ?? {};
    const stageId   = (currentStage.id   as string) ?? '';
    const stageName = (currentStage.name as string) ?? '';
    const jobId = (data.job_id as string) ?? '';

    const hiredInfo = (data.hired_info as Record<string, unknown>) ?? {};
    const salaryAmount = hiredInfo.salary as number | undefined;
    const currency = (hiredInfo.currency as string) ?? 'MXN';
    const salary = salaryAmount ? `$${salaryAmount.toLocaleString('es-MX')} ${currency}` : '';
    const startDate = (hiredInfo.start_at as string) ?? '';

    if (!stageId && !jobId) return null;
    return { stageId, stageName, salary, startDate, jobId };
  } catch (err) {
    console.error('[viterbit] fetchViterbitCandidature error:', err);
    return null;
  }
}

async function fetchViterbitUser(userId: string, apiKey: string): Promise<string> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/users/${userId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return '';
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    return (data.full_name as string) ?? '';
  } catch (err) {
    console.error('[viterbit] fetchViterbitUser error:', err);
    return '';
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
      (data.full_name as string) ||
      (data.name as string) ||
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

    const reference = (data.reference as string) || undefined;

    // Extract contrasena_correo_corporativo — Viterbit may return custom_field_values as
    // an array [{field_id, name, value}] or as a record {key: {value} | string}
    let contrasena: string | undefined;
    const rawCustom = data.custom_field_values;
    if (Array.isArray(rawCustom)) {
      contrasena = (rawCustom as Array<{ field_id?: string; name?: string; value?: string }>).find(
        f => f.field_id === 'contrasena_correo_corporativo' || f.name === 'contrasena_correo_corporativo',
      )?.value;
    } else if (rawCustom && typeof rawCustom === 'object') {
      const rec = rawCustom as Record<string, unknown>;
      const val = rec['contrasena_correo_corporativo'];
      contrasena = (val && typeof val === 'object' && 'value' in val)
        ? String((val as Record<string, unknown>).value ?? '')
        : (val as string) || undefined;
    }
    contrasena = contrasena || (data.contrasena_correo_corporativo as string) || undefined;

    return { name, email, phone, reference, contrasena };
  } catch (err) {
    console.error('[viterbit] fetchCandidate error:', err);
    return null;
  }
}


/** Find the best-matching offer template.
 *  Priority: 1. exact profile name match, 2. positionKeywords, 3. first template. */
async function findOfferTemplate(
  position: string,
  profile?: string,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const snap = await db.collection('offer_templates').get();
  if (snap.empty) return null;

  // 1. Profile-name match (primary — most precise)
  if (profile) {
    for (const doc of snap.docs) {
      const data = doc.data();
      const profileNames = (data.profileNames as string[]) ?? [];
      if (profileNames.includes(profile)) return { id: doc.id, data };
    }
  }

  // 2. positionKeywords fallback (legacy / non-Viterbit)
  const posLower = position.toLowerCase();
  for (const doc of snap.docs) {
    const data = doc.data();
    const keywords = (data.positionKeywords as string[]) ?? [];
    if (keywords.some((kw) => posLower.includes(kw.toLowerCase()))) {
      return { id: doc.id, data };
    }
  }

  // 3. First template
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
export async function handleAprobado(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference
): Promise<{ action: string; candidateId?: string; reason?: string }> {
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

  // Fetch candidature first to resolve jobId if missing from webhook payload
  const candidatureInfo = candidatureId
    ? await fetchViterbitCandidature(candidatureId, apiKey)
    : null;

  const resolvedJobId = jobId || candidatureInfo?.jobId || '';
  console.log(`[webhook] handleAprobado jobId="${jobId}" resolvedJobId="${resolvedJobId}"`);

  // Fetch candidate and job in parallel with resolved jobId
  const [viterbitCandidate, jobInfo] = await Promise.all([
    fetchViterbitCandidate(candidateViterbitId, apiKey),
    fetchViterbitJob(resolvedJobId, apiKey),
  ]);

  const { title: jobTitle, stages, hiringManagerId,
    company: viterbitCompany, departmentProfile: viterbitDepartmentProfile } = jobInfo;

  const viterbitHiringManager = hiringManagerId
    ? await fetchViterbitUser(hiringManagerId, apiKey)
    : '';
  const viterbitSalary = candidatureInfo?.salary ?? '';
  const rawStartDate   = candidatureInfo?.startDate ?? '';
  const viterbitStartDate = rawStartDate
    ? format(new Date(rawStartDate), "d 'de' MMMM 'de' yyyy", { locale: es })
    : '';

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

  const { name: candidateName, email: candidateEmail, phone: candidatePhone, reference: viterbitReference, contrasena: viterbitContrasena } = viterbitCandidate;
  const nameParts = candidateName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? candidateName;
  const lastName = nameParts.slice(1).join(' ') || '';

  console.log('[webhook] handleAprobado candidate resolved → firstName:', firstName, '| lastName:', lastName, '| email:', candidateEmail);

  // Secondary idempotency check by email + jobId — catches race conditions where two
  // simultaneous webhooks both pass the first check before either creates the record.
  if (candidateEmail && resolvedJobId) {
    const emailCheck = await db
      .collection('candidates')
      .where('email', '==', candidateEmail)
      .where('viterbitJobId', '==', resolvedJobId)
      .limit(1)
      .get();
    if (!emailCheck.empty) {
      const existingId = emailCheck.docs[0].id;
      await logRef.update({ status: 'ignored', reason: 'candidate already exists (email+job)', candidateId: existingId });
      return { action: 'ignored', candidateId: existingId };
    }
  }

  // Find best offer template — profile-name match takes priority
  const templateMatch = await findOfferTemplate(jobTitle, viterbitDepartmentProfile || undefined);

  // Create offer token (configurable expiry)
  const linkDurations = await getLinkDuration();
  const offerToken = generateToken();
  const offerExpiresAt = new Date(Date.now() + linkDurations.offerDays * 24 * 60 * 60 * 1000);

  // Create candidate in Firestore.
  // Using candidatureId as document ID guarantees uniqueness at the DB level —
  // a concurrent duplicate webhook will simply overwrite the same document
  // instead of creating a second record.
  const candidateRef = candidatureId
    ? db.collection('candidates').doc(candidatureId)
    : db.collection('candidates').doc();
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
    offerEmailSent: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'viterbit_webhook',
    // Canonical profile (same as viterbitDepartmentProfile for webhook candidates)
    profile: viterbitDepartmentProfile || null,
    // Viterbit job custom fields (used to interpolate offer letter variables)
    viterbitSalary: viterbitSalary || null,
    viterbitStartDate: viterbitStartDate || null,
    viterbitHiringManager: viterbitHiringManager || null,
    viterbitCompany: viterbitCompany || null,
    viterbitDepartmentProfile: viterbitDepartmentProfile || null,
    // Viterbit IDs
    viterbitCandidateId: candidateViterbitId || null,
    viterbitCandidatureId: candidatureId || null,
    viterbitReference: viterbitReference || null,
    viterbitContrasena: viterbitContrasena || null,
    viterbitJobId: resolvedJobId,
    viterbitStageIds: {
      ofertaEnviada: ofertaEnviadaId,
      documentos: documentosId,
      contrato: contratoId,
      induccion: induccionId || correosId, // correos stage removed; fallback for legacy candidates
    },
  });

  // Send offer email — only when all required hiring details are present.
  // If missing, the candidate is created but the offer is held so the recruiter
  // can refresh the data in Viterbit and resend manually.
  const appUrl = APP_URL.value();
  const offerUrl = `${appUrl}/offer/${offerToken}`;
  const offerExpiresAtStr = format(offerExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

  if (!viterbitSalary || !viterbitStartDate) {
    const missing = [!viterbitSalary && 'salario', !viterbitStartDate && 'fecha de inicio'].filter(Boolean).join(' y ');
    console.warn(`[webhook] handleAprobado offer NOT sent — missing hiring details (${missing}) for candidate ${candidateRef.id}`);
    await candidateRef.update({ status: 'offer_held', offerEmailSent: false, updatedAt: FieldValue.serverTimestamp() });
    await logRef.update({ status: 'processed', candidateId: candidateRef.id, offerHeld: true, offerHeldReason: `missing: ${missing}` });
    return { action: 'offer_held', candidateId: candidateRef.id, reason: `missing hiring details: ${missing}` };
  }

  const logoUrl = await getLogoUrl();
  const { subject, html } = offerTemplate({
    firstName,
    lastName,
    position: jobTitle,
    offerUrl,
    offerExpiresAt: offerExpiresAtStr,
    logoUrl,
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

  const { name: candidateName, email: candidateEmail, phone: candidatePhone, reference: viterbitReference, contrasena: viterbitContrasena } = viterbitCandidate;
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
    viterbitCandidateId: candidateViterbitId || null,
    viterbitCandidatureId: candidatureId || null,
    viterbitReference: viterbitReference || null,
    viterbitContrasena: viterbitContrasena || null,
    viterbitJobId: jobId,
  });

  const appUrl = APP_URL.value();
  const formUrl = `${appUrl}/form/${formToken}`;
  const formExpiresAtStr = format(formExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

  const invLogoUrl = await getLogoUrl();
  const { subject, html } = _invitationTemplate({
    firstName,
    lastName,
    position: jobTitle,
    formUrl,
    formExpiresAt: formExpiresAtStr,
  }, undefined, invLogoUrl);

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

  // Idempotency: skip if contract already sent or signed
  if (candidate.contractToken || candidate.contractSignedAt) {
    await logRef.update({ status: 'ignored', reason: 'contract already sent or signed', candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

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

  const contractLogoUrl = await getLogoUrl();
  const { subject, html } = contractTemplate({
    firstName: candidate.firstName as string,
    lastName: candidate.lastName as string,
    position: candidate.position as string,
    contractUrl,
    contractExpiresAt: contractExpiresAtStr,
    logoUrl: contractLogoUrl,
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
 * Candidate reached "Onboarding" (previously went through a separate Correos stage):
 * 1. Create Jira ticket for IT to provision corporate email
 * 2. Update status to 'email_pending' / 'induction'
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

  // Don't create duplicate Jira tickets
  if (candidate.jiraTicketKey) {
    if (candidate.status !== 'induction' && candidate.status !== 'email_pending') {
      await candidateRef.update({ status: 'induction', updatedAt: FieldValue.serverTimestamp() });
    }
    await logRef.update({ status: 'ignored', reason: 'Jira ticket already exists', candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

  // Create Jira ticket for corporate email provisioning
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
    console.error('[webhook] Jira ticket creation failed at onboarding stage:', err);
    await candidateRef.update({ status: 'induction', updatedAt: FieldValue.serverTimestamp() });
    await logRef.update({ status: 'error', reason: `Jira ticket creation failed: ${err}`, candidateId: candidateRef.id });
    return { action: 'induction', candidateId: candidateRef.id };
  }
}

// ─── Cloud Function ────────────────────────────────────────────────────────────

export const viterbitWebhook = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const body = req.body as Record<string, unknown>;

    try {
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

      // Filter by allowed department profiles if configured
      const allowedProfiles = HIRING_PROFILES.value()
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      if (allowedProfiles.length > 0) {
        const jobInfo = await fetchViterbitJob(jobId, apiKey);
        const profile = jobInfo.departmentProfile.toLowerCase();
        if (!allowedProfiles.some((allowed) => profile.includes(allowed))) {
          await logRef.update({ status: 'ignored', reason: `profile "${jobInfo.departmentProfile}" not in allowed list` });
          res.status(200).json({ ok: true, action: 'ignored', reason: `profile "${jobInfo.departmentProfile}" not configured` });
          return;
        }
      }

      // Format A webhooks only carry stage_id without a name.
      // Resolve the name by fetching the candidature (recommended flow per Viterbit docs).
      let resolvedStageName = stageName;
      if (!resolvedStageName && parsed.candidatureId) {
        const resolved = await fetchViterbitCandidature(parsed.candidatureId, apiKey);
        if (resolved?.stageName) {
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
        // Delay processing 3 minutes so Viterbit has time to populate hired_info
        const processAfter = new Date(Date.now() + 3 * 60 * 1000);
        await db.collection('pending_approvals').add({
          parsed,
          processAfter: Timestamp.fromDate(processAfter),
          processed: false,
          logId: logRef.id,
          queuedAt: FieldValue.serverTimestamp(),
        });
        await logRef.update({ status: 'queued', processAfter });
        res.status(200).json({ ok: true, action: 'queued', processAfter });
      } else if (matches(STAGE_DOCUMENTOS.value())) {
        const result = await handleDocumentos(parsed, apiKey, logRef);
        res.status(200).json({ ok: true, ...result });
      } else if (matches(STAGE_CONTRATO.value())) {
        const result = await handleContrato(parsed, apiKey, logRef);
        res.status(200).json({ ok: true, ...result });
      } else if (matches(STAGE_INDUCCION.value()) || matches('induccion') || matches('onboarding') || matches(STAGE_CORREOS.value())) {
        const result = await handleInduccion(parsed, apiKey, logRef);
        res.status(200).json({ ok: true, ...result });
      } else {
        await logRef.update({
          status: 'ignored',
          reason: `stage "${resolvedStageName}" (${stageId}) not handled`,
        });
        res.status(200).json({ ok: true, action: 'ignored', reason: `stage "${resolvedStageName}" skipped` });
      }
    } catch (err) {
      console.error('[viterbitWebhook] Unhandled error:', err);
      res.status(200).json({ ok: false, error: 'Internal error', detail: String(err) });
    }
  }
);
