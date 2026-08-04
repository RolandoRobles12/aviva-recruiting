import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { countDealsByOwner, findOwnerIdByEmail } from '../integrations/hubspotService';
import { notifyPerformanceCheck } from '../integrations/slackService';
import { parseCandidateStartDate } from '../utils/startDate';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

// ─── Monthly deal targets by Viterbit profile ────────────────────────────────
const DEAL_TARGETS_BY_PROFILE: Record<string, number> = {
  'Promotor/a Aviva tu Compra':           34,
  'Promotor/a Aviva tu Compra CM':        17,
  'Promotor/a Aviva tu Compra (Comodín)':        34,
  'Promotor/a Aviva tu Compra (Temporal)':       34,
  'Promotor/a Aviva tu Compra (Internalización)': 34,
  'Promotor/a Aviva tu Negocio':          17,
  'Promotor/a Aviva tu Casa':             17,
  'Trainee Sucursal (Kiosk Trainee)':     72,
  'Gerente de Sucursal (Kiosk Manager)':  72,
};

function getMonthlyTarget(profile: string): number {
  return DEAL_TARGETS_BY_PROFILE[profile] ?? 17;
}

async function moveToPromotor(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_id: stageId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`moveToStage promotorExitoso HTTP ${resp.status}: ${text}`);
  }
}

/** Live lookup of the "Promotor Exitoso" stage id in a job's pipeline. */
async function fetchPromotorExitosoStageIdFromJob(jobId: string, apiKey: string): Promise<string> {
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) return '';
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const stages = (data.stages as Array<{ id: string; name: string }>) ?? [];
    const exact = stages.find((s) => s.name.toLowerCase() === 'promotor exitoso');
    const partial = stages.find((s) => s.name.toLowerCase().includes('promotor exitoso'));
    return (exact ?? partial)?.id ?? '';
  } catch {
    return '';
  }
}

/**
 * Resolve the "Promotor Exitoso" stage id for a candidate's job.
 * Prefers the cached id from viterbitStageIds; falls back to a live API lookup
 * (exact stage-name match first, substring match second) when the cached id is
 * missing. Pass preferLive after a failed move: a cached id can be stale or
 * wrong (job pipeline edited in Viterbit, old caching bug) and would otherwise
 * make every retry fail with the same bad id forever.
 */
async function resolvePromotorExitosoStageId(
  candidate: FirebaseFirestore.DocumentData,
  apiKey: string,
  { preferLive = false }: { preferLive?: boolean } = {},
): Promise<string> {
  const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
  const cached = stageIds?.promotorExitoso ?? '';
  if (cached && !preferLive) return cached;

  const jobId = candidate.viterbitJobId as string | undefined;
  if (!jobId || !apiKey) return cached;

  const live = await fetchPromotorExitosoStageIdFromJob(jobId, apiKey);
  return live || cached;
}

