// The question bank has no hardcoded content anywhere in this codebase —
// settings/psychometric_questions in Firestore is the only source, populated
// either via a manual Firestore import or from the "Banco de preguntas" admin
// tab. If that doc doesn't exist yet, the bank is simply empty (the public
// test page shows "no hay preguntas configuradas" rather than crashing).
import { db } from '../utils/admin';
import type { PsychometricQuestion, PsychometricTestConfig } from './scoring';

// Structural defaults only (weights / cutoffs / time limit) — not question content.
const DEFAULT_CONFIG: PsychometricTestConfig = {
  weights: { responsabilidad: 0.2, estabilidad_emocional: 0.2, extraversion: 0.2, amabilidad: 0.2, sjt: 0.2 },
  bandCutoffs: { lowMax: 40, highMin: 70 },
  timeLimitMinutes: 30,
  questionCounts: { likertPerTrait: 0, sjt: 0 },
};

export async function getQuestionBank(): Promise<PsychometricQuestion[]> {
  const snap = await db.collection('settings').doc('psychometric_questions').get();
  return (snap.data()?.questions as PsychometricQuestion[] | undefined) ?? [];
}

export async function getOrSeedConfig(): Promise<PsychometricTestConfig> {
  const ref = db.collection('settings').doc('psychometric_config');
  const snap = await ref.get();
  if (snap.exists) {
    // Merge with defaults so configs saved before a field existed (e.g.
    // questionCounts) don't come back with it missing.
    const data = snap.data() as Partial<PsychometricTestConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...data,
      questionCounts: { ...DEFAULT_CONFIG.questionCounts, ...(data.questionCounts ?? {}) },
    };
  }

  await ref.set(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
