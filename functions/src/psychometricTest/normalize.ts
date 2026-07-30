// Coercion of stored documents into the current shapes.
//
// Documents written by earlier versions of the admin UI predate `scale`, the
// attention item type and the norm-related config fields, so every read goes
// through here. Kept free of any Firestore import so it can be tested directly.

import { DEFAULT_TEST_CONFIG } from './defaultBank';
import {
  LIKERT_MAX,
  LIKERT_MIN,
  PSYCHOMETRIC_TRAITS,
  PSYCHOMETRIC_VALIDITY_SCALES,
  type PsychometricLikertScale,
  type PsychometricQuestion,
  type PsychometricTestConfig,
} from './types';

const VALID_LIKERT_SCALES = new Set<string>([...PSYCHOMETRIC_TRAITS, ...PSYCHOMETRIC_VALIDITY_SCALES]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Coerces one stored question into the current shape, or returns null when it is
 * unusable. Legacy Likert items carry `trait` instead of `scale`; an item whose
 * scale cannot be recognised is dropped rather than scored on a guessed scale.
 */
export function normalizeQuestion(raw: unknown, index: number): PsychometricQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const question = raw as Record<string, unknown>;

  const id = asText(question.id);
  const text = asText(question.text);
  if (!id || !text) return null;

  const enabled = question.enabled !== false;
  const order = typeof question.order === 'number' && Number.isFinite(question.order) ? question.order : index;

  if (question.type === 'sjt') {
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions
      .map((option) => {
        const record = (option ?? {}) as Record<string, unknown>;
        const optionText = asText(record.text);
        const score = typeof record.score === 'number' && Number.isFinite(record.score) ? record.score : NaN;
        if (!optionText || Number.isNaN(score)) return null;
        return { text: optionText, score };
      })
      .filter((option): option is { text: string; score: number } => option !== null);

    if (options.length < 2) return null;
    const competency = asText(question.competency);
    return {
      id,
      type: 'sjt',
      text,
      options,
      // Omitted when absent rather than set to undefined: normalized questions
      // are snapshotted into the session document, and Firestore rejects
      // undefined values.
      ...(competency ? { competency } : {}),
      enabled,
      order,
    };
  }

  if (question.type === 'attention') {
    const expected = typeof question.expectedValue === 'number' ? Math.round(question.expectedValue) : NaN;
    if (Number.isNaN(expected) || expected < LIKERT_MIN || expected > LIKERT_MAX) return null;
    return { id, type: 'attention', text, expectedValue: expected, enabled, order };
  }

  // Default to Likert: that is what every pre-`type` document was.
  const scaleCandidate = asText(question.scale) || asText(question.trait);
  if (!VALID_LIKERT_SCALES.has(scaleCandidate)) return null;

  return {
    id,
    type: 'likert',
    scale: scaleCandidate as PsychometricLikertScale,
    text,
    reverseScored: question.reverseScored === true,
    enabled,
    order,
  };
}

/** Normalizes a stored bank array, dropping unusable and duplicated items. */
export function normalizeBank(raw: unknown): PsychometricQuestion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PsychometricQuestion[] = [];
  raw.forEach((item, index) => {
    const question = normalizeQuestion(item, index);
    if (!question || seen.has(question.id)) return;
    seen.add(question.id);
    out.push(question);
  });
  return out.sort((a, b) => a.order - b.order);
}

/** Fills in fields added after a config was last saved, without overwriting it. */
export function mergeConfig(stored: Partial<PsychometricTestConfig> | undefined): PsychometricTestConfig {
  return {
    ...DEFAULT_TEST_CONFIG,
    ...(stored ?? {}),
    weights: { ...DEFAULT_TEST_CONFIG.weights, ...(stored?.weights ?? {}) },
    bandCutoffs: { ...DEFAULT_TEST_CONFIG.bandCutoffs, ...(stored?.bandCutoffs ?? {}) },
    percentileCutoffs: { ...DEFAULT_TEST_CONFIG.percentileCutoffs, ...(stored?.percentileCutoffs ?? {}) },
    questionCounts: { ...DEFAULT_TEST_CONFIG.questionCounts, ...(stored?.questionCounts ?? {}) },
  };
}
