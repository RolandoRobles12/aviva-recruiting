import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { countDealsByOwner } from '../integrations/hubspotService';
import { parseCandidateStartDate } from '../utils/startDate';
import { VERDICT_APPLIES_STATUSES, performanceWindow, resolveMonthlyTarget } from './targets';

interface RecalcSummary {
  evaluados: number;
  promotorExitoso: number;
  bajoDesempeno: number;
  sinCambio: number;
  omitidos: number;
  sinDatos: string[];
  errores: string[];
  message: string;
}

/**
 * Re-evaluates candidates whose 30-day check already ran, using the correct
 * [inicio, inicio + N días] window.
 *
 * Two populations need this:
 *  - candidates evaluated before the bajo_desempeno status existed, who missed
 *    their target and stayed in a pre-30-day status forever (nothing re-runs a
 *    check once its doc is marked processed);
 *  - candidates whose check was processed late — a backfilled check evaluated
 *    months after day 30 counted every deal since their start date against a
 *    monthly target, so the stored count is inflated.
 *
 * The recount is reproducible because the window is closed at both ends, so
 * running this repeatedly converges instead of drifting.
 *
 * Never touches promotor_exitoso or disqualified candidates: both are settled
 * outcomes, and the promoted ones already have a Viterbit stage to match.
 * Candidates that now meet their target are flagged promotorMovePending rather
 * than written straight to promotor_exitoso, so the daily job performs the
 * Viterbit stage move instead of letting the dashboard drift out of sync.
 */
export const recalculatePerformanceStatuses = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<RecalcSummary> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const snapshot = await db
      .collection('candidates')
      .where('performance30DayCheckedAt', '!=', null)
      .get();

    let evaluados = 0;
    let promotorExitoso = 0;
    let bajoDesempeno = 0;
    let sinCambio = 0;
    let omitidos = 0;
    const sinDatos: string[] = [];
    const errores: string[] = [];

    for (const docSnap of snapshot.docs) {
      const c = docSnap.data();
      const status = c.status as string;

      // Settled outcomes — left exactly as they are.
      if (status === 'promotor_exitoso' || status === 'disqualified') {
        omitidos++;
        continue;
      }

      const hubspotOwnerId = c.hubspotOwnerId as string | undefined;
      const startDate = parseCandidateStartDate(c);
      if (!hubspotOwnerId || !startDate) {
        sinDatos.push(docSnap.id);
        continue;
      }

      const { target: monthlyTarget } = resolveMonthlyTarget(
        c.profile as string | undefined,
        c.position as string | undefined,
      );

      try {
        const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

        // The 15-day count is informational, but recompute it when it exists so
        // the stored figures agree with the windows they claim to measure.
        if (c.performance15DayCheckedAt) {
          const w15 = performanceWindow(startDate, 15);
          updates.performance15DayDeals = await countDealsByOwner(hubspotOwnerId, w15.fromMs, w15.toMs);
        }

        const w30 = performanceWindow(startDate, 30);
        const dealCount = await countDealsByOwner(hubspotOwnerId, w30.fromMs, w30.toMs);
        updates.performance30DayDeals = dealCount;
        evaluados++;

        if (dealCount >= monthlyTarget) {
          if (c.promotorMovePending === true) {
            sinCambio++;
          } else {
            updates.promotorMovePending = true;
            promotorExitoso++;
          }
        } else if (status === 'bajo_desempeno') {
          sinCambio++;
        } else if (VERDICT_APPLIES_STATUSES.includes(status)) {
          updates.status = 'bajo_desempeno';
          // A candidate who no longer meets the target must not keep a stale
          // move flag queued from an earlier, inflated count.
          if (c.promotorMovePending === true) updates.promotorMovePending = FieldValue.delete();
          bajoDesempeno++;
        } else {
          sinCambio++;
        }

        await docSnap.ref.update(updates);
      } catch (err) {
        console.error(`[recalculatePerformance] ${docSnap.id} failed:`, err);
        errores.push(docSnap.id);
      }
    }

    const message =
      `${evaluados} candidato(s) recalculados con la ventana correcta: ` +
      `${promotorExitoso} marcado(s) para pasar a Promotor Exitoso (el job diario hace el movimiento en Viterbit), ` +
      `${bajoDesempeno} marcado(s) como Bajo Desempeño, ${sinCambio} sin cambio. ` +
      `${omitidos} omitido(s) por estar en Promotor Exitoso o descalificados. ` +
      `${sinDatos.length} sin owner de HubSpot o sin fecha de inicio. ` +
      `${errores.length} con error.`;

    console.info(`[recalculatePerformance] ${message}`);

    return { evaluados, promotorExitoso, bajoDesempeno, sinCambio, omitidos, sinDatos, errores, message };
  },
);
