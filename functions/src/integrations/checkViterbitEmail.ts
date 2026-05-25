import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createHubSpotUser } from './hubspotService';
import { inviteSlackDual } from './slackService';
import { sendEmail } from '../email/gmailClient';
import { inductionTemplate } from '../email/templates';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function fetchCorporateEmailFromViterbit(
  viterbitCandidateId: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidates/${viterbitCandidateId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const customFields = (data.custom_field_values as Record<string, unknown>) ?? {};
    return (customFields.correo_corporativo as string) || null;
  } catch (err) {
    console.error('[checkViterbitEmail] fetchCorporateEmail error:', err);
    return null;
  }
}

async function moveToViterbitStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: stageId }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
    }
  } catch (err) {
    console.error('[checkViterbitEmail] moveToViterbitStage error:', err);
  }
}

async function processCandidateEmail(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  apiKey: string,
): Promise<boolean> {
  const candidate = doc.data();
  const viterbitCandidateId = candidate.viterbitCandidateId as string | undefined;

  if (!viterbitCandidateId) {
    console.warn(`[checkViterbitEmail] ${doc.id} has no viterbitCandidateId — skipping`);
    return false;
  }

  const corporateEmail = await fetchCorporateEmailFromViterbit(viterbitCandidateId, apiKey);
  if (!corporateEmail) return false;

  console.info(`[checkViterbitEmail] correo_corporativo found for ${doc.id}: ${corporateEmail}`);

  // Provision HubSpot + Slack in parallel
  const [hubspotResult, slackResult] = await Promise.allSettled([
    createHubSpotUser({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
    }),
    inviteSlackDual({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
    }),
  ]);

  if (hubspotResult.status === 'rejected') {
    console.error(`[checkViterbitEmail] HubSpot creation failed for ${doc.id}:`, hubspotResult.reason);
  }

  const slackDual = slackResult.status === 'fulfilled' ? slackResult.value : null;
  const slackPrimaryOk = slackDual?.primary.ok ?? false;
  const slackGuestOk = slackDual?.guest.ok ?? false;

  if (slackResult.status === 'rejected') {
    console.error(`[checkViterbitEmail] Slack invitation failed for ${doc.id}:`, slackResult.reason);
  }

  // Update Firestore — always, even if HubSpot/Slack had partial failures
  await doc.ref.update({
    corporateEmail,
    status: 'induction',
    hubspotCreated: hubspotResult.status === 'fulfilled',
    slackInvited: slackPrimaryOk,
    slackGuestInvited: slackGuestOk,
    emailProvisionedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Move to "Inducción" stage in Viterbit
  const viterbitCandidatureId = candidate.viterbitCandidatureId as string | undefined;
  const viterbitStageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
  const induccionStageId = viterbitStageIds?.induccion;
  if (viterbitCandidatureId && induccionStageId) {
    void moveToViterbitStage(viterbitCandidatureId, induccionStageId, apiKey);
  }

  // Send induction email
  try {
    const { subject, html } = inductionTemplate({
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      corporateEmail,
    });
    const createdBy = candidate.createdBy as string | undefined;
    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      recruiterUid: createdBy && createdBy !== 'viterbit_webhook' ? createdBy : undefined,
    });
    await db.collection('email_logs').add({
      candidateId: doc.id,
      templateType: 'induction',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: 'check_viterbit_email',
      success: true,
    });
  } catch (err) {
    console.error(`[checkViterbitEmail] Failed to send induction email for ${doc.id}:`, err);
  }

  return true;
}

export const checkViterbitEmail = onSchedule(
  {
    schedule: 'every 2 hours',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const apiKey = VITERBIT_API_KEY.value();

    const snapshot = await db
      .collection('candidates')
      .where('status', '==', 'email_pending')
      .get();

    if (snapshot.empty) {
      console.info('[checkViterbitEmail] No candidates pending corporate email');
      return;
    }

    // Skip candidates already provisioned (guard against double-processing)
    const pending = snapshot.docs.filter((doc) => !doc.data().corporateEmail);

    console.info(`[checkViterbitEmail] Checking ${pending.length} candidate(s) for correo_corporativo in Viterbit`);

    const results = await Promise.allSettled(
      pending.map((doc) => processCandidateEmail(doc, apiKey))
    );

    const resolved = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const errors = results.filter((r) => r.status === 'rejected').length;
    console.info(`[checkViterbitEmail] Done: ${resolved} provisioned, ${errors} errors, ${pending.length - resolved - errors} still waiting`);
  }
);
