import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createHubSpotUser } from './hubspotService';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

interface ViterbitEmailResult {
  corporateEmail: string;
  contrasena: string;
}

function extractFieldsFromJson(json: Record<string, unknown>): ViterbitEmailResult {
  const data = (json.data as Record<string, unknown>) ?? json;
  const customFields = (data.custom_field_values as Record<string, unknown>) ?? {};

  const getField = (key: string): string => {
    const raw = customFields[key];
    if (raw && typeof raw === 'object' && 'value' in raw) {
      return String((raw as Record<string, unknown>).value ?? '');
    }
    return (raw as string) || '';
  };

  return {
    corporateEmail: getField('correo_corporativo'),
    contrasena:     getField('contrasena_correo_corporativo'),
  };
}

async function fetchFromViterbit(url: string, apiKey: string): Promise<ViterbitEmailResult> {
  const empty = { corporateEmail: '', contrasena: '' };
  try {
    const resp = await fetch(url, { headers: { 'X-API-Key': apiKey } });
    if (!resp.ok) {
      console.warn(`[checkViterbitEmail] GET ${url} failed: ${resp.status}`);
      return empty;
    }
    return extractFieldsFromJson((await resp.json()) as Record<string, unknown>);
  } catch (err) {
    console.error(`[checkViterbitEmail] fetch error for ${url}:`, err);
    return empty;
  }
}

async function processCandidate(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  apiKey: string,
): Promise<boolean> {
  const candidate = doc.data();
  const viterbitCandidateId   = candidate.viterbitCandidateId   as string | undefined;
  const viterbitCandidatureId = candidate.viterbitCandidatureId as string | undefined;

  let result = { corporateEmail: '', contrasena: '' };

  // Try candidate-level custom fields first, then candidature-level
  if (viterbitCandidateId) {
    result = await fetchFromViterbit(
      `${VITERBIT_API_BASE}/candidates/${viterbitCandidateId}?includes[]=custom_field_values`,
      apiKey,
    );
  }
  if (!result.corporateEmail && viterbitCandidatureId) {
    result = await fetchFromViterbit(
      `${VITERBIT_API_BASE}/candidatures/${viterbitCandidatureId}?includes[]=custom_field_values`,
      apiKey,
    );
  }

  if (!result.corporateEmail) {
    console.warn(`[checkViterbitEmail] ${doc.id}: correo_corporativo not yet available`);
    return false;
  }

  const { corporateEmail, contrasena } = result;
  console.info(`[checkViterbitEmail] correo_corporativo found for ${doc.id}: ${corporateEmail}`);

  // Create HubSpot owner
  let hubspotOwnerId: string | null = null;
  try {
    const hubspot = await createHubSpotUser({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName:  candidate.lastName  as string,
    });
    hubspotOwnerId = hubspot.ownerId;
  } catch (err) {
    console.error(`[checkViterbitEmail] HubSpot creation failed for ${doc.id}:`, err);
  }

  const update: Record<string, unknown> = {
    corporateEmail,
    status: 'email_ready',
    emailProvisionedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (hubspotOwnerId) update.hubspotOwnerId = hubspotOwnerId;
  if (contrasena)     update.viterbitContrasena = contrasena;

  await doc.ref.update(update);
  return true;
}

/**
 * Runs every 2 hours. Finds candidates in 'induction' status without a
 * corporate email and polls Viterbit for correo_corporativo + contrasena_correo_corporativo
 * (stamped by the external provisioning process within ~48 h of reaching Onboarding).
 * On success: creates HubSpot owner and moves candidate to 'email_ready'.
 */
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
      .where('status', '==', 'induction')
      .get();

    if (snapshot.empty) {
      console.info('[checkViterbitEmail] No candidates in induction');
      return;
    }

    const pending = snapshot.docs.filter((doc) => !doc.data().corporateEmail);
    if (pending.length === 0) {
      console.info('[checkViterbitEmail] All induction candidates already have a corporate email');
      return;
    }

    console.info(`[checkViterbitEmail] Checking ${pending.length} candidate(s) for correo_corporativo`);

    const results = await Promise.allSettled(
      pending.map((doc) => processCandidate(doc, apiKey))
    );

    const resolved = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const errors   = results.filter((r) => r.status === 'rejected').length;
    console.info(`[checkViterbitEmail] Done: ${resolved} provisioned, ${errors} errors, ${pending.length - resolved - errors} still waiting`);
  }
);
