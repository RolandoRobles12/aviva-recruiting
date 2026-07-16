import { randomBytes } from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { getLinkDuration } from '../utils/linkDuration';
import { toIsoDateString } from '../utils/startDate';
import { sendOfferEmailCore } from './sendOfferEmail';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function fetchHiredInfo(
  candidatureId: string,
  apiKey: string,
): Promise<{ salary: string; startDate: string; startDateIso: string }> {
  const empty = { salary: '', startDate: '', startDateIso: '' };
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return empty;
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const hiredInfo = (data.hired_info as Record<string, unknown>) ?? {};
    const salaryAmount = hiredInfo.salary as number | undefined;
    const currency = (hiredInfo.currency as string) ?? 'MXN';
    const rawStartDate = (hiredInfo.start_at as string) ?? '';
    return {
      salary: salaryAmount ? `$${salaryAmount.toLocaleString('es-MX')} ${currency}` : '',
      startDate: rawStartDate ? format(new Date(rawStartDate), "d 'de' MMMM 'de' yyyy", { locale: es }) : '',
      startDateIso: toIsoDateString(rawStartDate),
    };
  } catch {
    return empty;
  }
}

/**
 * Re-issues the offer letter for a candidate whose hiring details (usually the
 * start date) were wrong, WITHOUT deleting the candidate: uploaded documents,
 * OCR validations, Drive folder, and form link are all preserved.
 *
 * - Refreshes salary/start date from Viterbit (fix them there first).
 * - Archives the previously signed offer/contract to the reissue_history
 *   subcollection for audit.
 * - Invalidates the old offer and contract (both embed the start date) and
 *   sends a fresh offer link.
 * - Stores reissuePriorStatus so signOffer can resume the flow after the
 *   re-signature: if documents were already complete, the corrected contract
 *   is regenerated and sent automatically (via the under_review transition in
 *   onCandidateUpdated).
 * - Moves the candidate back to "Oferta Enviada" in Viterbit.
 */
export const reissueOffer = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId, reason } = request.data as { candidateId: string; reason?: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId es requerido');

    const snap = await db.collection('candidates').doc(candidateId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato no encontrado');
    const candidate = snap.data()!;

    if (candidate.status === 'disqualified') {
      throw new HttpsError('failed-precondition', 'El candidato está descalificado.');
    }

    // Refresh hiring details from Viterbit — the recruiter fixes the date there first.
    const apiKey = VITERBIT_API_KEY.value();
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;
    const refreshed = candidatureId && apiKey
      ? await fetchHiredInfo(candidatureId, apiKey)
      : { salary: '', startDate: '', startDateIso: '' };

    const viterbitSalary = refreshed.salary || (candidate.viterbitSalary as string) || '';
    const viterbitStartDate = refreshed.startDate || (candidate.viterbitStartDate as string) || '';
    const viterbitStartDateIso = refreshed.startDateIso || (candidate.viterbitStartDateIso as string) || '';

    if (!viterbitSalary.trim() || !viterbitStartDate.trim()) {
      const missing = [!viterbitSalary.trim() && 'salario', !viterbitStartDate.trim() && 'fecha de inicio'].filter(Boolean).join(' y ');
      throw new HttpsError('failed-precondition', `Faltan datos en Viterbit: ${missing}. Corrígelos allá y vuelve a intentar.`);
    }

    // Archive the current offer/contract state for audit before invalidating it.
    const priorStatus = candidate.status as string;
    const pick = (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (candidate[k] !== undefined) out[k] = candidate[k];
      return out;
    };
    await snap.ref.collection('reissue_history').add({
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: request.auth.uid,
      reason: reason || null,
      priorStatus,
      priorViterbitStartDate: candidate.viterbitStartDate ?? null,
      priorViterbitSalary: candidate.viterbitSalary ?? null,
      offer: pick(['offerToken', 'offerExpiresAt', 'offerSignedAt', 'offerSignatureUrl', 'offerPdfUrl']),
      contract: pick(['contractToken', 'contractExpiresAt', 'contractTemplateId', 'contractSignedAt', 'contractSignatureUrl', 'contractPdfUrl', 'contractEvidenceUrl']),
    });

    // New offer link; old offer and contract are invalidated (both embed the start date).
    const offerToken = randomBytes(32).toString('hex');
    const linkDurations = await getLinkDuration();
    const offerExpiresAt = new Date(Date.now() + linkDurations.offerDays * 24 * 60 * 60 * 1000);

    await snap.ref.update({
      viterbitSalary,
      viterbitStartDate,
      viterbitStartDateIso: viterbitStartDateIso || null,
      status: 'offer_sent',
      offerToken,
      offerExpiresAt,
      offerEmailSent: true,
      reissuePriorStatus: priorStatus,
      reissuedAt: FieldValue.serverTimestamp(),
      reissueCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      // Clear signature artifacts — documents, formToken, OCR results, and the
      // Drive folder are intentionally untouched.
      offerSignedAt: FieldValue.delete(),
      offerSignatureUrl: FieldValue.delete(),
      offerPdfUrl: FieldValue.delete(),
      contractToken: FieldValue.delete(),
      contractExpiresAt: FieldValue.delete(),
      contractTemplateId: FieldValue.delete(),
      contractSignedAt: FieldValue.delete(),
      contractSignatureUrl: FieldValue.delete(),
      contractPdfUrl: FieldValue.delete(),
      contractEvidenceUrl: FieldValue.delete(),
      contractEvidence: FieldValue.delete(),
    });

    // Move back to "Oferta Enviada" in Viterbit (fire-and-forget).
    const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const ofertaEnviadaId = stageIds?.ofertaEnviada;
    if (apiKey && candidatureId && ofertaEnviadaId) {
      void fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage_id: ofertaEnviadaId }),
      }).then((resp) => {
        if (!resp.ok) console.error(`[reissueOffer] Viterbit stage move failed: HTTP ${resp.status}`);
      }).catch((err) => console.error('[reissueOffer] Viterbit stage move error:', err));
    }

    // Send the new offer email with the refreshed data.
    await sendOfferEmailCore(
      candidateId,
      { ...candidate, offerToken, offerExpiresAt, viterbitSalary, viterbitStartDate },
      request.auth.uid,
    );

    return { success: true };
  }
);
