import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../utils/admin';
import { syncCandidateFromViterbit } from './syncCandidate';
import { releaseHeldOffer } from './releaseHeldOffer';
import { VITERBIT_API_KEY } from '../utils/secrets';


/**
 * Re-reads Viterbit for one candidate and writes back everything that changed:
 * nombre, correo, teléfono, salario, fecha de inicio, buró, psicometría,
 * puesto, hiring manager, empresa, perfil, plaza y ciudad.
 *
 * It is the same sync the Viterbit update webhook and the bulk sweep run, so
 * pressing the button can only bring the record forward to what Viterbit says —
 * never to a different answer than the webhook would have written.
 */
export const refreshCandidateViterbit = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId requerido');

    const snap = await db.collection('candidates').doc(candidateId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato no encontrado');

    const candidate = snap.data()!;
    if (!candidate.viterbitCandidateId && !candidate.viterbitCandidatureId && !candidate.viterbitJobId) {
      throw new HttpsError('failed-precondition', 'El candidato no está vinculado a Viterbit.');
    }

    const apiKey = VITERBIT_API_KEY.value();
    if (!apiKey) throw new HttpsError('failed-precondition', 'VITERBIT_API_KEY no está configurada.');

    const { changed, updates, snapshot } = await syncCandidateFromViterbit(snap.ref, candidate, apiKey);

    // The candidate was parked in offer_held because a hiring detail was
    // missing. If this refresh just filled in the last one, send the letter now
    // instead of leaving the recruiter to notice and press "Reenviar correo de
    // carta oferta" separately — refreshing IS the fix, so it should finish the
    // job.
    const release = await releaseHeldOffer(candidateId, candidate, updates, request.auth.uid);

    return {
      success: true,
      /** Fields written by this refresh; empty means Viterbit had nothing new. */
      changed,
      salary: snapshot.salary || null,
      startDate: snapshot.startDate || null,
      position: snapshot.position || null,
      buro: snapshot.buro || null,
      psicometriaIntegridad: snapshot.psicometriaIntegridad || null,
      offerAutoSent: release.sent,
      offerAutoSendError: release.error,
    };
  },
);
