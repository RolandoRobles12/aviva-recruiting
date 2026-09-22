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
import { getLinkDuration } from '../utils/linkDuration';
import { DOCUMENT_TYPES_REQUIRED } from '../utils/documentTypes';
import { getAllowedHiringProfiles } from '../utils/hiringProfiles';
import { getMissingHiringDetails, formatMissingHiringDetails } from '../utils/hiringDetails';
import { resolveOfferTemplate } from '../offer/templateResolver';
import {
  fetchCandidateInfo,
  fetchCandidatureInfo,
  fetchJobInfo,
  fetchUserFullName,
  moveToStage,
} from './viterbitApi';
import { splitFullName, syncCandidateFromViterbit } from './syncCandidate';
import { releaseHeldOffer } from './releaseHeldOffer';
import { VITERBIT_API_KEY } from '../utils/secrets';

// ─── Config params ─────────────────────────────────────────────────────────────
const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
// Comma-separated department profile names to process. Leave empty to allow all.
const HIRING_PROFILES = defineString('HIRING_PROFILES', {
  default: 'Trainee Sucursal (Kiosk Trainee),Gerente de Sucursal (Kiosk Manager),Promotor/a Aviva tu Negocio,Promotor/a Aviva tu Compra,Promotor/a Aviva tu Casa',
  // Note: substring match — "Promotor/a Aviva tu Compra" also covers (Comodín), (Temporal), (Internalización)
});

