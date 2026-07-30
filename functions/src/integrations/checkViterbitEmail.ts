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
  const existingEmail = (candidate.corporateEmail as string | undefined) ?? '';

  let result = { corporateEmail: existingEmail, contrasena: '' };

  // Try candidate-level custom fields first, then candidature-level.
  // Skipped when the email is already stored (re-run to retry HubSpot only).
  if (!result.corporateEmail && viterbitCandidateId) {
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

  // Create HubSpot owner. On failure the candidate stays in the polling set
  // (missing hubspotOwnerId) so the next run retries — createHubSpotUser is
  // idempotent: it returns the existing owner instead of duplicating.
  let hubspotOwnerId: string | null = null;
  try {
    const hubspot = await createHubSpotUser({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName:  candidate.lastName  as string,
    });
    hubspotOwnerId = hubspot.ownerId;
  } catch (err) {
    console.error(`[checkViterbitEmail] HubSpot creation failed for ${doc.id} (will retry next run):`, err);
  }

  const update: Record<string, unknown> = {
    corporateEmail,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Advance induction → email_ready, but never downgrade a later status
  // (onboarding_iniciado candidates re-enter this poll only to heal hubspotOwnerId).
  if (candidate.status === 'induction') update.status = 'email_ready';
  if (!candidate.emailProvisionedAt) update.emailProvisionedAt = FieldValue.serverTimestamp();
  if (hubspotOwnerId) update.hubspotOwnerId = hubspotOwnerId;
  if (contrasena)     update.viterbitContrasena = contrasena;

  await doc.ref.update(update);
  return !!hubspotOwnerId;
}

/**
 * Runs every 2 hours. Finds candidates missing their corporate email and/or
 * HubSpot owner and polls Viterbit for correo_corporativo + contrasena_correo_corporativo
 * (stamped by the external provisioning process within ~48 h of reaching Onboarding).
 * On success: creates HubSpot owner and advances 'induction' → 'email_ready'.
 * Candidates already past induction stay in the poll only until hubspotOwnerId
 * is filled (required by the 30-day performance check).
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
      .where('status', 'in', ['induction', 'email_ready', 'onboarding_iniciado'])
      .get();

    if (snapshot.empty) {
      console.info('[checkViterbitEmail] No candidates in induction/email_ready/onboarding_iniciado');
      return;
    }

    const pending = snapshot.docs.filter(
      (doc) => !doc.data().corporateEmail || !doc.data().hubspotOwnerId,
    );
    if (pending.length === 0) {
      console.info('[checkViterbitEmail] All candidates already have corporate email + HubSpot owner');
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