async function processPendingCheck(checkDoc: FirebaseFirestore.QueryDocumentSnapshot): Promise<void> {
  const check = checkDoc.data();
  const candidateId = check.candidateId as string;
  const daysMark = check.daysMark as 15 | 30;
  const appUrl = APP_URL.value();

  const candidateSnap = await db.collection('candidates').doc(candidateId).get();
  if (!candidateSnap.exists) {
    console.warn(`[performanceCheck] Candidate ${candidateId} not found — marking processed`);
    await checkDoc.ref.update({ processed: true, processedAt: FieldValue.serverTimestamp() });
    return;
  }

  const c = candidateSnap.data()!;
  let hubspotOwnerId = c.hubspotOwnerId as string | undefined;
  if (!hubspotOwnerId) {
    // Self-heal: candidates provisioned while HubSpot creation failed (or via
    // the legacy Jira flow) have a corporateEmail but no cached owner id.
    const corporateEmail = c.corporateEmail as string | undefined;
    if (corporateEmail) {
      const found = await findOwnerIdByEmail(corporateEmail);
      if (found) {
        hubspotOwnerId = found;
        await candidateSnap.ref.update({ hubspotOwnerId: found, updatedAt: FieldValue.serverTimestamp() });
        console.info(`[performanceCheck] ${candidateId}: recovered hubspotOwnerId ${found} via ${corporateEmail}`);
      }
    }
  }
  if (!hubspotOwnerId) {
    console.warn(`[performanceCheck] ${candidateId} has no hubspotOwnerId — skipping (retried daily)`);
    return;
  }

  const startDate = parseCandidateStartDate(c);
  if (!startDate) {
    console.warn(`[performanceCheck] ${candidateId} has no parseable viterbitStartDate ("${c.viterbitStartDate}") — marking processed`);
    await checkDoc.ref.update({ processed: true, processedAt: FieldValue.serverTimestamp() });
    return;
  }

  const startDateMs = startDate.getTime();

  let dealCount = 0;
  try {
    dealCount = await countDealsByOwner(hubspotOwnerId, startDateMs);
  } catch (err) {
    console.error(`[performanceCheck] HubSpot error for ${candidateId}:`, err);
    return;
  }

  const company = (c.viterbitCompany as string) || '';
  const profile = (c.profile as string) || (c.position as string) || '';
  const monthlyTarget = getMonthlyTarget(profile);
  const candidateName = `${c.firstName as string} ${c.lastName as string}`.trim();

  const alreadyCheckedField = daysMark === 15 ? 'performance15DayCheckedAt' : 'performance30DayCheckedAt';
  const dealCountField      = daysMark === 15 ? 'performance15DayDeals'      : 'performance30DayDeals';

  // Mark as processed + save deal count (idempotency — do this before Viterbit move)
  await Promise.all([
    checkDoc.ref.update({ processed: true, processedAt: FieldValue.serverTimestamp(), dealCount }),
    candidateSnap.ref.update({
      [alreadyCheckedField]: FieldValue.serverTimestamp(),
      [dealCountField]: dealCount,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);

  // At day 30: move to "Promotor Exitoso" in Viterbit when target is met.
  // On failure, flag the candidate so retryPendingPromotorMoves picks them up
  // on the next daily run — the check doc itself is already marked processed.
  if (daysMark === 30 && dealCount >= monthlyTarget) {
    const apiKey = VITERBIT_API_KEY.value();
    const candidatureId = c.viterbitCandidatureId as string | undefined;
    const promotorExitosoId = await resolvePromotorExitosoStageId(c, apiKey);
    if (apiKey && candidatureId && promotorExitosoId) {
      try {
        await moveToPromotor(candidatureId, promotorExitosoId, apiKey);
        await candidateSnap.ref.update({
          status: 'promotor_exitoso',
          promotorMovePending: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        console.info(`[performanceCheck] Moved ${candidateName} to Promotor Exitoso (${dealCount}/${monthlyTarget})`);
      } catch (err) {
        console.error(`[performanceCheck] moveToPromotor error for ${candidateId} — flagged for retry:`, err);
        await candidateSnap.ref.update({ promotorMovePending: true, updatedAt: FieldValue.serverTimestamp() });
      }
    } else {
      console.warn(`[performanceCheck] Cannot move to Promotor Exitoso — missing ids, flagged for retry`, { candidateId, candidatureId, promotorExitosoId });
      await candidateSnap.ref.update({ promotorMovePending: true, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  // Slack notification
  try {
    await notifyPerformanceCheck({
      candidateId,
      candidateName,
      company,
      profile,
      daysMark,
      dealCount,
      monthlyTarget,
      startDate: (c.viterbitStartDate as string) || startDate.toISOString().slice(0, 10),
      appUrl,
    });
  } catch (err) {
    console.error(`[performanceCheck] Slack error for ${candidateId}:`, err);
  }

  console.log(`[performanceCheck] ${daysMark}d check for ${candidateName}: ${dealCount}/${monthlyTarget} deals`);
}

/**
 * Retry Viterbit moves that failed when the 30-day check ran (the check doc is
 * marked processed exactly once, so a transient Viterbit error must be retried
 * from the candidate-level promotorMovePending flag instead).
 */
async function retryPendingPromotorMoves(): Promise<void> {
  const snap = await db
    .collection('candidates')
    .where('promotorMovePending', '==', true)
    .get();
  if (snap.empty) return;

  console.info(`[performanceCheck] Retrying ${snap.size} pending Promotor Exitoso move(s)`);
  const apiKey = VITERBIT_API_KEY.value();

  for (const docSnap of snap.docs) {
    const c = docSnap.data();

    // Already there (e.g. moved manually in Viterbit and synced back) — just clear the flag.
    if (c.status === 'promotor_exitoso') {
      await docSnap.ref.update({ promotorMovePending: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      continue;
    }

    const candidatureId = c.viterbitCandidatureId as string | undefined;
    // preferLive: the first attempt already failed with the cached id, so
    // re-resolve against the live pipeline instead of retrying the same id.
    const promotorExitosoId = await resolvePromotorExitosoStageId(c, apiKey, { preferLive: true });
    if (!apiKey || !candidatureId || !promotorExitosoId) {
      console.warn(`[performanceCheck] retry: still missing ids for ${docSnap.id}`, { candidatureId, promotorExitosoId });
      continue;
    }

    try {
      await moveToPromotor(candidatureId, promotorExitosoId, apiKey);
      await docSnap.ref.update({
        status: 'promotor_exitoso',
        promotorMovePending: FieldValue.delete(),
        // Repair the cache so future flows use the id that actually worked.
        'viterbitStageIds.promotorExitoso': promotorExitosoId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.info(`[performanceCheck] retry: moved ${docSnap.id} to Promotor Exitoso`);
    } catch (err) {
      console.error(`[performanceCheck] retry: moveToPromotor error for ${docSnap.id}:`, err);
    }
  }
}

/**
 * The 30-day check runs exactly once per candidate (the check doc is marked
 * processed before the Viterbit move). Candidates evaluated before the
 * promotorMovePending retry flag existed — or whose flag write was lost — can
 * have met the target and still be stuck in an earlier status with nothing
 * retrying the move. Sweep every evaluated candidate and flag the ones that
 * met their target but never reached promotor_exitoso, so
 * retryPendingPromotorMoves picks them up in the same run.
 */
async function flagMissedPromotorMoves(): Promise<void> {
  const snap = await db
    .collection('candidates')
    .where('performance30DayCheckedAt', '!=', null)
    .get();

  for (const docSnap of snap.docs) {
    const c = docSnap.data();
    const status = c.status as string;
    if (status === 'promotor_exitoso' || status === 'disqualified') continue;
    if (c.promotorMovePending === true) continue;

    const profile = (c.profile as string) || (c.position as string) || '';
    const dealCount = (c.performance30DayDeals as number) ?? 0;
    if (dealCount < getMonthlyTarget(profile)) continue;

    console.info(`[performanceCheck] sweep: ${docSnap.id} met target (${dealCount}) but status is "${status}" — flagging for Promotor Exitoso move`);
    await docSnap.ref.update({ promotorMovePending: true, updatedAt: FieldValue.serverTimestamp() });
  }
}

/**
 * Runs daily at 09:00 Mexico City time.
 * Processes pending_performance_checks documents whose processAfter timestamp has passed.
 * At day 30, if deal count meets the monthly target, moves candidate to "Promotor Exitoso" in Viterbit.
 */
export const dailyPerformanceCheck = onSchedule(
  {
    schedule: 'every day 09:00',
    timeZone: 'America/Mexico_City',
    region:   'us-central1',
    memory:   '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const now = Timestamp.now();

    const snap = await db
      .collection('pending_performance_checks')
      .where('processAfter', '<=', now)
      .where('processed', '==', false)
      .get();

    if (snap.empty) {
      console.info('[performanceCheck] No pending checks to process');
    } else {
      console.info(`[performanceCheck] Processing ${snap.size} pending check(s)`);

      const results = await Promise.allSettled(
        snap.docs.map((doc) => processPendingCheck(doc))
      );

      const errors = results.filter((r) => r.status === 'rejected').length;
      if (errors > 0) {
        console.error(`[performanceCheck] ${errors} check(s) failed`);
      }
    }

    try {
      await flagMissedPromotorMoves();
    } catch (err) {
      console.error('[performanceCheck] flagMissedPromotorMoves failed:', err);
    }

    try {
      await retryPendingPromotorMoves();
    } catch (err) {
      console.error('[performanceCheck] retryPendingPromotorMoves failed:', err);
    }
  },
);
