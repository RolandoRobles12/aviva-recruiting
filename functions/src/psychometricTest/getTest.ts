import { onRequest } from 'firebase-functions/v2/https';
import { db } from '../utils/admin';
import { shuffle, PSYCHOMETRIC_TRAITS, type PsychometricQuestion } from './scoring';
import { getQuestionBank, getOrSeedConfig } from './bankStore';

/** Sample `count` items at random (0 = keep all). Clamps to what's available. */
function sample<T>(list: T[], count: number): T[] {
  if (!count || count <= 0 || count >= list.length) return list;
  return shuffle(list).slice(0, count);
}

/** Public endpoint: fetch (and start, if not yet started) a psychometric test session by token. */
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
      const snap = await db.collection('psychometric_sessions').where('token', '==', token).limit(1).get();
      if (snap.empty) {
        res.status(404).json({ ok: false, error: 'No se encontró la prueba. Verifica tu enlace.' });
        return;
      }

      const sessionRef = snap.docs[0].ref;
      const session = snap.docs[0].data();
      const now = new Date();

      if (session.status === 'completed') {
        res.status(409).json({ ok: false, error: 'already_completed' });
        return;
      }
      if (session.status === 'expired') {
        res.status(410).json({ ok: false, error: 'Este enlace ha expirado.' });
        return;
      }

      const linkExpiresAt = session.expiresAt?.toDate?.() as Date | undefined;
      if (session.status === 'pending' && linkExpiresAt && now > linkExpiresAt) {
        await sessionRef.update({ status: 'expired' });
        res.status(410).json({ ok: false, error: 'Este enlace ha expirado. Solicita uno nuevo.' });
        return;
      }

      const config = await getOrSeedConfig();
      const timeLimitMinutes = (session.timeLimitMinutes as number) || config.timeLimitMinutes;

      let questionOrder = session.questionOrder as string[] | undefined;
      let optionOrders = session.optionOrders as Record<string, number[]> | undefined;
      let startedAt = session.startedAt?.toDate?.() as Date | undefined;

      if (session.status === 'in_progress' && startedAt) {
        const elapsedMs = now.getTime() - startedAt.getTime();
        if (elapsedMs > timeLimitMinutes * 60 * 1000) {
          await sessionRef.update({ status: 'expired' });
          res.status(410).json({ ok: false, error: 'El tiempo para responder la prueba ha terminado.' });
          return;
        }
      }

      const bank = await getQuestionBank();
      const enabled = bank.filter((q) => q.enabled);

      if (enabled.length === 0) {
        res.status(503).json({ ok: false, error: 'No hay preguntas configuradas todavía. Contacta al equipo de reclutamiento.' });
        return;
      }

      const byId = new Map(enabled.map((q) => [q.id, q]));

      if (session.status === 'pending' || !questionOrder?.length) {
        // First open — sample the pool per config.questionCounts (0 = use all
        // enabled), then freeze the randomized order for the rest of the session.
        const likertPerTrait = config.questionCounts?.likertPerTrait ?? 0;
        const sjtCount = config.questionCounts?.sjt ?? 0;
        const selectedLikert = PSYCHOMETRIC_TRAITS.flatMap((trait) =>
          sample(enabled.filter((q) => q.type === 'likert' && q.trait === trait), likertPerTrait)
        );
        const selectedSjt = sample(enabled.filter((q) => q.type === 'sjt'), sjtCount);
        const selected = [...selectedLikert, ...selectedSjt];

        questionOrder = shuffle(selected.map((q) => q.id));
        optionOrders = {};
        for (const q of selected) {
          if (q.type === 'sjt') {
            optionOrders[q.id] = shuffle(q.options.map((_, i) => i));
          }
        }
        startedAt = now;
        await sessionRef.update({
          status: 'in_progress',
          startedAt: now,
          questionOrder,
          optionOrders,
        });
      }

      const questions = questionOrder
        .map((id) => byId.get(id))
        .filter((q): q is PsychometricQuestion => !!q)
        .map((q) => {
          if (q.type === 'likert') {
            return { id: q.id, type: 'likert' as const, text: q.text };
          }
          const order = optionOrders?.[q.id] ?? q.options.map((_, i) => i);
          return {
            id: q.id,
            type: 'sjt' as const,
            text: q.text,
            options: order.map((origIdx) => q.options[origIdx].text),
          };
        });

      res.status(200).json({
        ok: true,
        session: {
          candidateName: session.candidateName as string,
          timeLimitMinutes,
          startedAtIso: startedAt?.toISOString(),
          questions,
        },
      });
    } catch (err) {
      console.error('[getPsychometricTest] Unhandled error:', err);
      res.status(500).json({ ok: false, error: 'Error al cargar la prueba. Intenta recargar la página.' });
    }
  }
);
