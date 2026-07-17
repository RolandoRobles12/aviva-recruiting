import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PsychometricQuestion, PsychometricTestConfig } from '../types';

const QUESTIONS_DOC = doc(db, 'settings', 'psychometric_questions');
const CONFIG_DOC = doc(db, 'settings', 'psychometric_config');

// Structural defaults only (weights / cutoffs / time limit) — no question
// content is hardcoded here. The question bank itself starts empty; it's
// populated either by importing a Firestore document directly or by adding
// questions one by one from the "Banco de preguntas" admin tab.
const DEFAULT_PSYCHOMETRIC_CONFIG: PsychometricTestConfig = {
  weights: {
    responsabilidad: 0.2,
    estabilidad_emocional: 0.2,
    extraversion: 0.2,
    amabilidad: 0.2,
    sjt: 0.2,
  },
  bandCutoffs: { lowMax: 40, highMin: 70 },
  timeLimitMinutes: 30,
  questionCounts: { likertPerTrait: 0, sjt: 0 },
};

export async function getPsychometricQuestions(): Promise<PsychometricQuestion[]> {
  const snap = await getDoc(QUESTIONS_DOC);
  return (snap.data()?.questions as PsychometricQuestion[] | undefined) ?? [];
}

export async function savePsychometricQuestions(questions: PsychometricQuestion[]): Promise<void> {
  await setDoc(QUESTIONS_DOC, { questions });
}

export async function getPsychometricConfig(): Promise<PsychometricTestConfig> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    await setDoc(CONFIG_DOC, DEFAULT_PSYCHOMETRIC_CONFIG);
    return DEFAULT_PSYCHOMETRIC_CONFIG;
  }
  // Merge with defaults so configs saved before a field existed (e.g.
  // questionCounts) don't come back with it missing.
  const data = snap.data() as Partial<PsychometricTestConfig>;
  return {
    ...DEFAULT_PSYCHOMETRIC_CONFIG,
    ...data,
    questionCounts: { ...DEFAULT_PSYCHOMETRIC_CONFIG.questionCounts, ...(data.questionCounts ?? {}) },
  };
}

export async function savePsychometricConfig(config: PsychometricTestConfig): Promise<void> {
  await setDoc(CONFIG_DOC, config);
}
