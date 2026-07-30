import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getOrSeedConfig, getQuestionBank } from './bankStore';
import { normObservationsFrom, scoreSession } from './scoring';
import { emptyNorms, withObservation } from './norms';
import { findSessionByToken } from './sessionStore';
import {
  SUBMIT_GRACE_MS,
  appliedQuestionsOf,
  deadlineOf,
  mergeAnswers,
  optionOrdersOf,
  parseAnswerPayload,
  progressAnswersOf,
} from './sessionData';
import type { PsychometricNorms } from './types';

const NORMS_REF = () => db.collection('settings').doc('psychometric_norms');

class SubmitError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Public endpoint: submit answers for a psychometric test session and score them
 * server-side.
 *
 * Everything that matters happens in one transaction: the status flip to
 * `completed`, the scoring, and folding the scores into the local norm sample.
 * That makes a double submit (a retry, a double tap, an autosave racing the
 * final POST) impossible to score twice, and keeps the norm counters from
 * drifting when two candidates finish at the same instant.
 */
export const submitPsychometricTest = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const payload = parseAnswerPayload(req.body);
    if (!payload) {
      res.status(400).json({ ok: false, error: 'Se requiere el token y las respuestas.' });
      return;
    }

    try {
      const found = await findSessionByToken(payload.token);
      if (!found) {
        res.status(404).json({ ok: false, error: 'No se encontró la prueba.' });
        return;
      }

      const { ref: sessionRef, data: session } = found;
      const config = await getOrSeedConfig();

      if (session.status === 'completed') {
        res.status(409).json({ ok: false, error: 'Esta prueba ya fue enviada.' });
        return;
      }
      if (session.status !== 'in_progress') {
        res.status(409).json({ ok: false, error: 'Esta prueba aún no ha sido iniciada.' });
        return;
      }

      const deadline = deadlineOf(session, config);
      if (deadline && Date.now() > deadline.getTime() + SUBMIT_GRACE_MS) {
        await sessionRef.update({ status: 'expired' });
        res.status(410).json({ ok: false, error: 'El tiempo para responder la prueba ha terminado.' });
        return;
      }

      const bank = await getQuestionBank();
      const normsRef = NORMS_REF();

      const rejected = await db.runTransaction(async (tx) => {
        const [sessionSnap, normsSnap] = await Promise.all([tx.get(sessionRef), tx.get(normsRef)]);
        const current = sessionSnap.data();
        if (!current) throw new SubmitError(404, 'No se encontró la prueba.');
        if (current.status === 'completed') throw new SubmitError(409, 'Esta prueba ya fue enviada.');
        if (current.status !== 'in_progress') {
          throw new SubmitError(409, 'Esta prueba aún no ha sido iniciada.');
        }

        const questions = appliedQuestionsOf(current, bank);
        const optionOrders = optionOrdersOf(current);
        const answers = mergeAnswers(progressAnswersOf(current), payload.answers);

        const norms: PsychometricNorms = normsSnap.exists
          ? { scales: (normsSnap.data() as PsychometricNorms).scales ?? {} }
          : emptyNorms();

        const scored = scoreSession({ questions, answers, optionOrders, config, norms });

        tx.update(sessionRef, {
          status: 'completed',
          answers: scored.answers,
          result: scored.result,
          completedAt: FieldValue.serverTimestamp(),
          progressAnswers: FieldValue.delete(),
        });

        // Careless sessions stay out of the norm sample: including them widens
        // the distribution and pushes honest candidates toward the middle.
        if (scored.result.validity.verdict !== 'no_confiable') {
          let updated = norms;
          for (const observation of normObservationsFrom(scored.result)) {
            updated = withObservation(updated, observation.key, observation.value);
          }
          tx.set(
            normsRef,
            { scales: updated.scales, updatedAtIso: new Date().toISOString() },
            { merge: true }
          );
        }

        return scored.rejected;
      });

      if (rejected > 0) {
        console.warn(`[submitPsychometricTest] Descartadas ${rejected} respuestas inválidas del payload.`);
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof SubmitError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      console.error('[submitPsychometricTest] Unhandled error:', err);
      res.status(500).json({ ok: false, error: 'Error al enviar tus respuestas. Intenta de nuevo.' });
    }
  }
);
