// Rebuilding "what did the candidate actually answer" from a stored session.
//
// Sessions started by the current scorer carry a snapshot of the exact items
// they applied, so the detail can be shown without touching the bank. Older
// sessions only stored the ids, and those are resolved against the bank as it
// stands today — which may no longer contain every item, hence the tolerance for
// missing ones.

import {
  PSYCHOMETRIC_TRAITS,
  type PsychometricAnswer,
  type PsychometricQuestion,
  type PsychometricScoredScale,
  type PsychometricSession,
} from '../types';

export const LIKERT_ANSWER_LABELS = [
  'Totalmente en desacuerdo',
  'En desacuerdo',
  'Neutral',
  'De acuerdo',
  'Totalmente de acuerdo',
];

/** How an answer reads at a glance for the recruiter scanning the list. */
export type AnswerTone = 'favorable' | 'neutral' | 'desfavorable' | 'sin_responder';

export interface AnsweredQuestion {
  question: PsychometricQuestion;
  /** Raw stored value; undefined when the item was never answered. */
  value?: number;
  /** What the candidate picked, in words. */
  answerLabel: string;
  /** Likert: 1-5 after reversing. SJT: the chosen option's score. */
  scored?: number;
  /** Best attainable on this item. */
  max: number;
  tone: AnswerTone;
}

/** The items a session applied, in presentation order. */
export function resolveAppliedQuestions(
  session: PsychometricSession,
  bank: PsychometricQuestion[]
): PsychometricQuestion[] {
  const snapshot = session.appliedQuestions;
  if (Array.isArray(snapshot) && snapshot.length > 0) {
    const order = session.questionOrder ?? [];
    if (order.length === 0) return snapshot;
    const byId = new Map(snapshot.map((question) => [question.id, question]));
    return order.map((id) => byId.get(id)).filter((q): q is PsychometricQuestion => !!q);
  }

  const order = session.questionOrder ?? [];
  const byId = new Map(bank.map((question) => [question.id, question]));
  return order.map((id) => byId.get(id)).filter((q): q is PsychometricQuestion => !!q);
}

function describe(
  question: PsychometricQuestion,
  answer: PsychometricAnswer | undefined,
  optionOrders: Record<string, number[]>
): AnsweredQuestion {
  if (question.type === 'sjt') {
    const max = Math.max(...question.options.map((option) => option.score), 0);
    if (!answer) {
      return { question, answerLabel: 'Sin responder', max, tone: 'sin_responder' };
    }
    // The stored value is the index *as displayed*, so it has to go back through
    // the shuffle this session used before it means anything.
    const order = optionOrders[question.id] ?? question.options.map((_, index) => index);
    const option = question.options[order[answer.value]];
    if (!option) {
      return { question, value: answer.value, answerLabel: 'Respuesta no reconocida', max, tone: 'sin_responder' };
    }
    return {
      question,
      value: answer.value,
      answerLabel: option.text,
      scored: option.score,
      max,
      tone: option.score >= max ? 'favorable' : option.score === 0 ? 'desfavorable' : 'neutral',
    };
  }

  if (question.type === 'attention') {
    if (!answer) return { question, answerLabel: 'Sin responder', max: 1, tone: 'sin_responder' };
    const passed = answer.value === question.expectedValue;
    return {
      question,
      value: answer.value,
      answerLabel: `${LIKERT_ANSWER_LABELS[answer.value - 1] ?? answer.value} · se pedía "${
        LIKERT_ANSWER_LABELS[question.expectedValue - 1] ?? question.expectedValue
      }"`,
      scored: passed ? 1 : 0,
      max: 1,
      tone: passed ? 'favorable' : 'desfavorable',
    };
  }

  if (!answer) return { question, answerLabel: 'Sin responder', max: 5, tone: 'sin_responder' };

  const scored = question.reverseScored ? 6 - answer.value : answer.value;
  // On the response-style scales a high score is the *bad* outcome: agreeing
  // with "nunca me he molestado con nadie" is what raises the caution flag.
  const isStyleScale =
    question.scale === 'deseabilidad_social' || question.scale === 'infrecuencia';
  const high = isStyleScale ? 'desfavorable' : 'favorable';
  const low = isStyleScale ? 'favorable' : 'desfavorable';

  return {
    question,
    value: answer.value,
    answerLabel: LIKERT_ANSWER_LABELS[answer.value - 1] ?? String(answer.value),
    scored,
    max: 5,
    tone: scored >= 4 ? high : scored <= 2 ? low : 'neutral',
  };
}

function answerMap(session: PsychometricSession): Map<string, PsychometricAnswer> {
  return new Map((session.answers ?? []).map((answer) => [answer.questionId, answer]));
}

/** Every applied item of one scored scale, with what the candidate answered. */
export function answersForScale(
  session: PsychometricSession,
  bank: PsychometricQuestion[],
  scale: PsychometricScoredScale
): AnsweredQuestion[] {
  const answers = answerMap(session);
  const optionOrders = session.optionOrders ?? {};

  return resolveAppliedQuestions(session, bank)
    .filter((question) =>
      scale === 'sjt' ? question.type === 'sjt' : question.type === 'likert' && question.scale === scale
    )
    .map((question) => describe(question, answers.get(question.id), optionOrders));
}

/**
 * The attention checks and response-style items. They never enter the profile,
 * but they are exactly what a recruiter wants to read when a result comes back
 * flagged as "revisar".
 */
export function controlAnswers(
  session: PsychometricSession,
  bank: PsychometricQuestion[]
): AnsweredQuestion[] {
  const answers = answerMap(session);
  const optionOrders = session.optionOrders ?? {};
  const traits = new Set<string>(PSYCHOMETRIC_TRAITS);

  return resolveAppliedQuestions(session, bank)
    .filter(
      (question) =>
        question.type === 'attention' ||
        (question.type === 'likert' && !traits.has(question.scale))
    )
    .map((question) => describe(question, answers.get(question.id), optionOrders));
}
