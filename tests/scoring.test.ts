import { describe, expect, it } from 'vitest';
import {
  MAX_ANSWERS_PER_SUBMISSION,
  normObservationsFrom,
  sanitizeAnswers,
  scoreSession,
} from '../functions/src/psychometricTest/scoring';
import { PSYCHOMETRIC_TRAITS } from '../functions/src/psychometricTest/types';
import {
  answerAll,
  config,
  fullBank,
  identityOrders,
  likert,
  likertScale,
  sjt,
  undefinedPaths,
} from './helpers';

describe('sanitizeAnswers', () => {
  const questions = [likert('l1', 'responsabilidad'), sjt('s1', [0, 1, 2, 3])];
  const orders = identityOrders(questions);

  it('drops answers to questions outside the session', () => {
    const { answers, rejected } = sanitizeAnswers(
      questions,
      [
        { questionId: 'l1', value: 4 },
        { questionId: 'no_existe', value: 4 },
      ],
      orders
    );
    expect(answers).toHaveLength(1);
    expect(rejected).toBe(1);
  });

  it('rejects Likert values outside 1-5 instead of coercing them', () => {
    for (const value of [0, 6, 999, -3, 2.5, Number.NaN]) {
      const { answers, rejected } = sanitizeAnswers(questions, [{ questionId: 'l1', value }], orders);
      expect(answers, `value ${value} should be rejected`).toHaveLength(0);
      expect(rejected).toBe(1);
    }
  });

  it('rejects SJT indexes outside the options shown', () => {
    const { answers } = sanitizeAnswers(questions, [{ questionId: 's1', value: 4 }], orders);
    expect(answers).toHaveLength(0);
  });

  it('keeps the last answer when a question is answered twice', () => {
    const { answers } = sanitizeAnswers(
      questions,
      [
        { questionId: 'l1', value: 2 },
        { questionId: 'l1', value: 5 },
      ],
      orders
    );
    expect(answers).toEqual([{ questionId: 'l1', value: 5, responseMs: undefined }]);
  });

  it('caps the number of answers it will look at', () => {
    const flood = Array.from({ length: MAX_ANSWERS_PER_SUBMISSION + 50 }, () => ({
      questionId: 'no_existe',
      value: 1,
    }));
    const { rejected } = sanitizeAnswers(questions, flood, orders);
    expect(rejected).toBe(MAX_ANSWERS_PER_SUBMISSION);
  });

  it('drops a negative or non-finite response time but keeps the answer', () => {
    const { answers } = sanitizeAnswers(
      questions,
      [{ questionId: 'l1', value: 3, responseMs: -100 }],
      orders
    );
    expect(answers[0]).toEqual({ questionId: 'l1', value: 3, responseMs: undefined });
  });
});

