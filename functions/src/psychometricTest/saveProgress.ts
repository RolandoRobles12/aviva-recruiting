import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { getOrSeedConfig, getQuestionBank } from './bankStore';
import { sanitizeAnswers } from './scoring';
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

/**
 * Public endpoint: store a partially answered test.
 *
 * The timer runs server-side and cannot be paused, so before this existed a
 * dropped connection, a phone locking or a closed tab meant the candidate lost
 * everything answered so far and burned their attempt. The client now saves
 * after each answer; `getPsychometricTest` hands the saved answers back on
 * resume, and `submitPsychometricTest` merges them in even if the final POST
 * arrives with less than the full set.
 */
export const savePsychometricProgress = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 30 },
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

      // Saving progress is a no-op rather than an error once the session is
      // closed: an autosave racing with the final submit must not surface a
      // scary message to a candidate who already finished.
      if (session.status !== 'in_progress') {
        res.status(200).json({ ok: true, saved: 0, ignored: true });
        return;
      }

      const config = await getOrSeedConfig();
      const deadline = deadlineOf(session, config);
      if (deadline && Date.now() > deadline.getTime() + SUBMIT_GRACE_MS) {
        res.status(200).json({ ok: true, saved: 0, ignored: true });
        return;
      }

      const bank = await getQuestionBank();
      const questions = appliedQuestionsOf(session, bank);
      const optionOrders = optionOrdersOf(session);
      const merged = mergeAnswers(progressAnswersOf(session), payload.answers);
      const { answers } = sanitizeAnswers(questions, merged, optionOrders);

      await sessionRef.update({
        progressAnswers: answers,
        progressUpdatedAt: FieldValue.serverTimestamp(),
      });

      res.status(200).json({ ok: true, saved: answers.length });
    } catch (err) {
      console.error('[savePsychometricProgress] Unhandled error:', err);
      res.status(500).json({ ok: false, error: 'No se pudo guardar el avance.' });
    }
  }
);
