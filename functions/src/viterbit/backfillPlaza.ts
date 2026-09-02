import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { extractJobPlaza, type JobPlaza } from './jobPlaza';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function fetchJobPlaza(jobId: string, apiKey: string): Promise<JobPlaza | null> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/jobs/${jobId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) {
      console.error(`[backfillPlaza] job ${jobId} → HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    return extractJobPlaza(data);
  } catch (err) {
    console.error(`[backfillPlaza] job ${jobId} error:`, err);
    return null;
  }
}

/**
 * Fills `plaza` (the job's external_id) and `plazaCity` on candidates created
 * before those fields existed, so the operations report covers past hires too.
 *
 * Jobs are fetched once each and reused across every candidate hired for them —
 * many candidates share a store, and Viterbit is rate-limited. Idempotent: by
 * default only candidates missing a value are written; `force` re-reads Viterbit
 * and overwrites, for when a store was renamed there.
 */
export const backfillCandidatePlaza = onCall(
  { region: 'us-central1', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const { force = false } = (request.data ?? {}) as { force?: boolean };
    const apiKey = VITERBIT_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'VITERBIT_API_KEY no está configurada.');
    }

    const snapshot = await db.collection('candidates').get();

    // jobId → plaza data, or null when Viterbit could not resolve the job.
    const jobCache = new Map<string, JobPlaza | null>();
    let updated = 0;
    let skipped = 0;
    let withoutJob = 0;
    const failedJobs = new Set<string>();

    for (const docSnap of snapshot.docs) {
      const candidate = docSnap.data();
      const jobId = candidate.viterbitJobId as string | undefined;

      if (!jobId) {
        withoutJob++;
        continue;
      }
      if (!force && candidate.plaza && candidate.plazaCity) {
        skipped++;
        continue;
      }

      if (!jobCache.has(jobId)) {
        jobCache.set(jobId, await fetchJobPlaza(jobId, apiKey));
      }
      const job = jobCache.get(jobId) ?? null;
      if (!job) {
        failedJobs.add(jobId);
        continue;
      }

      const updates: Record<string, unknown> = {};
      if (job.plaza && (force || !candidate.plaza)) updates.plaza = job.plaza;
      if (job.city && (force || !candidate.plazaCity)) updates.plazaCity = job.city;

      if (Object.keys(updates).length === 0) {
        skipped++;
        continue;
      }

      updates.updatedAt = FieldValue.serverTimestamp();
      await docSnap.ref.update(updates);
      updated++;
    }

    return {
      updated,
      skipped,
      withoutJob,
      jobsFetched: jobCache.size,
      failedJobs: Array.from(failedJobs),
      message:
        `${updated} candidato(s) actualizados, ${skipped} ya tenían plaza y ciudad, ` +
        `${withoutJob} sin vacante de Viterbit, ${failedJobs.size} vacante(s) que Viterbit no devolvió.`,
    };
  },
);