// Stage names (configurable, matched case-insensitively against webhook payload)
const STAGE_APROBADO     = defineString('STAGE_APROBADO',     { default: 'Aprobado' });
const STAGE_DOCUMENTOS   = defineString('STAGE_DOCUMENTOS',   { default: 'Documentos' });
const STAGE_CONTRATO     = defineString('STAGE_CONTRATO',     { default: 'Contrato' });
const STAGE_CORREOS      = defineString('STAGE_CORREOS',      { default: 'Correo corporativo' });
const STAGE_INDUCCION    = defineString('STAGE_INDUCCION',    { default: 'Onboarding' });
const STAGE_ONBOARDING_INICIADO = defineString('STAGE_ONBOARDING_INICIADO', { default: 'Onboarding Iniciado' });
const STAGE_PROMOTOR_EXITOSO    = defineString('STAGE_PROMOTOR_EXITOSO',    { default: 'Promotor Exitoso' });

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
// Job, candidature and candidate reads live in ./viterbitApi so the webhook,
// the per-candidate refresh and the bulk sync all parse Viterbit the same way.


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
    ? await fetchCandidatureInfo(candidatureId, apiKey)
    : null;

  const resolvedJobId = jobId || candidatureInfo?.jobId || '';
  console.log(`[webhook] handleAprobado jobId="${jobId}" resolvedJobId="${resolvedJobId}"`);

  // Fetch candidate and job in parallel with resolved jobId
  const [viterbitCandidate, jobInfo] = await Promise.all([
    fetchCandidateInfo(candidateViterbitId, apiKey),
    fetchJobInfo(resolvedJobId, apiKey),
  ]);

  const { title: jobTitle, stages, hiringManagerId,
    departmentProfile: viterbitDepartmentProfile,
    plaza, city: plazaCity } = jobInfo;
  // The vacancy names the company; "Aviva" is the house default when it doesn't.
  const viterbitCompany = jobInfo.company || 'Aviva';

  const viterbitHiringManager = await fetchUserFullName(hiringManagerId, apiKey);
  const viterbitSalary = candidatureInfo?.salary ?? '';
  const viterbitStartDate = candidatureInfo?.startDate ?? '';
  const viterbitStartDateIso = candidatureInfo?.startDateIso ?? '';

  // Exact match first — "Onboarding" must not match "Onboarding Iniciado",
  // and "Promotor Exitoso" must not match similarly-named stages.
  // Falls back to substring match only when no exact match exists.
  const findStage = (name: string) => {
    const lower = name.toLowerCase();
    return (
      stages.find((s) => s.name.toLowerCase() === lower)?.id ??
      stages.find((s) => s.name.toLowerCase().includes(lower))?.id
    );
  };

  const ofertaEnviadaId = findStage('Oferta Enviada') ?? findStage('oferta') ?? '';
  const documentosId = findStage(STAGE_DOCUMENTOS.value()) ?? '';
  const contratoId = findStage(STAGE_CONTRATO.value()) ?? '';
  const correosId = findStage(STAGE_CORREOS.value()) ?? '';
  const induccionId = findStage(STAGE_INDUCCION.value()) ?? '';
  const onboardingIniciadoId = findStage(STAGE_ONBOARDING_INICIADO.value()) ?? findStage('Activación Iniciada') ?? '';
  const promotorExitosoId = findStage('Promotor Exitoso') ?? findStage('Promotor exitoso') ?? '';

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

  const { fullName: candidateName, email: candidateEmail, reference: viterbitReference, contrasena: viterbitContrasena } = viterbitCandidate;
  const candidatePhone = viterbitCandidate.phone || undefined;
  const { firstName, lastName } = splitFullName(candidateName);

  // Buró / psicometría de integridad are candidate-level custom fields.
  const screening = viterbitCandidate.screening;

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
  const templateMatch = await resolveOfferTemplate({
    position: jobTitle,
    profile: viterbitDepartmentProfile || undefined,
  });

  // Create offer token (configurable expiry)
  const linkDurations = await getLinkDuration();
  const offerToken = generateToken();
  const offerExpiresAt = new Date(Date.now() + linkDurations.offerDays * 24 * 60 * 60 * 1000);

  // The offer letter only goes out once every hiring detail is known: salary,
  // start date, buró and psicometría de integridad. Anything missing parks the
  // candidate in `offer_held` so the recruiter can complete it in Viterbit,
  // refresh, and send the letter from the dashboard.
  const missingDetails = getMissingHiringDetails({
    viterbitSalary,
    viterbitStartDate,
    viterbitBuro: screening.buro,
    viterbitPsicometriaIntegridad: screening.psicometriaIntegridad,
  });
  const offerHeld = missingDetails.length > 0;

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
    status: offerHeld ? 'offer_held' : 'offer_sent',
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
    // Pre-set so the onCandidateCreated trigger does not double-send the email
    // we are about to send below; a held offer keeps it false.
    offerEmailSent: !offerHeld,
    offerHeldReasons: offerHeld ? missingDetails : [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'viterbit_webhook',
    // Canonical profile (same as viterbitDepartmentProfile for webhook candidates)
    profile: viterbitDepartmentProfile || null,
    // Viterbit job custom fields (used to interpolate offer letter variables)
    viterbitSalary: viterbitSalary || null,
    viterbitStartDate: viterbitStartDate || null,
    viterbitStartDateIso: viterbitStartDateIso || null,
    viterbitHiringManager: viterbitHiringManager || null,
    viterbitCompany: viterbitCompany || null,
    viterbitDepartmentProfile: viterbitDepartmentProfile || null,
    // Store and city of the job — the reporting dimensions "plaza" and "ciudad"
    plaza: plaza || null,
    plazaCity: plazaCity || null,
    // Screening results — required before the offer letter is emailed
    viterbitBuro: screening.buro || null,
    viterbitPsicometriaIntegridad: screening.psicometriaIntegridad || null,
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
      onboardingIniciado: onboardingIniciadoId || null,
      promotorExitoso: promotorExitosoId || null,
    },
  });

  // Send offer email — only when all required hiring details are known.
  // If any is missing, the candidate is created but the offer is held so the
  // recruiter can complete the data in Viterbit and resend manually.
  const appUrl = APP_URL.value();
  const offerUrl = `${appUrl}/offer/${offerToken}`;
  const offerExpiresAtStr = format(offerExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

  if (offerHeld) {
    const missing = formatMissingHiringDetails(missingDetails);
    console.warn(`[webhook] handleAprobado offer NOT sent — missing hiring details (${missing}) for candidate ${candidateRef.id}`);
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
    fetchCandidateInfo(candidateViterbitId, apiKey),
    fetchJobInfo(jobId, apiKey),
  ]);
  const jobTitle = jobInfo.title;

  if (!viterbitCandidate) {
    await logRef.update({ status: 'error', reason: `could not fetch candidate ${candidateViterbitId}` });
    return { action: 'error' };
  }

  const { fullName: candidateName, email: candidateEmail, reference: viterbitReference, contrasena: viterbitContrasena } = viterbitCandidate;
  const candidatePhone = viterbitCandidate.phone || undefined;
  const { firstName, lastName } = splitFullName(candidateName);

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

  const viterbitCandidate = await fetchCandidateInfo(candidateViterbitId, apiKey);
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

  // Idempotency: nothing to do once signed.
  if (candidate.contractSignedAt) {
    await logRef.update({ status: 'ignored', reason: 'contract already signed', candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

  // A contract was already generated for this candidate. If a later stage move
  // (e.g. Onboarding) overwrote `status` before they signed, moving them back to
  // "Contrato" should self-heal the status rather than silently no-op — otherwise
  // the public signing link stays permanently blocked.
  if (candidate.contractToken) {
    if (candidate.status !== 'contract_sent') {
      await candidateRef.update({ status: 'contract_sent', updatedAt: FieldValue.serverTimestamp() });
      await logRef.update({ status: 'processed', reason: 'restored contract_sent status', candidateId: candidateRef.id });
      return { action: 'contract_sent_restored', candidateId: candidateRef.id };
    }
    await logRef.update({ status: 'ignored', reason: 'contract already sent', candidateId: candidateRef.id });
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
 * Candidate reached "Correo corporativo & Accesos" or "Onboarding":
 * Move status to 'induction' so the recruiter can manually provision accounts.
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

  // Don't advance past a contract that's been sent but not yet signed — a stage
  // move in Viterbit (accidental or otherwise) shouldn't block the signing link.
  if (candidate.status === 'contract_sent' && !candidate.contractSignedAt) {
    await logRef.update({ status: 'ignored', reason: 'contract sent but not yet signed', candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

  // Skip if already past this stage
  const pastStages = ['email_pending', 'email_ready', 'induction', 'onboarding_iniciado', 'promotor_exitoso', 'bajo_desempeno', 'disqualified'];
  if (pastStages.includes(candidate.status as string)) {
    await logRef.update({ status: 'ignored', reason: `already at ${candidate.status}`, candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

  await candidateRef.update({ status: 'induction', updatedAt: FieldValue.serverTimestamp() });
  await logRef.update({ status: 'processed', candidateId: candidateRef.id });
  return { action: 'induction', candidateId: candidateRef.id };
}

/**
 * Candidate moved in Viterbit to "Onboarding Iniciado"/"Activación Iniciada"
 * or "Promotor Exitoso": sync the dashboard status. API-triggered moves
 * (checkActivations, dailyPerformanceCheck) already set the status directly,
 * so this mainly covers manual moves made by recruiters in Viterbit.
 */
async function handleStatusSync(
  parsed: ParsedViterbitEvent,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference,
  newStatus: 'onboarding_iniciado' | 'promotor_exitoso',
): Promise<{ action: string; candidateId?: string }> {
  const { candidatureId, candidateViterbitId } = parsed;

  const found = await findCandidateDoc(candidatureId, candidateViterbitId, apiKey);
  if (!found) {
    await logRef.update({ status: 'ignored', reason: `no candidate record found for ${newStatus}` });
    return { action: 'ignored' };
  }

  const { ref: candidateRef, data: candidate } = found;
  const currentStatus = candidate.status as string;

  // Never resurrect disqualified candidates, never downgrade promotor_exitoso
  // or bajo_desempeno back to an earlier stage, and never clobber a contract
  // that's been sent but not yet signed.
  const skip =
    currentStatus === newStatus ||
    currentStatus === 'disqualified' ||
    (currentStatus === 'contract_sent' && !candidate.contractSignedAt) ||
    (newStatus === 'onboarding_iniciado' && (currentStatus === 'promotor_exitoso' || currentStatus === 'bajo_desempeno'));
  if (skip) {
    await logRef.update({ status: 'ignored', reason: `already at ${currentStatus}`, candidateId: candidateRef.id });
    return { action: 'ignored', candidateId: candidateRef.id };
  }

  await candidateRef.update({ status: newStatus, updatedAt: FieldValue.serverTimestamp() });
  await logRef.update({ status: 'processed', candidateId: candidateRef.id });
  return { action: newStatus, candidateId: candidateRef.id };
}

/**
 * Anything that is not a stage change — a candidate edited, hired_info filled
 * in, a candidature updated. Viterbit names these events differently across
 * portals, so they are matched by shape rather than by an exact list.
 *
 * These events carry no stage, and the candidate already exists on our side:
 * the job is simply to re-read Viterbit and write back what changed, which is
 * what makes an edit made there show up on the dashboard without anyone
 * touching Firestore by hand.
 */
async function handleCandidateUpdated(
  body: Record<string, unknown>,
  apiKey: string,
  logRef: FirebaseFirestore.DocumentReference,
): Promise<{ action: string; candidateId?: string; changed?: string[]; reason?: string }> {
  const found = await findCandidateByViterbitIds(collectViterbitIds(body));
  if (!found) {
    await logRef.update({ status: 'ignored', reason: 'update event for an unknown candidate' });
    return { action: 'ignored', reason: 'candidate not tracked' };
  }

  const { ref, data } = found;
  const { changed, updates } = await syncCandidateFromViterbit(ref, data, apiKey);

  // A held offer waiting on exactly this data should go out now.
  const release = await releaseHeldOffer(ref.id, data, updates, 'viterbit_webhook');

  await logRef.update({
    status: 'processed',
    candidateId: ref.id,
    changed,
    offerAutoSent: release.sent,
    ...(release.error ? { offerAutoSendError: release.error } : {}),
  });
  return { action: changed.length > 0 ? 'synced' : 'unchanged', candidateId: ref.id, changed };
}

/** Every id in the payload that could identify a candidate we already track. */
function collectViterbitIds(body: Record<string, unknown>): string[] {
  const data = (body.data as Record<string, unknown>) ?? (body.payload as Record<string, unknown>) ?? {};
  const candidates = [
    data.candidate_id, data.candidature_id, data.id,
    body.candidate_id, body.candidature_id, body.id,
  ];
  return [...new Set(candidates.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))];
}

/**
 * Looks an id up against both Viterbit id fields and the document id (the
 * webhook names candidate documents after the candidature), since an update
 * event does not say which kind of id it carries.
 */
async function findCandidateByViterbitIds(
  ids: string[],
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData } | null> {
  if (ids.length === 0) return null;

  for (const field of ['viterbitCandidatureId', 'viterbitCandidateId'] as const) {
    const snap = await db.collection('candidates').where(field, 'in', ids).limit(1).get();
    if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
  }

  for (const id of ids) {
    const doc = await db.collection('candidates').doc(id).get();
    if (doc.exists) return { ref: doc.ref, data: doc.data()! };
  }

  return null;
}

/**
 * True for events that report a change to the candidate or the candidature
 * itself. Stage events are excluded — those have their own handlers, and the
 * dispatcher below reaches this check first.
 */
function isUpdateEvent(event: string): boolean {
  const name = event.toLowerCase();
  if (!name || name.includes('stage')) return false;
  return name.includes('update') || name.includes('changed') || name.includes('hired');
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

      const apiKey = VITERBIT_API_KEY.value();
      if (!apiKey) {
        await logRef.update({ status: 'error', reason: 'VITERBIT_API_KEY not configured' });
        res.status(500).json({ ok: false, error: 'Server misconfiguration: missing API key' });
        return;
      }

      // Candidate / candidature edits come before the stage pipeline: they carry
      // no stage, and they only ever touch candidates we already track, so the
      // department-profile filter below does not apply to them.
      const eventName = (body.event as string) ?? (body.type as string) ?? '';
      if (isUpdateEvent(eventName)) {
        const result = await handleCandidateUpdated(body, apiKey, logRef);
        res.status(200).json({ ok: true, ...result });
        return;
      }

      const parsed = parseViterbitPayload(body);
      if (!parsed) {
        await logRef.update({ status: 'ignored', reason: 'could not parse payload' });
        res.status(200).json({ ok: true, action: 'ignored', reason: 'unparseable payload' });
        return;
      }

      const { stageName, stageId, jobId } = parsed;

      // Filter by allowed department profiles if configured.
      // The list lives in Firestore (settings/hiringProfiles) so it survives
      // deploys; the HIRING_PROFILES param is only the fallback.
      const allowedProfiles = (await getAllowedHiringProfiles(HIRING_PROFILES.value()))
        .map((p) => p.toLowerCase());
      if (allowedProfiles.length > 0) {
        const jobInfo = await fetchJobInfo(jobId, apiKey);
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
        const resolved = await fetchCandidatureInfo(parsed.candidatureId, apiKey);
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
      // Exact match — avoids "Onboarding" inadvertently matching "Onboarding Iniciado"
      const exactMatches = (configName: string) => {
        const cfg = configName.toLowerCase();
        return stageNameLower === cfg || stageIdLower === cfg;
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
      } else if (exactMatches(STAGE_INDUCCION.value())) {
        const result = await handleInduccion(parsed, apiKey, logRef);
        res.status(200).json({ ok: true, ...result });
      } else if (exactMatches(STAGE_ONBOARDING_INICIADO.value()) || exactMatches('Activación Iniciada')) {
        const result = await handleStatusSync(parsed, apiKey, logRef, 'onboarding_iniciado');
        res.status(200).json({ ok: true, ...result });
      } else if (exactMatches(STAGE_PROMOTOR_EXITOSO.value())) {
        const result = await handleStatusSync(parsed, apiKey, logRef, 'promotor_exitoso');
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
