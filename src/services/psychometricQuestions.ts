import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  PSYCHOMETRIC_LIKERT_SCALES,
  type PsychometricLikertScale,
  type PsychometricQuestion,
  type PsychometricTestConfig,
} from '../types';

const QUESTIONS_DOC = doc(db, 'settings', 'psychometric_questions');
const CONFIG_DOC = doc(db, 'settings', 'psychometric_config');

// Structural defaults only (weights / cutoffs / sampling) — no question content
// is hardcoded here. The bank itself is either seeded from the curated starter
// bank (the "Cargar banco base" button, which runs server-side) or written item
// by item from the admin tab. Keep in step with
// functions/src/psychometricTest/defaultBank.ts, which is what the server applies.
const DEFAULT_PSYCHOMETRIC_CONFIG: PsychometricTestConfig = {
  weights: {
    responsabilidad: 0.25,
    integridad: 0.2,
    estabilidad_emocional: 0.2,
    sjt: 0.15,
    extraversion: 0.1,
    amabilidad: 0.1,
  },
  bandCutoffs: { lowMax: 55, highMin: 75 },
  percentileCutoffs: { lowMaxPercentile: 25, highMinPercentile: 75 },
  timeLimitMinutes: 35,
  questionCounts: {
    likertPerTrait: 8,
    sjt: 8,
    deseabilidadSocial: 4,
    infrecuencia: 3,
    atencion: 2,
  },
  minItemsPerScale: 4,
  useLocalNorms: true,
};

const VALID_LIKERT_SCALES = new Set<string>(PSYCHOMETRIC_LIKERT_SCALES);

/**
 * Brings a stored question up to the current shape. Items written before the
 * bank had scales carry `trait` instead, and all of them predate the attention
 * item type — read-time normalization is what keeps the editor from wiping
 * fields it does not understand.
 */
function normalizeQuestion(raw: unknown, index: number): PsychometricQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const question = raw as Record<string, unknown>;
  const id = typeof question.id === 'string' ? question.id : '';
  if (!id) return null;

  const text = typeof question.text === 'string' ? question.text : '';
  const enabled = question.enabled !== false;
  const order = typeof question.order === 'number' ? question.order : index;

  if (question.type === 'sjt') {
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const competency = typeof question.competency === 'string' ? question.competency : '';
    return {
      id,
      type: 'sjt',
      text,
      options: rawOptions.map((option) => {
        const record = (option ?? {}) as Record<string, unknown>;
        return {
          text: typeof record.text === 'string' ? record.text : '',
          score: typeof record.score === 'number' ? record.score : 0,
        };
      }),
      // Omitted when empty: the editor writes this object straight back to
      // Firestore, which rejects undefined values.
      ...(competency ? { competency } : {}),
      enabled,
      order,
    };
  }

  if (question.type === 'attention') {
    const expected = typeof question.expectedValue === 'number' ? question.expectedValue : 3;
    return { id, type: 'attention', text, expectedValue: expected, enabled, order };
  }

  const scaleCandidate =
    (typeof question.scale === 'string' && question.scale) ||
    (typeof question.trait === 'string' && question.trait) ||
    '';

  return {
    id,
    type: 'likert',
    scale: (VALID_LIKERT_SCALES.has(scaleCandidate)
      ? scaleCandidate
      : 'responsabilidad') as PsychometricLikertScale,
    text,
    reverseScored: question.reverseScored === true,
    enabled,
    order,
  };
}

export async function getPsychometricQuestions(): Promise<PsychometricQuestion[]> {
  const snap = await getDoc(QUESTIONS_DOC);
  const raw = snap.data()?.questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((question, index) => normalizeQuestion(question, index))
    .filter((question): question is PsychometricQuestion => question !== null)
    .sort((a, b) => a.order - b.order);
}

export async function savePsychometricQuestions(questions: PsychometricQuestion[]): Promise<void> {
  await setDoc(QUESTIONS_DOC, {
    // Likert items are rebuilt field by field so the legacy `trait` key is
    // dropped: it only ever existed as the pre-`scale` field, and keeping both
    // around invites the two disagreeing.
    questions: questions.map((question, index) => {
      if (question.type === 'likert') {
        return {
          id: question.id,
          type: question.type,
          scale: question.scale,
          text: question.text,
          reverseScored: question.reverseScored,
          enabled: question.enabled,
          order: index,
        };
      }
      return { ...question, order: index };
    }),
    updatedAt: serverTimestamp(),
  });
}

export async function getPsychometricConfig(): Promise<PsychometricTestConfig> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    await setDoc(CONFIG_DOC, DEFAULT_PSYCHOMETRIC_CONFIG);
    return DEFAULT_PSYCHOMETRIC_CONFIG;
  }
  // Merge with defaults so configs saved before a field existed (percentile
  // cutoffs, the integridad weight, the new sampling counts) don't come back
  // with it missing.
  const data = snap.data() as Partial<PsychometricTestConfig>;
  return {
    ...DEFAULT_PSYCHOMETRIC_CONFIG,
    ...data,
    weights: { ...DEFAULT_PSYCHOMETRIC_CONFIG.weights, ...(data.weights ?? {}) },
    bandCutoffs: { ...DEFAULT_PSYCHOMETRIC_CONFIG.bandCutoffs, ...(data.bandCutoffs ?? {}) },
    percentileCutoffs: {
      ...DEFAULT_PSYCHOMETRIC_CONFIG.percentileCutoffs,
      ...(data.percentileCutoffs ?? {}),
    },
    questionCounts: {
      ...DEFAULT_PSYCHOMETRIC_CONFIG.questionCounts,
      ...(data.questionCounts ?? {}),
    },
  };
}

export async function savePsychometricConfig(config: PsychometricTestConfig): Promise<void> {
  await setDoc(CONFIG_DOC, config);
}

// Validation lives in lib/bankValidation.ts, which has no Firebase import so it
// can be unit tested. Re-exported here because the editor imports both from the
// same place.
export {
  validateBank,
  applyBankFix,
  type BankValidationIssue,
  type BankIssueAnchor,
  type BankIssueFixId,
  type BankConfigField,
} from '../lib/bankValidation';
