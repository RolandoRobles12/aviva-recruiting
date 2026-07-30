// Careless / dishonest responding detection.
//
// A psychometric score is only as good as the effort behind it, and in a hiring
// context a meaningful share of candidates click through without reading. We
// therefore compute several independent indices and combine them into one
// explicit verdict instead of relying on a single heuristic:
//
//   - instructed-response checks ("marca 'En desacuerdo' en esta afirmación"):
//     the strongest single signal, so a failure weighs heavily
//   - response time per item, compared against the item's own reading time
//   - keying inconsistency: the gap, per trait, between the positively worded
//     items and the reverse-worded ones. An honest profile agrees with itself;
//     someone answering mechanically will not
//   - even-odd split-half consistency across scales (Spearman-Brown corrected)
//   - longstring and intra-individual response variability (straight-lining)
//   - an infrequency scale (statements almost nobody can honestly endorse)
//   - a social-desirability scale, used ONLY as a caution flag. Scores are never
//     "corrected" for it: the literature is clear that such corrections do not
//     recover the true score and can make validity worse
//
// Each firing flag adds severity points; the total maps to one of three
// verdicts. Points make the rule auditable and let two mild signals add up to
// something a recruiter should look at, without a single noisy index (like a
// 5-point correlation) being able to invalidate a session on its own.

import {
  PSYCHOMETRIC_TRAITS,
  type PsychometricAnswer,
  type PsychometricQuestion,
  type PsychometricValidity,
  type PsychometricValidityFlag,
  type PsychometricValidityIndices,
  type PsychometricValidityVerdict,
} from './types';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Below this, the session is too incomplete to score at all. */
const COMPLETION_CRITICAL = 0.6;
/** Below this, some scales are thin — worth flagging. */
const COMPLETION_WARNING = 0.9;

/** Straight-lining: SD of the candidate's own Likert answers. */
const IRV_LOW_THRESHOLD = 0.45;
const MIN_LIKERT_FOR_IRV = 6;

/**
 * Longest identical run. Two ways to fire: a run that covers a large share of a
 * short test, or a run long enough in absolute terms that its share stops
 * mattering (20 identical answers in a 60-item test is still straight-lining).
 */
const LONGSTRING_MIN_RUN = 6;
const LONGSTRING_RATIO = 0.35;
const LONGSTRING_ABSOLUTE_RUN = 12;

/** Reading-time model: an item cannot be answered faster than it can be read. */
const READING_BASE_MS = 400;
const READING_MS_PER_WORD = 120;
/** Share of too-fast items that turns into a flag. */
const FAST_RATIO_THRESHOLD = 0.35;
/** Coarse backstop: a median this low means the whole test was clicked through. */
const FAST_MEDIAN_MS = 1500;

/** Mean gap (on the 1-5 scale) between positive and reverse items of a trait. */
const KEYING_INCONSISTENCY_THRESHOLD = 1.25;
const MIN_ITEMS_PER_KEYING_SIDE = 2;

/** Even-odd consistency below this means the two halves disagree outright. */
const EVEN_ODD_THRESHOLD = 0;
const MIN_SCALES_FOR_EVEN_ODD = 3;
const MIN_ITEMS_FOR_EVEN_ODD = 4;

/** 0-100 scores on the two response-style scales. */
const INFREQUENCY_THRESHOLD = 70;
const SOCIAL_DESIRABILITY_THRESHOLD = 80;

/**
 * Severity points per flag. 3 = on its own enough to warrant review; 2 = only
 * matters when something else also fired. A few conditions escalate beyond their
 * base value — see severityOf.
 */
const FLAG_SEVERITY: Record<PsychometricValidityFlag, number> = {
  respuestas_incompletas: 2,
  control_atencion_fallido: 3,
  patron_repetitivo: 3,
  baja_variacion: 3,
  respuestas_muy_rapidas: 3,
  respuestas_inconsistentes: 3,
  inconsistencia_par_impar: 2,
  escala_infrecuencia_alta: 3,
  posible_deseabilidad_social: 2,
};

/** Total points at which the result stops being usable / needs a second look. */
const VERDICT_UNRELIABLE_AT = 6;
const VERDICT_REVIEW_AT = 2;

// ─── Small statistics helpers ─────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Longest run of identical consecutive values. */
function longestRun(values: number[]): number {
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const v of values) {
    run = v === prev ? run + 1 : 1;
    prev = v;
    if (run > best) best = run;
  }
  return best;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Minimum plausible time to read the item (and, for SJT, all of its options). */
export function minimumReadingMs(question: PsychometricQuestion): number {
  let words = wordCount(question.text);
  if (question.type === 'sjt') {
    words += question.options.reduce((acc, o) => acc + wordCount(o.text), 0);
  }
  return READING_BASE_MS + words * READING_MS_PER_WORD;
}

