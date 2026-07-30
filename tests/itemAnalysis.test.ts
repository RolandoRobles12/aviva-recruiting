import { describe, expect, it } from 'vitest';
import { analyzeBank, type AnalysisSession } from '../functions/src/psychometricTest/itemAnalysis';
import type {
  PsychometricAnswer,
  PsychometricQuestion,
} from '../functions/src/psychometricTest/types';
import { attention, likertScale, sjt } from './helpers';

/** Deterministic pseudo-random source, so the statistics are reproducible. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function clampLikert(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

/**
 * Builds sessions where every item of a scale reflects one underlying trait plus
 * noise — the structure a working scale is supposed to have.
 */
function coherentSessions(
  questions: PsychometricQuestion[],
  count: number,
  options: { seed?: number; miskeyed?: Set<string>; noise?: number } = {}
): AnalysisSession[] {
  const { seed = 7, miskeyed = new Set<string>(), noise = 0.6 } = options;
  const random = rng(seed);
  const ids = questions.map((question) => question.id);

  return Array.from({ length: count }, () => {
    const trueScore = 1 + random() * 4; // the candidate's standing on the trait
    const answers: PsychometricAnswer[] = questions.map((question) => {
      if (question.type === 'attention') {
        return { questionId: question.id, value: question.expectedValue, responseMs: 5000 };
      }
      if (question.type === 'sjt') {
        // Higher trait → more likely to pick a better-scored option.
        const index = trueScore > 3 ? (random() < 0.8 ? 0 : 1) : Math.floor(random() * question.options.length);
        return { questionId: question.id, value: index, responseMs: 8000 };
      }
      // A miskeyed item is answered as if its wording pointed the other way,
      // which is what an item-total correlation is supposed to expose.
      const target = miskeyed.has(question.id) ? 6 - trueScore : trueScore;
      const raw = question.reverseScored ? 6 - target : target;
      return {
        questionId: question.id,
        value: clampLikert(raw + (random() - 0.5) * noise * 2),
        responseMs: 5000,
      };
    });

    return { questionIds: ids, answers, optionOrders: {}, validityVerdict: 'confiable' };
  });
}

