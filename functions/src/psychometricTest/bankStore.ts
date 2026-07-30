// Firestore access for the psychometric module.
//
// settings/psychometric_questions is the only source of question content — there
// is no hardcoded fallback bank in the request path. defaultBank.ts holds curated
// seed content that an admin writes explicitly (see adminTools.ts); until that
// happens, the bank is simply empty and the public test page says so.
//
// Reads go through normalize.ts, because documents written by earlier versions of
// the admin UI predate several of the fields the scorer now relies on.

import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { DEFAULT_TEST_CONFIG } from './defaultBank';
import { mergeConfig, normalizeBank } from './normalize';
import { emptyNorms, withObservation } from './norms';
import type {
  PsychometricNormKey,
  PsychometricNorms,
  PsychometricQuestion,
  PsychometricTestConfig,
} from './types';

const QUESTIONS_DOC = 'psychometric_questions';
const CONFIG_DOC = 'psychometric_config';
export const NORMS_DOC = 'psychometric_norms';

export async function getQuestionBank(): Promise<PsychometricQuestion[]> {
  const snap = await db.collection('settings').doc(QUESTIONS_DOC).get();
  return normalizeBank(snap.data()?.questions);
}

export async function getOrSeedConfig(): Promise<PsychometricTestConfig> {
  const ref = db.collection('settings').doc(CONFIG_DOC);
  const snap = await ref.get();
  if (snap.exists) return mergeConfig(snap.data() as Partial<PsychometricTestConfig>);
  await ref.set(DEFAULT_TEST_CONFIG);
  return DEFAULT_TEST_CONFIG;
}

export async function getNorms(): Promise<PsychometricNorms> {
  const snap = await db.collection('settings').doc(NORMS_DOC).get();
  if (!snap.exists) return emptyNorms();
  const data = snap.data() as { scales?: PsychometricNorms['scales']; updatedAtIso?: string };
  return { scales: data.scales ?? {}, updatedAtIso: data.updatedAtIso };
}

/**
 * Folds observations into the local norm sample outside of a submission (used by
 * maintenance paths). The submit endpoint does this inside its own transaction so
 * scoring and the norm update commit together.
 */
export async function applyNormObservations(
  observations: { key: PsychometricNormKey; value: number }[]
): Promise<void> {
  if (observations.length === 0) return;
  const ref = db.collection('settings').doc(NORMS_DOC);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let norms: PsychometricNorms = snap.exists
      ? { scales: (snap.data() as PsychometricNorms).scales ?? {} }
      : emptyNorms();

    for (const { key, value } of observations) {
      norms = withObservation(norms, key, value);
    }

    tx.set(
      ref,
      { scales: norms.scales, updatedAtIso: new Date().toISOString(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
}
