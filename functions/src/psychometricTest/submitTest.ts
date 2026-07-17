import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import {
  scoreAnswers,
  type PsychometricAnswer,
  type PsychometricQuestion,
  type PsychometricTestConfig,
} from './scoring';

const DEFAULT_CONFIG: PsychometricTestConfig = {
  weights: { responsabilidad: 0.2, estabilidad_emocional: 0.2, extraversion: 0.2, amabilidad: 0.2, sjt: 0.2 },
  bandCutoffs: { lowMax: 40, highMin: 70 },
  timeLimitMinutes: 30,
};

// Grace period so a slow network doesn't fail a candidate who submitted in time.
const SUBMIT_GRACE_MS = 60_000;

/** Public endpoint: submit answers for a psychometric test session and score it server-side. */
export const submitPsychometricTest = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const { token, answers } = req.body as { token?: string; answers?: PsychometricAnswer[] };
    if (!token || !Array.isArray(answers)) {
      res.status(400).json({ ok: false, error: 'Se requiere el token y las respuestas.' });
      return;
    }

    try {
      const snap = await db.collection('psychometric_sessions').where('token', '==', token).limit(1).get();
      if (snap.empty) {
        res.status(404).json({ ok: false, error: 'No se encontró la prueba.' });
        return;
      }

      const sessionRef = snap.docs[0].ref;
      const session = snap.docs[0].data();

      if (session.status === 'completed') {
        res.status(409).json({ ok: false, error: 'Esta prueba ya fue enviada.' });
        return;
      }
      if (session.status !== 'in_progress') {
        res.status(409).json({ ok: false, error: 'Esta prueba aún no ha sido iniciada.' });
        return;
      }

      const startedAt = session.startedAt?.toDate?.() as Date | undefined;
      const timeLimitMinutes = (session.timeLimitMinutes as number) || DEFAULT_CONFIG.timeLimitMinutes;
      const now = new Date();
      if (startedAt && now.getTime() - startedAt.getTime() > timeLimitMinutes * 60 * 1000 + SUBMIT_GRACE_MS) {
        await sessionRef.update({ status: 'expired' });
        res.status(410).json({ ok: false, error: 'El tiempo para responder la prueba ha terminado.' });
        return;
      }

      const [bankSnap, configSnap] = await Promise.all([
        db.collection('settings').doc('psychometric_questions').get(),
        db.collection('settings').doc('psychometric_config').get(),
      ]);
      const bank = (bankSnap.data()?.questions as PsychometricQuestion[] | undefined) ?? [];
      const config = (configSnap.data() as PsychometricTestConfig | undefined) ?? DEFAULT_CONFIG;
      const optionOrders = (session.optionOrders as Record<string, number[]>) ?? {};

      const result = scoreAnswers(bank, answers, optionOrders, config);

      await sessionRef.update({
        status: 'completed',
        answers,
        result,
        completedAt: FieldValue.serverTimestamp(),
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[submitPsychometricTest] Unhandled error:', err);
      res.status(500).json({ ok: false, error: 'Error al enviar tus respuestas. Intenta de nuevo.' });
    }
  }
);
