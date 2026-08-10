import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { countDealsByOwner, findOwnerIdByEmail } from '../integrations/hubspotService';
import { parseCandidateStartDate } from '../utils/startDate';
import { decidePerformanceOutcome, performanceWindow, resolveMonthlyTarget } from './targets';

/** One candidate whose stage would change (or did change) in this run. */
interface CandidateChange {
  candidateId: string;
  nombre: string;
  perfil: string;
  statusAnterior: string;
  statusNuevo: 'promotor_exitoso' | 'bajo_desempeno';
  dealsAntes: number | null;
  dealsDespues: number;
  meta: number;
}

interface RecalcRequest {
  /** When true, nothing is written: the same verdict is computed and reported. */
  dryRun?: boolean;
}

interface RecalcSummary {
  dryRun: boolean;
  evaluados: number;
  promotorExitoso: number;
  bajoDesempeno: number;
  sinCambio: number;
  /** Stored deal count corrected, stage unchanged. */
  conteoAjustado: number;
  omitidos: number;
  sinDatos: string[];
  errores: string[];
  cambios: CandidateChange[];
  message: string;
}

/** Guard against an unbounded callable response on a very large recount. */
const MAX_REPORTED_CHANGES = 500;

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
 *
 * With dryRun the run is identical except that nothing is written — the same
 * HubSpot recounts, the same verdicts, the same report. The correct window can
 * only lower a count (the old one stayed open past day 30) and the profile fix
 * can only raise a target, so a real run moves candidates towards Bajo
 * Desempeño; simulating it first shows exactly who, and from which number.
 */
export const recalculatePerformanceStatuses = onCall<RecalcRequest>(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<RecalcSummary> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const dryRun = request.data?.dryRun === true;
    const label = dryRun ? '[recalculatePerformance:simulacion]' : '[recalculatePerformance]';

    const snapshot = await db
      .collection('candidates')
      .where('performance30DayCheckedAt', '!=', null)
      .get();

    let evaluados = 0;
    let promotorExitoso = 0;
    let bajoDesempeno = 0;
    let sinCambio = 0;
    let conteoAjustado = 0;
    let omitidos = 0;
    const sinDatos: string[] = [];
    const errores: string[] = [];
    const cambios: CandidateChange[] = [];

    for (const docSnap of snapshot.docs) {
      const c = docSnap.data();
      const status = c.status as string;

      // Settled outcomes — left exactly as they are.
      if (status === 'promotor_exitoso' || status === 'disqualified') {
        omitidos++;
        continue;
      }

      const startDate = parseCandidateStartDate(c);
      if (!startDate) {
        sinDatos.push(docSnap.id);
        continue;
      }

      // Same self-heal the daily check does: candidates provisioned while
      // HubSpot creation failed carry a corporateEmail but no cached owner id,
      // and would otherwise be skipped by every run of this tool.
      let hubspotOwnerId = c.hubspotOwnerId as string | undefined;
      let recoveredOwnerId = false;
      if (!hubspotOwnerId) {
        const corporateEmail = c.corporateEmail as string | undefined;
        hubspotOwnerId = (corporateEmail ? await findOwnerIdByEmail(corporateEmail) : null) ?? undefined;
        if (!hubspotOwnerId) {
          sinDatos.push(docSnap.id);
          continue;
        }
        recoveredOwnerId = true;
      }

      const { target: monthlyTarget } = resolveMonthlyTarget(
        c.profile as string | undefined,
        c.position as string | undefined,
      );

      try {
        const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
        if (recoveredOwnerId) updates.hubspotOwnerId = hubspotOwnerId;

        // The 15-day count is informational, but recompute it when it exists so
        // the stored figures agree with the windows they claim to measure.
        if (c.performance15DayCheckedAt) {
          const w15 = performanceWindow(startDate, 15);
          updates.performance15DayDeals = await countDealsByOwner(hubspotOwnerId, w15.fromMs, w15.toMs);
        }

        const w30 = performanceWindow(startDate, 30);
        const dealCount = await countDealsByOwner(hubspotOwnerId, w30.fromMs, w30.toMs);
        const dealsAntes = typeof c.performance30DayDeals === 'number' ? c.performance30DayDeals : null;
        updates.performance30DayDeals = dealCount;

        const outcome = decidePerformanceOutcome({
          status,
          dealCount,
          monthlyTarget,
          promotorMovePending: c.promotorMovePending === true,
        });

        if (outcome === 'promotor') {
          updates.promotorMovePending = true;
        } else {
          if (outcome === 'bajo') updates.status = 'bajo_desempeno';
          // A candidate who no longer meets the target must not keep a stale
          // move flag queued from an earlier, inflated count — it would promote
          // them on the next daily run.
          if (dealCount < monthlyTarget && c.promotorMovePending === true) {
            updates.promotorMovePending = FieldValue.delete();
          }
        }

        // Counted only once the write lands, so the summary never reports a
        // change that failed midway. A simulation skips the write and reports
        // the very same verdict.
        if (!dryRun) await docSnap.ref.update(updates);

        evaluados++;
        if (outcome === 'promotor') promotorExitoso++;
        else if (outcome === 'bajo') bajoDesempeno++;
        else {
          sinCambio++;
          if (dealsAntes !== dealCount) conteoAjustado++;
        }

        if (outcome !== 'sin_cambio' && cambios.length < MAX_REPORTED_CHANGES) {
          cambios.push({
            candidateId: docSnap.id,
            nombre: `${(c.firstName as string) ?? ''} ${(c.lastName as string) ?? ''}`.trim(),
            perfil: (c.profile as string) || (c.position as string) || '—',
            statusAnterior: status,
            statusNuevo: outcome === 'promotor' ? 'promotor_exitoso' : 'bajo_desempeno',
            dealsAntes,
            dealsDespues: dealCount,
            meta: monthlyTarget,
          });
        }
      } catch (err) {
        console.error(`${label} ${docSnap.id} failed:`, err);
        errores.push(docSnap.id);
      }
    }

    const verbo = dryRun ? 'cambiaría(n)' : 'cambiado(s)';
    const message =
      (dryRun ? 'SIMULACIÓN (no se escribió nada). ' : '') +
      `${evaluados} candidato(s) recalculados con la ventana correcta: ` +
      `${promotorExitoso} ${verbo} a Promotor Exitoso` +
      (dryRun ? '' : ' (el job diario hace el movimiento en Viterbit)') + ', ' +
      `${bajoDesempeno} ${verbo} a Bajo Desempeño, ${sinCambio} sin cambio de etapa ` +
      `(${conteoAjustado} con el conteo de deals corregido). ` +
      `${omitidos} omitido(s) por estar en Promotor Exitoso o descalificados. ` +
      `${sinDatos.length} sin owner de HubSpot o sin fecha de inicio. ` +
      `${errores.length} con error.` +
      (cambios.length >= MAX_REPORTED_CHANGES ? ` Se listan los primeros ${MAX_REPORTED_CHANGES} cambios.` : '');

    console.info(`${label} ${message}`);

    return {
      dryRun,
      evaluados,
      promotorExitoso,
      bajoDesempeno,
      sinCambio,
      conteoAjustado,
      omitidos,
      sinDatos,
      errores,
      cambios,
      message,
    };
  },
);
