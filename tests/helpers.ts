// Builders for psychometric test fixtures.

import { mergeConfig } from '../functions/src/psychometricTest/normalize';
import type {
  PsychometricAnswer,
  PsychometricAttentionQuestion,
  PsychometricLikertQuestion,
  PsychometricLikertScale,
  PsychometricQuestion,
  PsychometricSjtQuestion,
  PsychometricTestConfig,
} from '../functions/src/psychometricTest/types';

export function config(overrides: Partial<PsychometricTestConfig> = {}): PsychometricTestConfig {
  return mergeConfig(overrides);
}

export function likert(
  id: string,
  scale: PsychometricLikertScale,
  reverseScored = false,
  order = 0
): PsychometricLikertQuestion {
  return {
    id,
    type: 'likert',
    scale,
    text: `Afirmación de prueba ${id} con suficientes palabras para leerse`,
    reverseScored,
    enabled: true,
    order,
  };
}

/** `count` items for one scale, alternating positive and reverse keying. */
export function likertScale(
  scale: PsychometricLikertScale,
  count: number,
  startOrder = 0
): PsychometricLikertQuestion[] {
  return Array.from({ length: count }, (_, index) =>
    likert(`${scale}_${index}`, scale, index % 2 === 1, startOrder + index)
  );
}

export function attention(id: string, expectedValue: number, order = 0): PsychometricAttentionQuestion {
  return {
    id,
    type: 'attention',
    text: `Control de lectura ${id}: selecciona la opción indicada en esta afirmación`,
    expectedValue,
    enabled: true,
    order,
  };
}

export function sjt(id: string, scores: number[], order = 0): PsychometricSjtQuestion {
  return {
    id,
    type: 'sjt',
    text: `Escenario ${id} con una descripción lo bastante larga para tomar tiempo de lectura`,
    options: scores.map((score, index) => ({ text: `Opción ${index} del escenario ${id}`, score })),
    enabled: true,
    order,
  };
}

/** Identity option order, i.e. displayed index == bank index. */
export function identityOrders(questions: PsychometricQuestion[]): Record<string, number[]> {
  const orders: Record<string, number[]> = {};
  for (const question of questions) {
    if (question.type === 'sjt') orders[question.id] = question.options.map((_, index) => index);
  }
  return orders;
}

export interface AnswerAllOptions {
  /** Likert value to give, or a function of the question. */
  likertValue?: number | ((question: PsychometricLikertQuestion) => number);
  /** Displayed option index for SJT items. */
  sjtIndex?: number | ((question: PsychometricSjtQuestion) => number);
  /** Whether attention checks are answered as instructed. */
  passAttention?: boolean;
  responseMs?: number;
}

/** Answers every applied question, with generous response times by default. */
export function answerAll(
  questions: PsychometricQuestion[],
  options: AnswerAllOptions = {}
): PsychometricAnswer[] {
  const {
    likertValue = 4,
    sjtIndex = 0,
    passAttention = true,
    responseMs = 6000,
  } = options;

  return questions.map((question) => {
    if (question.type === 'attention') {
      return {
        questionId: question.id,
        value: passAttention ? question.expectedValue : ((question.expectedValue % 5) + 1),
        responseMs,
      };
    }
    if (question.type === 'sjt') {
      return {
        questionId: question.id,
        value: typeof sjtIndex === 'function' ? sjtIndex(question) : sjtIndex,
        responseMs,
      };
    }
    return {
      questionId: question.id,
      value: typeof likertValue === 'function' ? likertValue(question) : likertValue,
      responseMs,
    };
  });
}

/**
 * A bank covering every scale with enough items to be scoreable, plus response
 * style scales, attention checks and scenarios.
 */
export function fullBank(): PsychometricQuestion[] {
  const questions: PsychometricQuestion[] = [
    ...likertScale('responsabilidad', 8),
    ...likertScale('estabilidad_emocional', 8),
    ...likertScale('extraversion', 8),
    ...likertScale('amabilidad', 8),
    ...likertScale('integridad', 8),
    ...likertScale('deseabilidad_social', 4),
    ...likertScale('infrecuencia', 4),
    attention('aten_a', 2),
    attention('aten_b', 5),
    sjt('sjt_a', [3, 2, 1, 0]),
    sjt('sjt_b', [3, 2, 1, 0]),
    sjt('sjt_c', [3, 2, 1, 0]),
    sjt('sjt_d', [3, 2, 1, 0]),
  ];
  return questions.map((question, index) => ({ ...question, order: index }));
}

/** The response-style scales must not be reverse keyed for a "high = flagged" read. */
export function styleItemsForward(questions: PsychometricQuestion[]): PsychometricQuestion[] {
  return questions.map((question) =>
    question.type === 'likert' &&
    (question.scale === 'deseabilidad_social' || question.scale === 'infrecuencia')
      ? { ...question, reverseScored: false }
      : question
  );
}

/**
 * Paths whose value is literally `undefined`. Firestore rejects those, so any
 * object destined for a document has to be free of them — a mistake that only
 * shows up at write time in production.
 */
export function undefinedPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => undefinedPaths(item, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    child === undefined ? [`${path}.${key}`] : undefinedPaths(child, `${path}.${key}`)
  );
}
