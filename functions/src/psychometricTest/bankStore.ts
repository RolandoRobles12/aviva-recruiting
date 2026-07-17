// Firestore is the single source of truth for the question bank and scoring
// config once seeded — these helpers seed settings/psychometric_questions and
// settings/psychometric_config with the built-in defaults on first read, so
// the hardcoded arrays in defaultQuestions.ts are only ever used once per
// deployment, not as a parallel fallback that could drift from what admins see.
import { db } from '../utils/admin';
import type { PsychometricQuestion, PsychometricTestConfig } from './scoring';
import { DEFAULT_PSYCHOMETRIC_QUESTIONS, DEFAULT_PSYCHOMETRIC_CONFIG } from './defaultQuestions';

export async function getOrSeedQuestionBank(): Promise<PsychometricQuestion[]> {
  const ref = db.collection('settings').doc('psychometric_questions');
  const snap = await ref.get();
  const existing = snap.data()?.questions as PsychometricQuestion[] | undefined;
  if (existing?.length) return existing;

  await ref.set({ questions: DEFAULT_PSYCHOMETRIC_QUESTIONS });
  return DEFAULT_PSYCHOMETRIC_QUESTIONS;
}

export async function getOrSeedConfig(): Promise<PsychometricTestConfig> {
  const ref = db.collection('settings').doc('psychometric_config');
  const snap = await ref.get();
  if (snap.exists) return snap.data() as PsychometricTestConfig;

  await ref.set(DEFAULT_PSYCHOMETRIC_CONFIG);
  return DEFAULT_PSYCHOMETRIC_CONFIG;
}
