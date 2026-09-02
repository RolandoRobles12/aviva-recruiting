import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import {
  processPendingCheck,
  retryPendingPromotorMoves,
  sweepEvaluatedCandidates,
} from './performanceCheck';
import { scheduleMissingChecks } from './scheduleChecks';

/**
 * How many due checks one run evaluates. Each check is at least one HubSpot
 * call and sometimes a Viterbit stage move, and the callable is capped at 540s;
 * a bounded batch finishes and reports what is left instead of dying halfway
 * with the operator watching a frozen screen. Whatever remains is picked up by
 * the next run — this one or the daily 09:00 job.
 */
const MAX_CHECKS_PER_RUN = 150;

interface RunSummary {
  scheduled: number;
  isoFilled: number;
  evaluated: number;
  failed: number;
  remaining: number;
  sinFechaDeIngreso: string[];
  message: string;
}

/**
 * Runs the whole performance cycle on demand, instead of waiting for the daily
 * 09:00 job: schedules the checks that were never created, normalises start
 * dates, evaluates every check whose date has passed, and settles the verdicts
 * (Promotor Exitoso in Viterbit, Bajo Desempeño internally).
 *
 * This is deliberately not gated behind a simulation: it re-judges nobody. It
 * performs the evaluation that should already have happened automatically, with
 * the very same code the scheduler runs — recalculatePerformanceStatuses is the
 * one that revisits settled verdicts, and that one keeps its dry run.
 */
export const runPerformanceChecksNow = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<RunSummary> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    // 1. Schedule what signContract never scheduled. Dates already in the past
    //    come back due immediately, which is what step 2 then evaluates.
    const schedule = await scheduleMissingChecks();

    // 2. Evaluate everything that is due right now.
    const due = await db
      .collection('pending_performance_checks')
      .where('processAfter', '<=', Timestamp.now())
      .where('processed', '==', false)
      .get();

    const batch = due.docs.slice(0, MAX_CHECKS_PER_RUN);
    const results = await Promise.allSettled(batch.map((doc) => processPendingCheck(doc)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[runPerformanceChecksNow] check failed:', result.reason);
      }
    }

    // 3. Settle whatever the evaluation left half-done — the same two sweeps the
    //    daily job runs, so a lost status write or a failed Viterbit move does
    //    not wait until tomorrow either.
    try {
      await sweepEvaluatedCandidates();
    } catch (err) {
      console.error('[runPerformanceChecksNow] sweepEvaluatedCandidates failed:', err);
    }
    try {
      await retryPendingPromotorMoves();
    } catch (err) {
      console.error('[runPerformanceChecksNow] retryPendingPromotorMoves failed:', err);
    }

    const evaluated = batch.length - failed;
    const remaining = due.size - batch.length;

    const parts = [
      `${schedule.created} corte(s) programados`,
      `${evaluated} evaluado(s) ahora`,
    ];
    if (failed > 0) parts.push(`${failed} con error (se reintentan en el corte diario)`);
    if (remaining > 0) parts.push(`${remaining} pendientes: vuelve a ejecutar`);
    if (schedule.isoFilled > 0) parts.push(`${schedule.isoFilled} fecha(s) de ingreso normalizadas`);
    if (schedule.unparseable.length > 0) {
      parts.push(`${schedule.unparseable.length} sin fecha de ingreso interpretable`);
    }

    return {
      scheduled: schedule.created,
      isoFilled: schedule.isoFilled,
      evaluated,
      failed,
      remaining,
      sinFechaDeIngreso: schedule.unparseable,
      message: `${parts.join(', ')}.`,
    };
  },
);
