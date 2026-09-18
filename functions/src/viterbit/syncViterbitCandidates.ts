/**
 * Periodic Viterbit → dashboard sync.
 *
 * Viterbit only calls the webhook on stage changes, so an edit to the candidate
 * or to the hiring details (salario, fecha de inicio, buró, psicometría, plaza,
 * puesto) raises no event at all in most portals. This sweep is what makes
 * those edits land without anyone pressing a button: it re-reads Viterbit for
 * every candidate still in flight and writes back the differences.
 *
 * Candidates past induction are left alone — their Viterbit record no longer
 * drives anything in the dashboard, and re-reading them would only spend API
 * quota.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { db } from '../utils/admin';
import { userHasPermission } from '../utils/permissions';
import { syncCandidateFromViterbit } from './syncCandidate';
import { releaseHeldOffer } from './releaseHeldOffer';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');

/** Statuses whose Viterbit record can still change something that matters. */
export const SYNCABLE_STATUSES = [
  'offer_held',
  'offer_sent',
  'offer_signed',
  'invited',
  'in_progress',
  'under_review',
  'approved',
  'contract_sent',
  'contract_signed',
  'email_pending',
  'email_ready',
  'induction',
];

/** Candidates read per Viterbit round — keeps the API calls to a trickle. */
const BATCH_SIZE = 4;

/**
 * Stop before the function's own 540s ceiling, so the sweep ends with a report
 * instead of being killed mid-batch. Whatever it didn't reach is picked up by
 * the next run — every write is independent.
 */
const TIME_BUDGET_MS = 8 * 60 * 1000;

export interface SyncSweepResult {
  checked: number;
  updated: number;
  offersSent: number;
  errors: number;
  /** Candidates left for the next run because the time budget ran out. */
  pending: number;
  message: string;
}

async function syncAll(apiKey: string): Promise<SyncSweepResult> {
  if (!apiKey) {
    return {
      checked: 0, updated: 0, offersSent: 0, errors: 0, pending: 0,
      message: 'VITERBIT_API_KEY no está configurada.',
    };
  }

  const startedAt = Date.now();

  const snap = await db
    .collection('candidates')
    .where('status', 'in', SYNCABLE_STATUSES)
    .get();

  const docs = snap.docs.filter((doc) => {
    const data = doc.data();
    return !!(data.viterbitCandidateId || data.viterbitCandidatureId || data.viterbitJobId);
  });

  let updated = 0;
  let offersSent = 0;
  let errors = 0;
  let processed = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.warn(`[syncViterbitCandidates] time budget spent — ${docs.length - processed} candidate(s) left for the next run`);
      break;
    }
    const batch = docs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (doc) => {
        const stored = doc.data();
        const { changed, updates } = await syncCandidateFromViterbit(doc.ref, stored, apiKey);
        const release = await releaseHeldOffer(doc.id, stored, updates, 'viterbit_sync');
        return { changed: changed.length > 0, offerSent: release.sent };
      }),
    );

    processed += batch.length;

    for (const result of results) {
      if (result.status === 'rejected') {
        errors += 1;
        console.error('[syncViterbitCandidates] candidate sync failed:', result.reason);
        continue;
      }
      if (result.value.changed) updated += 1;
      if (result.value.offerSent) offersSent += 1;
    }
  }

  const pending = docs.length - processed;
  const message =
    `${processed} candidato(s) revisado(s): ${updated} actualizado(s), ` +
    `${offersSent} carta(s) oferta enviada(s), ${errors} con error` +
    (pending > 0 ? `, ${pending} pendiente(s) para la siguiente corrida.` : '.');
  console.info(`[syncViterbitCandidates] ${message}`);

  return { checked: processed, updated, offersSent, errors, pending, message };
}

/** Runs every 2 hours, matching the cadence of the corporate-email poll. */
export const syncViterbitCandidates = onSchedule(
  {
    schedule: 'every 2 hours',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    await syncAll(VITERBIT_API_KEY.value());
  },
);

/** Same sweep, on demand, from Configuración → Admin. */
export const syncViterbitCandidatesNow = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const allowed = await userHasPermission(request.auth.uid, 'config_settings', {
      reclutador: false,
      lider: true,
      nomina: false,
      legal: false,
    });
    if (!allowed) {
      throw new HttpsError('permission-denied', 'No tienes permiso para ejecutar la sincronización.');
    }
    return syncAll(VITERBIT_API_KEY.value());
  },
);
