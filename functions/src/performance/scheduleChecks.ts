import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { parseCandidateStartDate } from '../utils/startDate';

/** Statuses at or past contract signing — the point where checks should have been scheduled. */
export const SIGNED_STATUSES = [
  'contract_signed',
  'email_pending',
  'email_ready',
  'induction',
  'onboarding_iniciado',
  'promotor_exitoso',
  'bajo_desempeno',
];

export interface ScheduleSummary {
  created: number;
  skipped: number;
  /** Candidates whose Spanish-only start date was normalised to the ISO field. */
  isoFilled: number;
  /** Candidate ids with no interpretable start date — nothing can be scheduled for them. */
  unparseable: string[];
}

/**
 * Creates the pending_performance_checks docs (15d/30d) that signContract failed
 * to schedule while the viterbitStartDate parsing bug aborted the post-signature
 * flow, and fills viterbitStartDateIso where only the Spanish display text was
 * ever stored.
 *
 * Idempotent: skips checks that already exist or that were already evaluated
 * (performance15/30DayCheckedAt set on the candidate). processAfter dates in the
 * past are what make the caller able to evaluate them immediately afterwards.
 */
export async function scheduleMissingChecks(): Promise<ScheduleSummary> {
  const snapshot = await db
    .collection('candidates')
    .where('status', 'in', SIGNED_STATUSES)
    .get();

  let created = 0;
  let skipped = 0;
  let isoFilled = 0;
  const unparseable: string[] = [];

  for (const docSnap of snapshot.docs) {
    const candidate = docSnap.data();

    const startDate = parseCandidateStartDate(candidate);
    if (!startDate) {
      unparseable.push(docSnap.id);
      continue;
    }

    // Candidates hired before the ISO field existed (or whose start date only
    // reached Viterbit after the webhook created them) carry the Spanish display
    // text alone. Everything parses it, but the reports filter and sort on the
    // canonical field, so fill it in while we are here.
    if (!candidate.viterbitStartDateIso) {
      await docSnap.ref.update({
        viterbitStartDateIso: startDate.toISOString().slice(0, 10),
        updatedAt: FieldValue.serverTimestamp(),
      });
      isoFilled++;
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

  return { created, skipped, isoFilled, unparseable };
}
