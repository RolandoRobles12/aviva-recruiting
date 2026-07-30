import { describe, expect, it } from 'vitest';
import {
  assessValidity,
  computeValidityIndices,
  flagsFromIndices,
  minimumReadingMs,
  severityOf,
  verdictFor,
} from '../functions/src/psychometricTest/validity';
import type {
  PsychometricAnswer,
  PsychometricQuestion,
} from '../functions/src/psychometricTest/types';
import { attention, fullBank, likert, likertScale, sjt, styleItemsForward } from './helpers';

/** Scored target per trait, so the two keying halves agree by construction. */
const TRAIT_TARGET: Record<string, number> = {
  responsabilidad: 5,
  estabilidad_emocional: 4,
  extraversion: 3,
  amabilidad: 4,
  integridad: 5,
};

/**
 * A candidate answering attentively: consistent across keying, varied raw
 * values, low scores on the response-style scales, checks passed.
 */
function honestAnswers(questions: PsychometricQuestion[], responseMs = 6000): PsychometricAnswer[] {
  return questions.map((question) => {
    if (question.type === 'attention') {
      return { questionId: question.id, value: question.expectedValue, responseMs };
    }
    if (question.type === 'sjt') {
      return { questionId: question.id, value: 0, responseMs };
    }
    if (question.scale === 'deseabilidad_social') {
      return { questionId: question.id, value: 2, responseMs };
    }
    if (question.scale === 'infrecuencia') {
      return { questionId: question.id, value: 1, responseMs };
    }
    const target = TRAIT_TARGET[question.scale] ?? 4;
    return {
      questionId: question.id,
      value: question.reverseScored ? 6 - target : target,
      responseMs,
    };
  });
}

const BANK = styleItemsForward(fullBank());

describe('minimumReadingMs', () => {
  it('scales with how much there is to read', () => {
    const short = minimumReadingMs(likert('l', 'responsabilidad'));
    const scenario = minimumReadingMs(sjt('s', [3, 2, 1, 0]));
    expect(scenario).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(1000);
  });
});

describe('assessValidity', () => {
  it('clears an attentive, consistent response set', () => {
    const validity = assessValidity(BANK, honestAnswers(BANK));
    expect(validity.flags).toEqual([]);
    expect(validity.verdict).toBe('confiable');
    expect(validity.indices.completionRate).toBe(1);
    expect(validity.indices.keyingInconsistency).toBe(0);
  });

  it('catches straight-lining through both the run length and the variability', () => {
    // No attention checks here, so the verdict rests on the pattern alone.
    const questions = BANK.filter((question) => question.type !== 'attention');
    const answers = questions.map((question) => ({
      questionId: question.id,
      value: question.type === 'sjt' ? 0 : 3,
      responseMs: 6000,
    }));

    const validity = assessValidity(questions, answers);
    expect(validity.flags).toContain('patron_repetitivo');
    expect(validity.flags).toContain('baja_variacion');
    expect(validity.verdict).toBe('no_confiable');
  });

  it('treats one failed attention check as a review and two as unusable', () => {
    const base = honestAnswers(BANK);
    const checks = BANK.filter((q) => q.type === 'attention');
    expect(checks.length).toBeGreaterThanOrEqual(2);

    const failOne = base.map((answer) =>
      answer.questionId === checks[0].id ? { ...answer, value: 4 } : answer
    );
    const one = assessValidity(BANK, failOne);
    expect(one.indices.attentionChecksFailed).toBe(1);
    expect(one.verdict).toBe('revisar');

    const failTwo = failOne.map((answer) =>
      answer.questionId === checks[1].id ? { ...answer, value: 1 } : answer
    );
    const two = assessValidity(BANK, failTwo);
    expect(two.indices.attentionChecksFailed).toBe(2);
    expect(two.verdict).toBe('no_confiable');
  });

  it('detects answers that ignore the wording direction', () => {
    // Alternating 5/4 by position: varied enough to pass the straight-lining
    // checks, but it pushes the positive and reverse halves 3 points apart.
    const answers = BANK.map((question, index) => {
      if (question.type === 'attention') {
        return { questionId: question.id, value: question.expectedValue, responseMs: 6000 };
      }
      if (question.type === 'sjt') return { questionId: question.id, value: 0, responseMs: 6000 };
      return { questionId: question.id, value: index % 2 === 0 ? 5 : 4, responseMs: 6000 };
    });

    const validity = assessValidity(BANK, answers);
    expect(validity.indices.keyingInconsistency).toBeGreaterThan(1.25);
    expect(validity.flags).toContain('respuestas_inconsistentes');
    expect(validity.indices.irv).toBeGreaterThanOrEqual(0.45);
    expect(validity.flags).not.toContain('baja_variacion');
  });

  it('flags a test clicked through faster than it can be read', () => {
    const validity = assessValidity(BANK, honestAnswers(BANK, 250));
    expect(validity.flags).toEqual(['respuestas_muy_rapidas']);
    expect(validity.indices.fastResponseRatio).toBe(1);
    expect(validity.verdict).toBe('revisar');
  });

  it('flags agreement with the infrequency items', () => {
    const answers = honestAnswers(BANK).map((answer) => {
      const question = BANK.find((q) => q.id === answer.questionId)!;
      return question.type === 'likert' && question.scale === 'infrecuencia'
        ? { ...answer, value: 5 }
        : answer;
    });

    const validity = assessValidity(BANK, answers);
    expect(validity.indices.infrequencyScore).toBe(100);
    expect(validity.flags).toContain('escala_infrecuencia_alta');
  });

  it('raises social desirability as a caution, never on its own as unusable', () => {
    const answers = honestAnswers(BANK).map((answer) => {
      const question = BANK.find((q) => q.id === answer.questionId)!;
      return question.type === 'likert' && question.scale === 'deseabilidad_social'
        ? { ...answer, value: 5 }
        : answer;
    });

    const validity = assessValidity(BANK, answers);
    expect(validity.flags).toEqual(['posible_deseabilidad_social']);
    expect(validity.verdict).toBe('revisar');
  });

  it('marks a session abandoned halfway as unusable', () => {
    const answered = honestAnswers(BANK).slice(0, Math.floor(BANK.length * 0.4));
    const validity = assessValidity(BANK, answered);
    expect(validity.indices.completionRate).toBeLessThan(0.6);
    expect(validity.flags).toContain('respuestas_incompletas');
    expect(validity.verdict).toBe('no_confiable');
  });

  it('treats a partly unfinished test as a mild flag only', () => {
    // ~85% answered: over the "unusable" line, under the "complete" one.
    const answered = honestAnswers(BANK).slice(0, Math.floor(BANK.length * 0.85));
    const validity = assessValidity(BANK, answered);
    expect(validity.indices.completionRate).toBeGreaterThan(0.6);
    expect(validity.indices.completionRate).toBeLessThan(0.9);
    expect(validity.flags).toEqual(['respuestas_incompletas']);
    expect(validity.verdict).toBe('revisar');
  });
});

