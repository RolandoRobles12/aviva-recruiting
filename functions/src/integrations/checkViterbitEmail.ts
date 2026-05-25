import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createHubSpotUser } from './hubspotService';

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

  // Create HubSpot user and fetch owner ID
  let hubspotCreated = false;
  let hubspotOwnerId: string | null = null;
  try {
    const result = await createHubSpotUser({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
    });
    hubspotCreated = true;
    hubspotOwnerId = result.ownerId;
  } catch (err) {
    console.error(`[checkViterbitEmail] HubSpot creation failed for ${doc.id}:`, err);
  }

  // Update Firestore
  const firestoreUpdate: Record<string, unknown> = {
    corporateEmail,
    status: 'induction',
    hubspotCreated,
    emailProvisionedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (hubspotOwnerId) firestoreUpdate.hubspotOwnerId = hubspotOwnerId;
  await doc.ref.update(firestoreUpdate);

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
