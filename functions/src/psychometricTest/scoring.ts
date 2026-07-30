// Scoring for the psychometric test. Runs server-side only: the client never
// sees keying, option scores or scale membership, so a candidate cannot reverse
// engineer "the right answers" from the payload it receives.
//
// Two rules drive the design:
//  1. Score only what was actually applied in this session. The bank changes
//     over time and the request body comes from the open internet, so answers
//     are matched against the frozen question list of the session and validated
//     item by item. Anything else is dropped, never coerced.
//  2. Missing data is missing, not zero. A trait with too few answers is
//     reported as "sin datos" instead of silently becoming a 0 that reads as
//     "bajo" — the previous behaviour, which penalised candidates whose test was
//     cut short by the timer.

import {
  LIKERT_MAX,
  LIKERT_MIN,
  PSYCHOMETRIC_RESULT_VERSION,
  PSYCHOMETRIC_SCORED_SCALES,
  PSYCHOMETRIC_TRAITS,
  type PsychometricAnswer,
  type PsychometricNormKey,
  type PsychometricNorms,
  type PsychometricQuestion,
  type PsychometricResult,
  type PsychometricScaleResult,
  type PsychometricScoredScale,
  type PsychometricTestConfig,
} from './types';
import { resolveBand } from './norms';
import { assessValidity } from './validity';

/** Hard cap on the request body, independent of the session's question count. */
export const MAX_ANSWERS_PER_SUBMISSION = 500;

export interface SanitizedAnswers {
  answers: PsychometricAnswer[];
  /** Answers dropped for referring to an unknown item or carrying a bad value. */
  rejected: number;
}

