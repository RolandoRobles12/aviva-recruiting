import { randomBytes } from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getLinkDuration } from '../utils/linkDuration';
import { userHasPermission } from '../utils/permissions';
import { evaluateContractDataReview } from './contractReview';
import { sendContractEmailCore } from '../email/sendContractEmail';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

/**
 * Re-issues the contract for a candidate whose contract data was wrong —
 * usually a CURP/RFC/domicilio/CLABE correction made in "Datos para el
 * contrato" AFTER the contract was already sent or signed, so the frozen PDF
 * (or the token the candidate is about to sign) still carries the old value.
 *
 * Mirrors reissueOffer: archives the current contract state for audit,
 * invalidates the old contract (new token; signature/PDF/evidence cleared),
 * and sends a fresh one. The offer itself and uploaded documents are
 * untouched — only the contract restarts.
 */
export const reissueContract = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    // Restricted action — mirrors the process_reissue_offer permission defaults.
    const allowed = await userHasPermission(request.auth.uid, 'process_reissue_contract', {
      lider: true,
      nomina: true,
      legal: true,
      reclutador: false,
    });
    if (!allowed) {
      throw new HttpsError('permission-denied', 'Solo el líder de reclutamiento, nómina, legal o un admin pueden reemitir el contrato.');
    }

    const { candidateId, reason } = request.data as { candidateId: string; reason?: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId es requerido');

    const snap = await db.collection('candidates').doc(candidateId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato no encontrado');
    const candidate = snap.data()!;

    if (candidate.status === 'disqualified') {
      throw new HttpsError('failed-precondition', 'El candidato está descalificado.');
    }
    if (!candidate.contractTemplateId) {
      throw new HttpsError('failed-precondition', 'Este candidato aún no tiene un contrato generado.');
    }

    // Validate BEFORE touching anything — corrections happen in "Datos para
    // el contrato" first; a candidate whose data still doesn't pass shouldn't
    // lose their existing signed contract over a reissue attempt that will
    // just fail again at send time.
    const missingSalary = !(candidate.viterbitSalary as string | undefined)?.trim();
    const missingDate = !(candidate.viterbitStartDate as string | undefined)?.trim();
    if (missingSalary || missingDate) {
      const missing = [missingSalary && 'salario', missingDate && 'fecha de inicio'].filter(Boolean).join(' y ');
      throw new HttpsError('failed-precondition', `Faltan datos de Viterbit: ${missing}. Corrígelos y vuelve a intentar.`);
    }
    const review = evaluateContractDataReview(candidate);
    if (review.required) {
      throw new HttpsError(
        'failed-precondition',
        `Revisa y confirma los datos del contrato antes de reemitirlo: ${review.reasons.join(' ')}`,
      );
    }

    // Archive the current contract state for audit before invalidating it.
    const pick = (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (candidate[k] !== undefined) out[k] = candidate[k];
      return out;
    };
    await snap.ref.collection('reissue_history').add({
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: request.auth.uid,
      reason: reason || null,
      priorStatus: candidate.status as string,
      scope: 'contract',
      contract: pick([
        'contractToken', 'contractExpiresAt', 'contractTemplateId',
        'contractSignedAt', 'contractSignatureUrl', 'contractPdfUrl',
        'contractEvidenceUrl', 'contractEvidence',
      ]),
    });

    // New contract link; the old one (and its signature, if any) is invalidated.
    const contractTokenValue = randomBytes(32).toString('hex');
    const linkDurations = await getLinkDuration();
    const contractExpiresAt = new Date(Date.now() + linkDurations.contractDays * 24 * 60 * 60 * 1000);

    await snap.ref.update({
      // Set status in this same write — leaving it at 'contract_signed' until
      // sendContractEmailCore's later update would let a listener briefly see
      // "firmado" with no contractSignedAt/PDF (same reasoning as reissueOffer).
      status: 'contract_sent',
      contractToken: contractTokenValue,
      contractExpiresAt,
      contractReissuedAt: FieldValue.serverTimestamp(),
      contractReissueCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      // Clear signature artifacts from the previous (possibly wrong) contract.
      // Uploaded documents, the offer, and the Drive folder are untouched.
      contractSignedAt: FieldValue.delete(),
      contractSignatureUrl: FieldValue.delete(),
      contractPdfUrl: FieldValue.delete(),
      contractEvidenceUrl: FieldValue.delete(),
      contractEvidence: FieldValue.delete(),
    });

    // Move back to "Contrato" in Viterbit (fire-and-forget) — the candidate may
    // already be sitting in Onboarding there after the invalidated signature.
    const apiKey = VITERBIT_API_KEY.value();
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;
    const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const contratoStageId = stageIds?.contrato;
    if (apiKey && candidatureId && contratoStageId) {
      void fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage_id: contratoStageId }),
      }).then((resp) => {
        if (!resp.ok) console.error(`[reissueContract] Viterbit stage move failed: HTTP ${resp.status}`);
      }).catch((err) => console.error('[reissueContract] Viterbit stage move error:', err));
    }

    // Send the new contract email with the corrected data.
    await sendContractEmailCore(
      candidateId,
      { ...candidate, contractToken: contractTokenValue, contractExpiresAt },
      request.auth.uid,
    );

    return { success: true };
  },
);