/** Reverse-corrected value, so that "higher = more of the scale" everywhere. */
function scoredLikert(value: number, reverseScored: boolean): number {
  return reverseScored ? 6 - value : value;
}

function normalizeLikertMean(m: number): number {
  return Math.round(((m - 1) / 4) * 100);
}

// ─── Index computation ────────────────────────────────────────────────────────

/**
 * @param questions Questions actually applied in this session, in the order the
 *                  candidate saw them (presentation order matters for longstring).
 */
export function computeValidityIndices(
  questions: PsychometricQuestion[],
  answers: PsychometricAnswer[]
): PsychometricValidityIndices {
  const answerById = new Map(answers.map((a) => [a.questionId, a]));

  // Sequence of Likert-style answers as presented. Attention checks are included
  // here on purpose: a candidate clicking one option down the page does not stop
  // at them, and leaving them out would artificially break the run.
  const likertSequence: number[] = [];
  // IRV excludes them, since their value is dictated by the instruction and so
  // says nothing about the candidate's response style.
  const likertValues: number[] = [];

  const responseTimes: number[] = [];
  let timedItems = 0;
  let fastItems = 0;

  let answeredCount = 0;
  let attentionTotal = 0;
  let attentionFailed = 0;

  const infrequencyValues: number[] = [];
  const socialDesirabilityValues: number[] = [];

  for (const q of questions) {
    const answer = answerById.get(q.id);
    if (!answer) continue;
    answeredCount += 1;

    if (typeof answer.responseMs === 'number' && answer.responseMs > 0) {
      responseTimes.push(answer.responseMs);
      timedItems += 1;
      if (answer.responseMs < minimumReadingMs(q)) fastItems += 1;
    }

    if (q.type === 'attention') {
      likertSequence.push(answer.value);
      attentionTotal += 1;
      if (answer.value !== q.expectedValue) attentionFailed += 1;
      continue;
    }

    if (q.type === 'likert') {
      likertSequence.push(answer.value);
      likertValues.push(answer.value);
      const scored = scoredLikert(answer.value, q.reverseScored);
      if (q.scale === 'infrecuencia') infrequencyValues.push(scored);
      if (q.scale === 'deseabilidad_social') socialDesirabilityValues.push(scored);
    }
  }

  return {
    completionRate: questions.length === 0 ? 0 : answeredCount / questions.length,
    attentionChecksTotal: attentionTotal,
    attentionChecksFailed: attentionFailed,
    longString: longestRun(likertSequence),
    longStringRatio: likertSequence.length === 0 ? 0 : longestRun(likertSequence) / likertSequence.length,
    irv: likertValues.length >= MIN_LIKERT_FOR_IRV ? stdDev(likertValues) : null,
    evenOddConsistency: computeEvenOddConsistency(questions, answerById),
    keyingInconsistency: computeKeyingInconsistency(questions, answerById),
    medianResponseMs: median(responseTimes),
    fastResponseRatio: timedItems === 0 ? 0 : fastItems / timedItems,
    infrequencyScore:
      infrequencyValues.length > 0 ? normalizeLikertMean(mean(infrequencyValues)) : null,
    socialDesirabilityScore:
      socialDesirabilityValues.length > 0
        ? normalizeLikertMean(mean(socialDesirabilityValues))
        : null,
  };
}

/**
 * Splits each trait scale into alternating halves (by bank order, so the split
 * is stable across sessions), then correlates the two half-score vectors across
 * scales. A negative value means the candidate's two halves describe different
 * people. Spearman-Brown corrected, as the halves are half-length.
 */
function computeEvenOddConsistency(
  questions: PsychometricQuestion[],
  answerById: Map<string, PsychometricAnswer>
): number | null {
  const evenMeans: number[] = [];
  const oddMeans: number[] = [];

  for (const trait of PSYCHOMETRIC_TRAITS) {
    const items = questions
      .filter((q) => q.type === 'likert' && q.scale === trait)
      .sort((a, b) => a.order - b.order);

    const evens: number[] = [];
    const odds: number[] = [];
    items.forEach((q, idx) => {
      const answer = answerById.get(q.id);
      if (!answer || q.type !== 'likert') return;
      const scored = scoredLikert(answer.value, q.reverseScored);
      (idx % 2 === 0 ? evens : odds).push(scored);
    });

    if (evens.length + odds.length < MIN_ITEMS_FOR_EVEN_ODD) continue;
    if (evens.length === 0 || odds.length === 0) continue;
    evenMeans.push(mean(evens));
    oddMeans.push(mean(odds));
  }

  if (evenMeans.length < MIN_SCALES_FOR_EVEN_ODD) return null;
  const r = pearson(evenMeans, oddMeans);
  if (r === null) return null;
  const corrected = (2 * r) / (1 + r);
  if (!Number.isFinite(corrected)) return null;
  return Math.round(Math.max(-1, Math.min(1, corrected)) * 100) / 100;
}