describe('analyzeBank', () => {
  const questions: PsychometricQuestion[] = [
    ...likertScale('responsabilidad', 6),
    ...likertScale('extraversion', 6, 6),
    attention('chk', 3, 12),
    sjt('esc_1', [3, 2, 1, 0], 13),
    sjt('esc_2', [3, 2, 1, 0], 14),
    sjt('esc_3', [3, 2, 1, 0], 15),
  ];

  it('reports a usable alpha for a coherent scale', () => {
    const analysis = analyzeBank(questions, coherentSessions(questions, 120));
    const scale = analysis.scales.find((entry) => entry.scale === 'responsabilidad')!;
    expect(scale.n).toBe(120);
    expect(scale.itemsAnalyzed).toBe(6);
    expect(scale.alpha).not.toBeNull();
    expect(scale.alpha!).toBeGreaterThan(0.7);
    expect(scale.minPairwiseN).toBe(120);
  });

  it('reports a near-zero alpha when the answers carry no common factor', () => {
    const random = rng(3);
    const ids = questions.map((question) => question.id);
    const sessions: AnalysisSession[] = Array.from({ length: 120 }, () => ({
      questionIds: ids,
      answers: questions.map((question) => ({
        questionId: question.id,
        value:
          question.type === 'sjt'
            ? Math.floor(random() * question.options.length)
            : clampLikert(1 + random() * 4),
        responseMs: 5000,
      })),
      optionOrders: {},
      validityVerdict: 'confiable',
    }));

    const scale = analyzeBank(questions, sessions).scales.find(
      (entry) => entry.scale === 'responsabilidad'
    )!;
    expect(scale.alpha!).toBeLessThan(0.3);
  });

  it('singles out an item that does not go with the rest of its scale', () => {
    const badItem = questions[0].id;
    const analysis = analyzeBank(
      questions,
      coherentSessions(questions, 120, { miskeyed: new Set([badItem]) })
    );

    const bad = analysis.items.find((item) => item.id === badItem)!;
    const good = analysis.items.find((item) => item.id === questions[2].id)!;
    expect(bad.itemTotalCorrelation!).toBeLessThan(0);
    expect(good.itemTotalCorrelation!).toBeGreaterThan(0.4);
    expect(bad.issues.join(' ')).toContain('Discriminación baja');
  });

  it('measures the pass rate of attention checks', () => {
    const sessions = coherentSessions(questions, 40);
    // Over a third of the sample fails the check — past the point where the
    // instruction itself, not the candidates, is the likely problem.
    const withFailures = sessions.map((session, index) =>
      index % 3 === 0
        ? {
            ...session,
            answers: session.answers.map((answer) =>
              answer.questionId === 'chk' ? { ...answer, value: 1 } : answer
            ),
          }
        : session
    );

    const item = analyzeBank(questions, withFailures).items.find((entry) => entry.id === 'chk')!;
    expect(item.passRate).toBeCloseTo(0.65, 2);
    expect(item.issues.join(' ')).toContain('instrucción puede ser confusa');
  });

  it('reports the option distribution of a scenario through the session shuffle', () => {
    const scenario = sjt('solo', [3, 2, 1, 0]);
    // Displayed order reverses the options, so displayed index 0 is the worst.
    const sessions: AnalysisSession[] = Array.from({ length: 20 }, () => ({
      questionIds: ['solo'],
      answers: [{ questionId: 'solo', value: 0, responseMs: 9000 }],
      optionOrders: { solo: [3, 2, 1, 0] },
      validityVerdict: 'confiable',
    }));

    const item = analyzeBank([scenario], sessions).items[0];
    expect(item.optionDistribution?.[3]).toMatchObject({ score: 0, share: 1 });
    expect(item.mean).toBe(0);
    expect(item.issues.join(' ')).toContain('Casi nadie elige la opción clave');
  });

  it('flags a scenario everybody gets right as non-discriminating', () => {
    const scenario = sjt('facil', [3, 2, 1, 0]);
    const sessions: AnalysisSession[] = Array.from({ length: 20 }, () => ({
      questionIds: ['facil'],
      answers: [{ questionId: 'facil', value: 0, responseMs: 9000 }],
      optionOrders: {},
      validityVerdict: 'confiable',
    }));
    const item = analyzeBank([scenario], sessions).items[0];
    expect(item.issues.join(' ')).toContain('no discrimina');
  });

  it('leaves unreliable sessions out of every statistic', () => {
    const usable = coherentSessions(questions, 30, { seed: 11 });
    const careless: AnalysisSession[] = Array.from({ length: 60 }, () => ({
      questionIds: questions.map((question) => question.id),
      answers: questions.map((question) => ({
        questionId: question.id,
        value: question.type === 'sjt' ? 3 : 3,
        responseMs: 200,
      })),
      optionOrders: {},
      validityVerdict: 'no_confiable',
    }));

    const analysis = analyzeBank(questions, [...usable, ...careless]);
    expect(analysis.sessionsAnalyzed).toBe(30);
    expect(analysis.sessionsExcluded).toBe(60);
    expect(analysis.scales.find((scale) => scale.scale === 'responsabilidad')!.n).toBe(30);
  });

  it('says so instead of guessing when there is not enough data', () => {
    const analysis = analyzeBank(questions, coherentSessions(questions, 3));
    const scale = analysis.scales.find((entry) => entry.scale === 'responsabilidad')!;
    expect(scale.alpha).toBeNull();
    expect(scale.notes.join(' ')).toContain('respuestas para estimar');
    const item = analysis.items[0];
    expect(item.itemTotalCorrelation).toBeNull();
    expect(item.issues.join(' ')).toContain('Muestra insuficiente');
  });

  it('ignores answers to questions the session never applied', () => {
    const sessions: AnalysisSession[] = [
      {
        questionIds: [questions[0].id],
        answers: [
          { questionId: questions[0].id, value: 4 },
          { questionId: questions[5].id, value: 5 },
        ],
        optionOrders: {},
        validityVerdict: 'confiable',
      },
    ];
    const analysis = analyzeBank(questions, sessions);
    expect(analysis.items.find((item) => item.id === questions[0].id)!.n).toBe(1);
    expect(analysis.items.find((item) => item.id === questions[5].id)!.n).toBe(0);
  });
});