describe('scoreSession', () => {
  it('scores reverse-keyed items in the same direction as positive ones', () => {
    const questions = likertScale('responsabilidad', 8);
    // Maximum trait: agree with the positive items, disagree with the reverse ones.
    const answers = answerAll(questions, {
      likertValue: (question) => (question.reverseScored ? 1 : 5),
    });

    const { result } = scoreSession({ questions, answers, config: config() });
    expect(result.scales.responsabilidad.normalizedScore).toBe(100);
    expect(result.scales.responsabilidad.rawAverage).toBe(5);
  });

  it('puts a flat row of 1s at 0, not at 20', () => {
    const questions = likertScale('responsabilidad', 8).map((q) => ({ ...q, reverseScored: false }));
    const answers = answerAll(questions, { likertValue: 1 });
    const { result } = scoreSession({ questions, answers, config: config() });
    expect(result.scales.responsabilidad.normalizedScore).toBe(0);
  });

  it('reports a scale as "sin datos" instead of 0 when too little was answered', () => {
    const questions = likertScale('responsabilidad', 8);
    // Only two of eight answered — under minItemsPerScale.
    const answers = answerAll(questions.slice(0, 2), { likertValue: 5 });

    const { result } = scoreSession({ questions, answers, config: config({ minItemsPerScale: 4 }) });
    const scale = result.scales.responsabilidad;
    expect(scale.hasData).toBe(false);
    expect(scale.normalizedScore).toBe(0);
    expect(scale.itemsAnswered).toBe(2);
    expect(scale.itemsApplied).toBe(8);
  });

  it('still scores a scale whose applied item count is below the minimum', () => {
    // The instrument is thin, but the candidate answered everything they were given.
    const questions = likertScale('responsabilidad', 2);
    const answers = answerAll(questions, { likertValue: (q) => (q.reverseScored ? 1 : 5) });
    const { result } = scoreSession({ questions, answers, config: config({ minItemsPerScale: 4 }) });
    expect(result.scales.responsabilidad.hasData).toBe(true);
  });

  it('normalizes SJT by each scenario’s own maximum', () => {
    // One scenario keyed 0-3, one keyed 0-2; best option chosen in both.
    const questions = [sjt('a', [3, 2, 1, 0], 0), sjt('b', [2, 1, 0], 1)];
    const answers = answerAll(questions, { sjtIndex: 0 });
    const { result } = scoreSession({
      questions,
      answers,
      optionOrders: identityOrders(questions),
      config: config({ minItemsPerScale: 2 }),
    });
    expect(result.scales.sjt.normalizedScore).toBe(100);
  });

  it('maps the displayed option index back through the session’s shuffle', () => {
    const question = sjt('a', [3, 2, 1, 0]);
    // Displayed order reverses the options: displayed index 0 is the worst answer.
    const optionOrders = { a: [3, 2, 1, 0] };
    const { result } = scoreSession({
      questions: [question],
      answers: [{ questionId: 'a', value: 0, responseMs: 5000 }],
      optionOrders,
      config: config({ minItemsPerScale: 1 }),
    });
    expect(result.scales.sjt.normalizedScore).toBe(0);
  });

  it('excludes attention checks and response-style scales from the profile', () => {
    const questions = fullBank();
    const answers = answerAll(questions);
    const { result } = scoreSession({
      questions,
      answers,
      optionOrders: identityOrders(questions),
      config: config(),
    });

    // Every trait has 8 items; the style scales and checks contribute to none.
    for (const trait of PSYCHOMETRIC_TRAITS) {
      expect(result.scales[trait].itemsApplied).toBe(8);
    }
    expect(result.scales.sjt.itemsApplied).toBe(4);
  });

  it('renormalizes the composite over the scales that have data', () => {
    const questions = [...likertScale('responsabilidad', 8), sjt('a', [3, 2, 1, 0], 8)];
    const answers = answerAll(questions, {
      likertValue: (question) => (question.reverseScored ? 1 : 5),
      sjtIndex: 0,
    });

    const cfg = config({ minItemsPerScale: 1 });
    const { result } = scoreSession({
      questions,
      answers,
      optionOrders: identityOrders(questions),
      config: cfg,
    });

    // Both present scales scored 100, so any renormalization must land on 100 —
    // the missing traits must not drag the composite down.
    expect(result.compositeScore).toBe(100);
    expect(result.compositeHasData).toBe(true);
  });

  it('mixes the composite by weight, ignoring absent scales', () => {
    const questions = [...likertScale('responsabilidad', 8), sjt('a', [3, 2, 1, 0], 8)];
    const answers = answerAll(questions, {
      likertValue: (question) => (question.reverseScored ? 1 : 5), // trait = 100
      sjtIndex: 3, // worst option, sjt = 0
    });
    const cfg = config({ minItemsPerScale: 1 });
    const { result } = scoreSession({
      questions,
      answers,
      optionOrders: identityOrders(questions),
      config: cfg,
    });

    const expected = Math.round(
      (100 * cfg.weights.responsabilidad + 0 * cfg.weights.sjt) /
        (cfg.weights.responsabilidad + cfg.weights.sjt)
    );
    expect(result.compositeScore).toBe(expected);
  });

  it('reports no composite when nothing could be scored', () => {
    const questions = likertScale('responsabilidad', 8);
    const { result } = scoreSession({ questions, answers: [], config: config() });
    expect(result.compositeHasData).toBe(false);
    expect(result.compositeScore).toBe(0);
  });

  it('cannot be inflated by out-of-range values in the payload', () => {
    const questions = likertScale('responsabilidad', 8);
    const answers = questions.map((question) => ({ questionId: question.id, value: 500 }));
    const { result } = scoreSession({ questions, answers, config: config() });
    expect(result.scales.responsabilidad.hasData).toBe(false);
    expect(result.compositeScore).toBe(0);
  });

  it('returns the sanitized answers for persistence', () => {
    const questions = likertScale('responsabilidad', 4);
    const scored = scoreSession({
      questions,
      answers: [
        { questionId: questions[0].id, value: 4, responseMs: 3000 },
        { questionId: 'basura', value: 9 },
      ],
      config: config(),
    });
    expect(scored.answers).toHaveLength(1);
    expect(scored.rejected).toBe(1);
  });
});

describe('what gets persisted', () => {
  it('produces a result and answers free of undefined values', () => {
    // Both objects are written to Firestore verbatim, and Firestore rejects
    // undefined — so an optional field has to be absent, not undefined.
    const questions = fullBank();
    const scored = scoreSession({
      questions,
      answers: answerAll(questions, { responseMs: 0 }),
      optionOrders: identityOrders(questions),
      config: config(),
    });

    expect(undefinedPaths(scored.result)).toEqual([]);
    expect(undefinedPaths(scored.answers)).toEqual([]);
  });

  it('stays clean when local norms add percentiles to the result', () => {
    const questions = fullBank();
    const norms = {
      scales: Object.fromEntries(
        ['responsabilidad', 'estabilidad_emocional', 'extraversion', 'amabilidad', 'integridad', 'sjt', 'composite'].map(
          (key) => [key, { n: 120, sum: 120 * 70, sumSq: 120 * (70 * 70 + 100) }]
        )
      ),
    };

    const scored = scoreSession({
      questions,
      answers: answerAll(questions),
      optionOrders: identityOrders(questions),
      config: config(),
      norms,
    });

    expect(scored.result.scales.responsabilidad.percentile).toBeDefined();
    expect(undefinedPaths(scored.result)).toEqual([]);
  });
});

describe('normObservationsFrom', () => {
  it('contributes only the scales that have data, plus the composite', () => {
    const questions = [...likertScale('responsabilidad', 8), sjt('a', [3, 2, 1, 0], 8)];
    const answers = answerAll(questions, { likertValue: 4, sjtIndex: 0 });
    const { result } = scoreSession({
      questions,
      answers,
      optionOrders: identityOrders(questions),
      config: config({ minItemsPerScale: 1 }),
    });

    const keys = normObservationsFrom(result).map((observation) => observation.key);
    expect(keys).toContain('responsabilidad');
    expect(keys).toContain('sjt');
    expect(keys).toContain('composite');
    expect(keys).not.toContain('integridad');
  });
});
