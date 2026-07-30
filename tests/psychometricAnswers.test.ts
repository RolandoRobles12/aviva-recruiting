import { describe, expect, it } from 'vitest';
import {
  answersForScale,
  controlAnswers,
  resolveAppliedQuestions,
} from '../src/lib/psychometricAnswers';
import type { PsychometricQuestion, PsychometricSession } from '../src/types';

const LIKERT = (
  id: string,
  scale: string,
  reverseScored = false
): PsychometricQuestion =>
  ({
    id,
    type: 'likert',
    scale,
    text: `Enunciado ${id}`,
    reverseScored,
    enabled: true,
    order: 0,
  }) as PsychometricQuestion;

const SJT: PsychometricQuestion = {
  id: 's1',
  type: 'sjt',
  text: 'Escenario',
  options: [
    { text: 'La mejor', score: 3 },
    { text: 'Aceptable', score: 2 },
    { text: 'Floja', score: 1 },
    { text: 'La peor', score: 0 },
  ],
  enabled: true,
  order: 0,
};

const CHECK: PsychometricQuestion = {
  id: 'a1',
  type: 'attention',
  text: 'Marca "En desacuerdo"',
  expectedValue: 2,
  enabled: true,
  order: 0,
};

function session(overrides: Partial<PsychometricSession> = {}): PsychometricSession {
  return {
    id: 'sess',
    candidateName: 'Test',
    candidateEmail: 't@a.com',
    token: 'tok',
    status: 'completed',
    createdBy: 'uid',
    timeLimitMinutes: 35,
    ...overrides,
  } as PsychometricSession;
}

describe('answersForScale', () => {
  it('reads a positively worded item as given', () => {
    const questions = [LIKERT('q1', 'responsabilidad')];
    const [item] = answersForScale(
      session({ appliedQuestions: questions, answers: [{ questionId: 'q1', value: 5 }] }),
      [],
      'responsabilidad'
    );
    expect(item.answerLabel).toBe('Totalmente de acuerdo');
    expect(item.scored).toBe(5);
    expect(item.tone).toBe('favorable');
  });

  it('flips the reading of a reverse-worded item', () => {
    // Disagreeing with "dejo las tareas para el último momento" is the good answer.
    const questions = [LIKERT('q1', 'responsabilidad', true)];
    const [item] = answersForScale(
      session({ appliedQuestions: questions, answers: [{ questionId: 'q1', value: 1 }] }),
      [],
      'responsabilidad'
    );
    expect(item.answerLabel).toBe('Totalmente en desacuerdo');
    expect(item.scored).toBe(5);
    expect(item.tone).toBe('favorable');
  });

  it('maps an SJT answer back through the order shown to that candidate', () => {
    // The session displayed the options reversed, so displayed index 0 was the
    // worst answer. Reading the raw index would have shown "La mejor".
    const [item] = answersForScale(
      session({
        appliedQuestions: [SJT],
        optionOrders: { s1: [3, 2, 1, 0] },
        answers: [{ questionId: 's1', value: 0 }],
      }),
      [],
      'sjt'
    );
    expect(item.answerLabel).toBe('La peor');
    expect(item.scored).toBe(0);
    expect(item.max).toBe(3);
    expect(item.tone).toBe('desfavorable');
  });

  it('marks the best SJT option as favourable', () => {
    const [item] = answersForScale(
      session({
        appliedQuestions: [SJT],
        optionOrders: { s1: [0, 1, 2, 3] },
        answers: [{ questionId: 's1', value: 0 }],
      }),
      [],
      'sjt'
    );
    expect(item.answerLabel).toBe('La mejor');
    expect(item.tone).toBe('favorable');
  });

  it('shows unanswered items instead of hiding them', () => {
    const [item] = answersForScale(
      session({ appliedQuestions: [LIKERT('q1', 'amabilidad')], answers: [] }),
      [],
      'amabilidad'
    );
    expect(item.answerLabel).toBe('Sin responder');
    expect(item.scored).toBeUndefined();
    expect(item.tone).toBe('sin_responder');
  });

  it('only returns the items of the scale asked for', () => {
    const questions = [LIKERT('q1', 'responsabilidad'), LIKERT('q2', 'integridad'), SJT];
    const applied = session({ appliedQuestions: questions, answers: [] });
    expect(answersForScale(applied, [], 'integridad').map((i) => i.question.id)).toEqual(['q2']);
    expect(answersForScale(applied, [], 'sjt').map((i) => i.question.id)).toEqual(['s1']);
  });
});

describe('controlAnswers', () => {
  it('shows what the attention check asked for and what was given', () => {
    const [item] = controlAnswers(
      session({ appliedQuestions: [CHECK], answers: [{ questionId: 'a1', value: 5 }] }),
      []
    );
    expect(item.answerLabel).toContain('Totalmente de acuerdo');
    expect(item.answerLabel).toContain('se pedía "En desacuerdo"');
    expect(item.tone).toBe('desfavorable');
  });

  it('marks a passed check as favourable', () => {
    const [item] = controlAnswers(
      session({ appliedQuestions: [CHECK], answers: [{ questionId: 'a1', value: 2 }] }),
      []
    );
    expect(item.tone).toBe('favorable');
  });

  it('reads agreement on the response-style scales as the bad outcome', () => {
    // "Nunca me he molestado con nadie" — agreeing is what raises the flag, so
    // the colour has to be inverted relative to a trait item.
    const questions = [LIKERT('d1', 'deseabilidad_social'), LIKERT('i1', 'infrecuencia')];
    const items = controlAnswers(
      session({
        appliedQuestions: questions,
        answers: [
          { questionId: 'd1', value: 5 },
          { questionId: 'i1', value: 1 },
        ],
      }),
      []
    );
    expect(items[0].tone).toBe('desfavorable');
    expect(items[1].tone).toBe('favorable');
  });

  it('leaves the scored traits out', () => {
    const items = controlAnswers(
      session({ appliedQuestions: [LIKERT('q1', 'responsabilidad'), CHECK], answers: [] }),
      []
    );
    expect(items.map((item) => item.question.id)).toEqual(['a1']);
  });
});

describe('resolveAppliedQuestions', () => {
  it('prefers the session snapshot and keeps the presentation order', () => {
    const snapshot = [LIKERT('q1', 'responsabilidad'), LIKERT('q2', 'responsabilidad')];
    const resolved = resolveAppliedQuestions(
      session({ appliedQuestions: snapshot, questionOrder: ['q2', 'q1'] }),
      []
    );
    expect(resolved.map((q) => q.id)).toEqual(['q2', 'q1']);
  });

  it('falls back to the bank for sessions that only stored ids', () => {
    const bank = [LIKERT('q1', 'responsabilidad'), LIKERT('q2', 'integridad')];
    const resolved = resolveAppliedQuestions(session({ questionOrder: ['q2'] }), bank);
    expect(resolved.map((q) => q.id)).toEqual(['q2']);
  });

  it('skips ids the bank no longer has', () => {
    const bank = [LIKERT('q1', 'responsabilidad')];
    expect(resolveAppliedQuestions(session({ questionOrder: ['q1', 'borrada'] }), bank)).toHaveLength(1);
  });

  it('returns nothing when there is nothing to resolve', () => {
    expect(resolveAppliedQuestions(session(), [])).toEqual([]);
  });
});