function displayedOptionCount(
  question: PsychometricQuestion,
  optionOrders: Record<string, number[]>
): number {
  if (question.type !== 'sjt') return 0;
  const order = optionOrders[question.id];
  return order?.length ?? question.options.length;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Keeps only answers that belong to this session and carry a value the item can
 * actually take. Later duplicates win, matching "the last thing the candidate
 * clicked" for a resumed session.
 */
export function sanitizeAnswers(
  questions: PsychometricQuestion[],
  answers: PsychometricAnswer[],
  optionOrders: Record<string, number[]> = {}
): SanitizedAnswers {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const kept = new Map<string, PsychometricAnswer>();
  let rejected = 0;

  for (const answer of answers.slice(0, MAX_ANSWERS_PER_SUBMISSION)) {
    const question = answer && typeof answer.questionId === 'string' ? byId.get(answer.questionId) : undefined;
    if (!question || !isInteger(answer.value)) {
      rejected += 1;
      continue;
    }

    if (question.type === 'sjt') {
      const count = displayedOptionCount(question, optionOrders);
      if (answer.value < 0 || answer.value >= count) {
        rejected += 1;
        continue;
      }
    } else if (answer.value < LIKERT_MIN || answer.value > LIKERT_MAX) {
      rejected += 1;
      continue;
    }

    // Keys are omitted rather than set to undefined: these answers are written
    // straight back to Firestore, which rejects undefined values.
    const responseMs =
      typeof answer.responseMs === 'number' && Number.isFinite(answer.responseMs) && answer.responseMs >= 0
        ? Math.round(answer.responseMs)
        : undefined;

    kept.set(question.id, {
      questionId: question.id,
      value: answer.value,
      ...(responseMs === undefined ? {} : { responseMs }),
    });
  }

  return { answers: [...kept.values()], rejected };
}

function scoredLikert(value: number, reverseScored: boolean): number {
  return reverseScored ? 6 - value : value;
}

/**
 * A scale is reportable when the candidate answered enough of it. "Enough" is
 * `minItemsPerScale`, but never more than what was applied: if the admin only
 * put 2 SJT scenarios in the session, answering both is all the candidate can
 * do — that is a weakness of the instrument (surfaced in the analysis tab), not
 * missing data for this person.
 */
function hasEnoughData(itemsAnswered: number, itemsApplied: number, minItems: number): boolean {
  if (itemsAnswered === 0) return false;
  return itemsAnswered >= Math.min(minItems, itemsApplied);
}

interface ScaleAccumulator {
  applied: number;
  answered: number;
  sum: number;
  /** Maximum attainable sum over the answered items (SJT option scores vary). */
  maxSum: number;
}

function emptyAccumulator(): ScaleAccumulator {
  return { applied: 0, answered: 0, sum: 0, maxSum: 0 };
}

export interface ScoreSessionInput {
  /** The questions applied in this session, in presentation order. */
  questions: PsychometricQuestion[];
  answers: PsychometricAnswer[];
  optionOrders?: Record<string, number[]>;
  config: PsychometricTestConfig;
  /** Local norm sample as it stands *before* this session is folded in. */
  norms?: PsychometricNorms;
}

export interface ScoreSessionOutput {
  result: PsychometricResult;
  /** The answers that were actually scored, after validation — persist these. */
  answers: PsychometricAnswer[];
  /** How many entries of the payload were discarded. */
  rejected: number;
}

export function scoreSession(input: ScoreSessionInput): ScoreSessionOutput {
  const { questions, config } = input;
  const optionOrders = input.optionOrders ?? {};
  const { answers, rejected } = sanitizeAnswers(questions, input.answers, optionOrders);
  const answerById = new Map(answers.map((a) => [a.questionId, a]));

  const accumulators = new Map<PsychometricScoredScale, ScaleAccumulator>(
    PSYCHOMETRIC_SCORED_SCALES.map((scale) => [scale, emptyAccumulator()])
  );

  for (const question of questions) {
    // Attention checks and the response-style scales (deseabilidad social,
    // infrecuencia) are deliberately absent here: they judge the answers, they
    // are not part of the candidate's profile.
    if (question.type === 'sjt') {
      const acc = accumulators.get('sjt')!;
      acc.applied += 1;
      const answer = answerById.get(question.id);
      if (!answer) continue;
      const order = optionOrders[question.id] ?? question.options.map((_, i) => i);
      const option = question.options[order[answer.value]];
      if (!option) continue;
      acc.answered += 1;
      acc.sum += option.score;
      acc.maxSum += Math.max(...question.options.map((o) => o.score));
      continue;
    }

    if (question.type !== 'likert') continue;
    if (!(PSYCHOMETRIC_TRAITS as string[]).includes(question.scale)) continue;

    const acc = accumulators.get(question.scale as PsychometricScoredScale)!;
    acc.applied += 1;
    const answer = answerById.get(question.id);
    if (!answer) continue;
    acc.answered += 1;
    acc.sum += scoredLikert(answer.value, question.reverseScored);
  }

  const bandOptions = {
    bandCutoffs: config.bandCutoffs,
    percentileCutoffs: config.percentileCutoffs,
    useLocalNorms: config.useLocalNorms,
  };

  const scales = {} as Record<PsychometricScoredScale, PsychometricScaleResult>;
  for (const scale of PSYCHOMETRIC_SCORED_SCALES) {
    const acc = accumulators.get(scale)!;
    const hasData = hasEnoughData(acc.answered, acc.applied, config.minItemsPerScale);
    const rawAverage = acc.answered > 0 ? acc.sum / acc.answered : 0;

    // Likert scales start at 1, not 0, so "percent of maximum" has to subtract
    // the floor or a straight row of 1s would read as 20 instead of 0.
    const normalizedScore = !hasData
      ? 0
      : scale === 'sjt'
        ? acc.maxSum > 0
          ? Math.round((acc.sum / acc.maxSum) * 100)
          : 0
        : Math.round(((rawAverage - LIKERT_MIN) / (LIKERT_MAX - LIKERT_MIN)) * 100);

    const resolved = hasData
      ? resolveBand(normalizedScore, input.norms?.scales[scale], bandOptions)
      : { band: 'medio' as const, bandSource: 'absoluta' as const, normSampleSize: 0 };

    scales[scale] = {
      scale,
      hasData,
      itemsApplied: acc.applied,
      itemsAnswered: acc.answered,
      rawAverage: Math.round(rawAverage * 100) / 100,
      normalizedScore,
      // Absent, not undefined: the whole result object is persisted as-is.
      ...(resolved.percentile === undefined ? {} : { percentile: resolved.percentile }),
      ...(resolved.zScore === undefined ? {} : { zScore: resolved.zScore }),
      band: resolved.band,
      bandSource: resolved.bandSource,
    };
  }

  // Composite over the scales that actually have data, with the configured
  // weights renormalized across them — so a missing scale shifts weight to the
  // rest instead of dragging the composite toward zero.
  let weighted = 0;
  let weightSum = 0;
  for (const scale of PSYCHOMETRIC_SCORED_SCALES) {
    const weight = config.weights[scale] ?? 0;
    if (!scales[scale].hasData || weight <= 0) continue;
    weighted += scales[scale].normalizedScore * weight;
    weightSum += weight;
  }

  const compositeHasData = weightSum > 0;
  const compositeScore = compositeHasData ? Math.round(weighted / weightSum) : 0;
  const compositeResolved = compositeHasData
    ? resolveBand(compositeScore, input.norms?.scales.composite, bandOptions)
    : { band: 'medio' as const, bandSource: 'absoluta' as const, normSampleSize: 0 };

  const validity = assessValidity(questions, answers);

  return {
    result: {
      version: PSYCHOMETRIC_RESULT_VERSION,
      scales,
      compositeScore,
      ...(compositeResolved.percentile === undefined
        ? {}
        : { compositePercentile: compositeResolved.percentile }),
      ...(compositeResolved.zScore === undefined ? {} : { compositeZScore: compositeResolved.zScore }),
      compositeBand: compositeResolved.band,
      compositeBandSource: compositeResolved.bandSource,
      compositeHasData,
      validity,
      validityFlags: validity.flags,
      normSampleSize: compositeResolved.normSampleSize,
      scoredAtIso: new Date().toISOString(),
    },
    answers,
    rejected,
  };
}

/**
 * The observations this result contributes to the local norm sample. Callers
 * skip this for sessions flagged `no_confiable`: careless data widens the norm
 * distribution and would make every honest candidate look average.
 */
export function normObservationsFrom(
  result: PsychometricResult
): { key: PsychometricNormKey; value: number }[] {
  const observations: { key: PsychometricNormKey; value: number }[] = [];
  for (const scale of PSYCHOMETRIC_SCORED_SCALES) {
    if (result.scales[scale]?.hasData) {
      observations.push({ key: scale, value: result.scales[scale].normalizedScore });
    }
  }
  if (result.compositeHasData) {
    observations.push({ key: 'composite', value: result.compositeScore });
  }
  return observations;
}
