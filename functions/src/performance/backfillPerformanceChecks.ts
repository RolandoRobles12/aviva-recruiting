import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { parseCandidateStartDate } from '../utils/startDate';

// Statuses at or past contract signing — the point where checks should have been scheduled.
const SIGNED_STATUSES = [
  'contract_signed',
  'email_pending',
  'email_ready',
  'induction',
  'onboarding_iniciado',
  'promotor_exitoso',
  'bajo_desempeno',
];

/**
 * Creates the pending_performance_checks docs (15d/30d) that signContract
 * failed to schedule while the viterbitStartDate parsing bug aborted the
 * post-signature flow. Idempotent: skips checks that already exist or that
 * were already evaluated (performance15/30DayCheckedAt set on the candidate).
 * processAfter dates in the past are picked up by the next 09:00 scheduler run.
 */
export const backfillPerformanceChecks = onCall(
  // Walks every signed candidate with sequential reads/writes; the 60s default
  // would abort a large run halfway (it is idempotent, but silently partial).
  { region: 'us-central1', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const snapshot = await db
      .collection('candidates')
      .where('status', 'in', SIGNED_STATUSES)
      .get();

    let created = 0;
    let skipped = 0;
    const unparseable: string[] = [];

    for (const docSnap of snapshot.docs) {
      const candidate = docSnap.data();

      const startDate = parseCandidateStartDate(candidate);
      if (!startDate) {
        unparseable.push(docSnap.id);
        continue;
      }

      for (const daysMark of [15, 30] as const) {
        const checkedField = daysMark === 15 ? 'performance15DayCheckedAt' : 'performance30DayCheckedAt';
        if (candidate[checkedField]) {
          skipped++;
          continue;
        }

        const checkRef = db.collection('pending_performance_checks').doc(`${docSnap.id}_${daysMark}d`);
        if ((await checkRef.get()).exists) {
          skipped++;
          continue;
        }

        const processAfter = new Date(startDate.getTime() + daysMark * 24 * 60 * 60 * 1000);
        await checkRef.set({
          candidateId: docSnap.id,
          daysMark,
          processed: false,
          processAfter: Timestamp.fromDate(processAfter),
          createdAt: FieldValue.serverTimestamp(),
          backfilled: true,
        });
        created++;
      }
    }

    return {
      created,
      skipped,
      unparseable,
      message: `${created} check(s) creados, ${skipped} ya existían o ya fueron evaluados, ${unparseable.length} candidato(s) sin fecha de inicio interpretable.`,
    };
  },
);