describe('index computation details', () => {
  it('measures the longest identical run in presentation order', () => {
    const questions = likertScale('responsabilidad', 6).map((q) => ({ ...q, reverseScored: false }));
    const values = [3, 3, 3, 3, 5, 1];
    const answers = questions.map((question, index) => ({
      questionId: question.id,
      value: values[index],
      responseMs: 6000,
    }));
    const indices = computeValidityIndices(questions, answers);
    expect(indices.longString).toBe(4);
    expect(indices.longStringRatio).toBeCloseTo(4 / 6, 5);
  });

  it('counts a straight run through an attention check', () => {
    const questions: PsychometricQuestion[] = [
      likert('a', 'responsabilidad', false, 0),
      likert('b', 'responsabilidad', false, 1),
      attention('chk', 3, 2),
      likert('c', 'responsabilidad', false, 3),
    ];
    const answers = questions.map((question) => ({
      questionId: question.id,
      value: 3,
      responseMs: 6000,
    }));
    expect(computeValidityIndices(questions, answers).longString).toBe(4);
  });

  it('leaves indices null when there is not enough data to compute them', () => {
    const questions = [likert('a', 'responsabilidad')];
    const indices = computeValidityIndices(questions, [
      { questionId: 'a', value: 3, responseMs: 4000 },
    ]);
    expect(indices.irv).toBeNull();
    expect(indices.keyingInconsistency).toBeNull();
    expect(indices.evenOddConsistency).toBeNull();
    expect(indices.infrequencyScore).toBeNull();
    expect(indices.socialDesirabilityScore).toBeNull();
    expect(flagsFromIndices(indices)).toEqual([]);
  });
});

describe('verdict arithmetic', () => {
  it('adds up mild signals into a review', () => {
    const indices = computeValidityIndices(BANK, honestAnswers(BANK));
    const flags = ['posible_deseabilidad_social' as const];
    expect(severityOf(flags, indices)).toBe(2);
    expect(verdictFor(2)).toBe('revisar');
    expect(verdictFor(1)).toBe('confiable');
    expect(verdictFor(6)).toBe('no_confiable');
  });
});
