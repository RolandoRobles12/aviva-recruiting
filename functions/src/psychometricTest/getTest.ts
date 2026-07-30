import { onRequest } from 'firebase-functions/v2/https';
import { getOrSeedConfig, getQuestionBank } from './bankStore';
import { assembleTest } from './sampling';
import { findSessionByToken } from './sessionStore';
import {
  appliedQuestionsOf,
  deadlineOf,
  expiresAtOf,
  optionOrdersOf,
  progressAnswersOf,
  startedAtOf,
  timeLimitOf,
} from './sessionData';
import { sanitizeAnswers } from './scoring';
import type { PsychometricQuestion } from './types';

export type TestSection = 'personalidad' | 'escenarios';

/**
 * The candidate-facing shape of a question. Scale membership, keying and option
 * scores never leave the server: with them, the "right" answers are trivial to
 * work out from the payload.
 */
interface PublicQuestion {
  id: string;
  type: 'likert' | 'attention' | 'sjt';
  text: string;
  section: TestSection;
  options?: string[];
}

function toPublicQuestion(
  question: PsychometricQuestion,
  optionOrders: Record<string, number[]>
): PublicQuestion {
  if (question.type === 'sjt') {
    const order = optionOrders[question.id] ?? question.options.map((_, index) => index);
    return {
      id: question.id,
      type: 'sjt',
      text: question.text,
      section: 'escenarios',
      options: order.map((index) => question.options[index]?.text ?? '').filter(Boolean),
    };
  }
  return { id: question.id, type: question.type, text: question.text, section: 'personalidad' };
}

/**
 * Public endpoint: fetch (and start, if not yet started) a psychometric test
 * session by token.
 *
 * On the first open the session freezes a full snapshot of the questions it will
 * apply — not just their ids — so editing the bank while somebody is mid-test
 * cannot change what they are scored on. On a later open it resumes: same
 * questions, same option order, the answers already saved, and the remaining
 * time measured from the server-assigned start.
 */
export const getPsychometricTest = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const token = req.query['token'] as string | undefined;
    if (!token) {
      res.status(400).json({ ok: false, error: 'token is required' });
      return;
    }

    try {
      const found = await findSessionByToken(token);
      if (!found) {
        res.status(404).json({ ok: false, error: 'No se encontró la prueba. Verifica tu enlace.' });
        return;
      }

      const { ref: sessionRef, data: session } = found;
      const now = new Date();

      if (session.status === 'completed') {
        res.status(409).json({ ok: false, error: 'already_completed' });
        return;
      }
      if (session.status === 'expired') {
        res.status(410).json({ ok: false, error: 'Este enlace ha expirado.' });
        return;
      }

      const linkExpiresAt = expiresAtOf(session);
      if (session.status === 'pending' && linkExpiresAt && now > linkExpiresAt) {
        await sessionRef.update({ status: 'expired' });
        res.status(410).json({ ok: false, error: 'Este enlace ha expirado. Solicita uno nuevo.' });
        return;
      }

      const config = await getOrSeedConfig();
      const timeLimitMinutes = timeLimitOf(session, config);

      // peek=1 reads the session without starting it, so the instructions screen
      // can state the real time limit and length instead of a hardcoded guess.
      // Starting the timer must stay tied to the candidate pressing "Comenzar".
      if (req.query['peek'] === '1') {
        const bank = await getQuestionBank();
        const planned = assembleTest(bank, config).questions.length;
        res.status(200).json({
          ok: true,
          preview: {
            candidateName: session.candidateName as string,
            timeLimitMinutes,
            totalQuestions: planned,
            alreadyStarted: session.status === 'in_progress',
          },
        });
        return;
      }

      if (session.status === 'in_progress') {
        const deadline = deadlineOf(session, config);
        if (deadline && now > deadline) {
          await sessionRef.update({ status: 'expired' });
          res.status(410).json({ ok: false, error: 'El tiempo para responder la prueba ha terminado.' });
          return;
        }
      }

      const alreadyStarted =
        session.status === 'in_progress' &&
        Array.isArray(session.questionOrder) &&
        (session.questionOrder as string[]).length > 0;

      let questions: PsychometricQuestion[];
      let optionOrders: Record<string, number[]>;
      let startedAt: Date | undefined;

      if (alreadyStarted) {
        const bank = await getQuestionBank();
        questions = appliedQuestionsOf(session, bank);
        optionOrders = optionOrdersOf(session);
        startedAt = startedAtOf(session);
      } else {
        const bank = await getQuestionBank();
        const assembled = assembleTest(bank, config);
        if (assembled.questions.length === 0) {
          res.status(503).json({
            ok: false,
            error: 'No hay preguntas configuradas todavía. Contacta al equipo de reclutamiento.',
          });
          return;
        }

        questions = assembled.questions;
        optionOrders = assembled.optionOrders;
        startedAt = now;

        await sessionRef.update({
          status: 'in_progress',
          startedAt: now,
          questionOrder: questions.map((question) => question.id),
          // Snapshot of the exact items applied, so scoring is independent of
          // any later change to the bank.
          appliedQuestions: questions,
          optionOrders,
          configSnapshot: config,
        });
      }

      if (questions.length === 0) {
        res.status(503).json({
          ok: false,
          error: 'La prueba no tiene preguntas disponibles. Contacta al equipo de reclutamiento.',
        });
        return;
      }

      // Only hand back answers that still match a question in the session, so a
      // resumed test cannot be restored into an inconsistent state.
      const saved = sanitizeAnswers(questions, progressAnswersOf(session), optionOrders).answers;

      res.status(200).json({
        ok: true,
        session: {
          candidateName: session.candidateName as string,
          timeLimitMinutes,
          startedAtIso: startedAt?.toISOString(),
          // Lets the client correct for a device clock that is off, instead of
          // trusting Date.now() to agree with the server about the deadline.
          serverNowIso: now.toISOString(),
          questions: questions.map((question) => toPublicQuestion(question, optionOrders)),
          savedAnswers: saved.map(({ questionId, value }) => ({ questionId, value })),
        },
      });
    } catch (err) {
      console.error('[getPsychometricTest] Unhandled error:', err);
      res.status(500).json({ ok: false, error: 'Error al cargar la prueba. Intenta recargar la página.' });
    }
  }
);
