import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import {
  processPendingCheck,
  retryPendingPromotorMoves,
  sweepEvaluatedCandidates,
  type SkipReason,
} from './performanceCheck';
import { recoverPendingHubspotOwners } from './recoverHubspotOwners';
import { scheduleMissingChecks } from './scheduleChecks';

/**
 * How many due checks one run evaluates. Each check is at least one HubSpot
 * call and sometimes a Viterbit stage move, and the callable is capped at 540s;
 * a bounded batch finishes and reports what is left instead of dying halfway
 * with the operator watching a frozen screen. Whatever remains is picked up by
 * the next run — this one or the daily 09:00 job.
 */
const MAX_CHECKS_PER_RUN = 150;

/** How each dead end reads in the operator's summary. */
const SKIP_LABELS: Record<SkipReason, string> = {
  sin_correo:              'sin correo corporativo provisionado',
  sin_owner:               'con correo corporativo pero sin owner en HubSpot (cuenta sin activar)',
  error_hubspot:           'con error de HubSpot',
  sin_fecha:               'sin fecha de ingreso',
  candidato_no_encontrado: 'de candidatos ya borrados',
  corte_invalido:          'con el corte mal formado',
};

interface RunSummary {
  scheduled: number;
  isoFilled: number;
  /** Promoters whose HubSpot owner id was found now that they activated. */
  ownersRecovered: number;
  /** Checks that actually produced a deal count — not merely processed. */
  evaluated: number;
  /** Checks that ended without a count, by reason. */
  skipped: Partial<Record<SkipReason, number>>;
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

    // 2. Pick up whoever activated their HubSpot account since the last run —
    //    without their owner id there is nobody to attribute solicitudes to, so
    //    this has to happen before the checks, not after.
    let ownersRecovered = 0;
    try {
      ownersRecovered = (await recoverPendingHubspotOwners()).recovered;
    } catch (err) {
      console.error('[runPerformanceChecksNow] recoverPendingHubspotOwners failed:', err);
    }

    // 3. Evaluate everything that is due right now.
    const due = await db
      .collection('pending_performance_checks')
      .where('processAfter', '<=', Timestamp.now())
      .where('processed', '==', false)
      .get();

    const batch = due.docs.slice(0, MAX_CHECKS_PER_RUN);
    const results = await Promise.allSettled(batch.map((doc) => processPendingCheck(doc)));

    // A check that ends early leaves the promoter with no verdict, so it must
    // not be reported as evaluated: the operator would go looking for a result
    // that never landed.
    let evaluated = 0;
    let failed = 0;
    const skipped: Partial<Record<SkipReason, number>> = {};
    for (const result of results) {
      if (result.status === 'rejected') {
        failed++;
        console.error('[runPerformanceChecksNow] check failed:', result.reason);
      } else if (result.value.status === 'evaluado') {
        evaluated++;
      } else {
        const reason = result.value.reason;
        skipped[reason] = (skipped[reason] ?? 0) + 1;
      }
    }

    // 4. Settle whatever the evaluation left half-done — the same two sweeps the
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

    const remaining = due.size - batch.length;

    const parts = [
      `${schedule.created} corte(s) programados`,
      `${evaluated} evaluado(s) ahora`,
    ];
    if (ownersRecovered > 0) {
      parts.push(`${ownersRecovered} cuenta(s) de HubSpot ya activadas y vinculadas`);
    }
    for (const [reason, total] of Object.entries(skipped) as [SkipReason, number][]) {
      parts.push(`${total} ${SKIP_LABELS[reason]}`);
    }
    if (failed > 0) parts.push(`${failed} con error (se reintentan en el corte diario)`);
    if (remaining > 0) parts.push(`${remaining} pendientes: vuelve a ejecutar`);
    if (schedule.isoFilled > 0) parts.push(`${schedule.isoFilled} fecha(s) de ingreso normalizadas`);
    if (schedule.unparseable.length > 0) {
      parts.push(`${schedule.unparseable.length} sin fecha de ingreso interpretable`);
    }

    return {
      scheduled: schedule.created,
      isoFilled: schedule.isoFilled,
      ownersRecovered,
      evaluated,
      skipped,
      failed,
      remaining,
      sinFechaDeIngreso: schedule.unparseable,
      message: `${parts.join(', ')}.`,
    };
  },
);