/**
 * Mean absolute gap, across traits, between the reverse-corrected mean of the
 * positively worded items and that of the reverse-worded ones. Both are on the
 * same 1-5 "more of the trait" scale, so an honest respondent keeps them close;
 * someone agreeing with everything pushes them apart by construction.
 */
function computeKeyingInconsistency(
  questions: PsychometricQuestion[],
  answerById: Map<string, PsychometricAnswer>
): number | null {
  const gaps: number[] = [];

  for (const trait of PSYCHOMETRIC_TRAITS) {
    const positive: number[] = [];
    const reversed: number[] = [];

    for (const q of questions) {
      if (q.type !== 'likert' || q.scale !== trait) continue;
      const answer = answerById.get(q.id);
      if (!answer) continue;
      const scored = scoredLikert(answer.value, q.reverseScored);
      (q.reverseScored ? reversed : positive).push(scored);
    }

    if (positive.length < MIN_ITEMS_PER_KEYING_SIDE || reversed.length < MIN_ITEMS_PER_KEYING_SIDE) {
      continue;
    }
    gaps.push(Math.abs(mean(positive) - mean(reversed)));
  }

  if (gaps.length === 0) return null;
  return Math.round(mean(gaps) * 100) / 100;
}

// ─── Flags and verdict ────────────────────────────────────────────────────────

export function flagsFromIndices(indices: PsychometricValidityIndices): PsychometricValidityFlag[] {
  const flags: PsychometricValidityFlag[] = [];

  if (indices.completionRate < COMPLETION_WARNING) flags.push('respuestas_incompletas');
  if (indices.attentionChecksFailed > 0) flags.push('control_atencion_fallido');

  if (
    indices.longString >= LONGSTRING_ABSOLUTE_RUN ||
    (indices.longString >= LONGSTRING_MIN_RUN && indices.longStringRatio >= LONGSTRING_RATIO)
  ) {
    flags.push('patron_repetitivo');
  }

  if (indices.irv !== null && indices.irv < IRV_LOW_THRESHOLD) flags.push('baja_variacion');

  if (
    indices.fastResponseRatio > FAST_RATIO_THRESHOLD ||
    (indices.medianResponseMs !== null && indices.medianResponseMs < FAST_MEDIAN_MS)
  ) {
    flags.push('respuestas_muy_rapidas');
  }

  if (
    indices.keyingInconsistency !== null &&
    indices.keyingInconsistency > KEYING_INCONSISTENCY_THRESHOLD
  ) {
    flags.push('respuestas_inconsistentes');
  }

  if (indices.evenOddConsistency !== null && indices.evenOddConsistency < EVEN_ODD_THRESHOLD) {
    flags.push('inconsistencia_par_impar');
  }

  if (indices.infrequencyScore !== null && indices.infrequencyScore >= INFREQUENCY_THRESHOLD) {
    flags.push('escala_infrecuencia_alta');
  }

  if (
    indices.socialDesirabilityScore !== null &&
    indices.socialDesirabilityScore >= SOCIAL_DESIRABILITY_THRESHOLD
  ) {
    flags.push('posible_deseabilidad_social');
  }

  return flags;
}

export function severityOf(
  flags: PsychometricValidityFlag[],
  indices: PsychometricValidityIndices
): number {
  let total = 0;
  for (const flag of flags) {
    if (flag === 'control_atencion_fallido') {
      // Each failed check counts: one is a slip, two is not reading the test.
      total += FLAG_SEVERITY[flag] * indices.attentionChecksFailed;
    } else if (flag === 'respuestas_incompletas') {
      // Under 60% answered there is not enough of a test left to interpret, so
      // this alone reaches the "no confiable" threshold.
      total +=
        indices.completionRate < COMPLETION_CRITICAL ? VERDICT_UNRELIABLE_AT : FLAG_SEVERITY[flag];
    } else {
      total += FLAG_SEVERITY[flag];
    }
  }
  return total;
}

export function verdictFor(severity: number): PsychometricValidityVerdict {
  if (severity >= VERDICT_UNRELIABLE_AT) return 'no_confiable';
  if (severity >= VERDICT_REVIEW_AT) return 'revisar';
  return 'confiable';
}

export function assessValidity(
  questions: PsychometricQuestion[],
  answers: PsychometricAnswer[]
): PsychometricValidity {
  const indices = computeValidityIndices(questions, answers);
  const flags = flagsFromIndices(indices);
  const severity = severityOf(flags, indices);
  return { verdict: verdictFor(severity), severity, flags, indices };
}
