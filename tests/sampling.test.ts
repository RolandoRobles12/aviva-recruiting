import { describe, expect, it } from 'vitest';
import { assembleTest, auditBank, sampleN, shuffle } from '../functions/src/psychometricTest/sampling';
import { DEFAULT_QUESTION_BANK, DEFAULT_TEST_CONFIG } from '../functions/src/psychometricTest/defaultBank';
import {
  PSYCHOMETRIC_TRAITS,
  type PsychometricLikertQuestion,
} from '../functions/src/psychometricTest/types';
import { attention, config, fullBank, likertScale, sjt } from './helpers';

describe('shuffle / sampleN', () => {
  it('keeps every element and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('treats 0 and oversized counts as "take everything"', () => {
    expect(sampleN([1, 2, 3], 0)).toHaveLength(3);
    expect(sampleN([1, 2, 3], 99)).toHaveLength(3);
    expect(sampleN([1, 2, 3], 2)).toHaveLength(2);
  });
});

describe('assembleTest', () => {
  const bank = DEFAULT_QUESTION_BANK;

  it('applies the configured number of items per group', () => {
    const cfg = DEFAULT_TEST_CONFIG;
    const { questions } = assembleTest(bank, cfg);

    for (const trait of PSYCHOMETRIC_TRAITS) {
      const count = questions.filter((q) => q.type === 'likert' && q.scale === trait).length;
      expect(count, trait).toBe(cfg.questionCounts.likertPerTrait);
    }
    expect(questions.filter((q) => q.type === 'likert' && q.scale === 'deseabilidad_social')).toHaveLength(
      cfg.questionCounts.deseabilidadSocial
    );
    expect(questions.filter((q) => q.type === 'likert' && q.scale === 'infrecuencia')).toHaveLength(
      cfg.questionCounts.infrecuencia
    );
    expect(questions.filter((q) => q.type === 'attention')).toHaveLength(cfg.questionCounts.atencion);
    expect(questions.filter((q) => q.type === 'sjt')).toHaveLength(cfg.questionCounts.sjt);
  });

  it('balances positive and reverse wording within every trait', () => {
    // Repeat: the sample is random, and the balance has to hold every time.
    for (let run = 0; run < 25; run++) {
      const { questions } = assembleTest(bank, DEFAULT_TEST_CONFIG);
      for (const trait of PSYCHOMETRIC_TRAITS) {
        const items = questions.filter(
          (q): q is PsychometricLikertQuestion => q.type === 'likert' && q.scale === trait
        );
        const reversed = items.filter((q) => q.reverseScored).length;
        expect(reversed, `${trait} en la corrida ${run}`).toBe(Math.floor(items.length / 2));
      }
    }
  });

  it('never repeats an item inside one session', () => {
    const { questions } = assembleTest(bank, DEFAULT_TEST_CONFIG);
    const ids = new Set(questions.map((q) => q.id));
    expect(ids.size).toBe(questions.length);
  });

  it('puts the scenarios after the personality block', () => {
    const { questions } = assembleTest(bank, DEFAULT_TEST_CONFIG);
    const firstSjt = questions.findIndex((q) => q.type === 'sjt');
    const lastLikert = questions.map((q) => q.type).lastIndexOf('likert');
    expect(firstSjt).toBeGreaterThan(lastLikert);
  });

  it('spaces the attention checks out instead of leaving them at an edge', () => {
    for (let run = 0; run < 25; run++) {
      const { questions } = assembleTest(bank, DEFAULT_TEST_CONFIG);
      const positions = questions
        .map((question, index) => ({ question, index }))
        .filter(({ question }) => question.type === 'attention')
        .map(({ index }) => index);

      expect(positions).toHaveLength(DEFAULT_TEST_CONFIG.questionCounts.atencion);
      expect(positions[0]).toBeGreaterThan(0);
      // Never adjacent to each other.
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i] - positions[i - 1]).toBeGreaterThan(1);
      }
    }
  });

  it('interleaves traits so consecutive items rarely share a scale', () => {
    const { questions } = assembleTest(bank, DEFAULT_TEST_CONFIG);
    const likertRun = questions.filter((q) => q.type === 'likert') as PsychometricLikertQuestion[];
    let adjacentSameScale = 0;
    for (let i = 1; i < likertRun.length; i++) {
      if (likertRun[i].scale === likertRun[i - 1].scale) adjacentSameScale += 1;
    }
    // The tail of the draw can force a repeat; it must stay marginal.
    expect(adjacentSameScale).toBeLessThan(likertRun.length * 0.15);
  });

  it('freezes a shuffled option order for every scenario', () => {
    const { questions, optionOrders } = assembleTest(bank, DEFAULT_TEST_CONFIG);
    const scenarios = questions.filter((q) => q.type === 'sjt');
    for (const scenario of scenarios) {
      const order = optionOrders[scenario.id];
      expect(order).toBeDefined();
      expect([...order].sort((a, b) => a - b)).toEqual(
        scenario.type === 'sjt' ? scenario.options.map((_, index) => index) : []
      );
    }
  });

  it('ignores disabled items', () => {
    const disabled = bank.map((question) => ({ ...question, enabled: false }));
    expect(assembleTest(disabled, DEFAULT_TEST_CONFIG).questions).toHaveLength(0);
  });

  it('applies everything available when a count exceeds the bank', () => {
    const small = likertScale('responsabilidad', 3);
    const { questions } = assembleTest(small, config({ questionCounts: { ...DEFAULT_TEST_CONFIG.questionCounts, likertPerTrait: 8 } }));
    expect(questions).toHaveLength(3);
  });
});

describe('auditBank', () => {
  it('passes a complete bank with the matching config', () => {
    const warnings = auditBank(DEFAULT_QUESTION_BANK, DEFAULT_TEST_CONFIG);
    expect(warnings.filter((warning) => warning.level === 'error')).toEqual([]);
  });

  it('reports a trait with no items as an error', () => {
    const bank = DEFAULT_QUESTION_BANK.filter(
      (question) => !(question.type === 'likert' && question.scale === 'integridad')
    );
    const warnings = auditBank(bank, DEFAULT_TEST_CONFIG);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'error', scope: 'integridad' })])
    );
  });

  it('warns when a scale has no reverse-worded items', () => {
    const bank = [
      ...likertScale('responsabilidad', 8).map((q) => ({ ...q, reverseScored: false })),
      ...likertScale('estabilidad_emocional', 8),
      ...likertScale('extraversion', 8),
      ...likertScale('amabilidad', 8),
      ...likertScale('integridad', 8),
      attention('a', 2),
      attention('b', 5),
      sjt('s1', [3, 2, 1, 0]),
      sjt('s2', [3, 2, 1, 0]),
      sjt('s3', [3, 2, 1, 0]),
      sjt('s4', [3, 2, 1, 0]),
      sjt('s5', [3, 2, 1, 0]),
    ];
    const warnings = auditBank(bank, DEFAULT_TEST_CONFIG);
    expect(
      warnings.some(
        (warning) => warning.scope === 'responsabilidad' && warning.message.includes('misma dirección')
      )
    ).toBe(true);
  });

  it('errors when the config asks for attention checks the bank does not have', () => {
    const bank = fullBank().filter((question) => question.type !== 'attention');
    const warnings = auditBank(bank, DEFAULT_TEST_CONFIG);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'error', scope: 'atencion' })])
    );
  });

  it('errors on inverted band cutoffs and on all-zero weights', () => {
    const broken = config({
      bandCutoffs: { lowMax: 80, highMin: 40 },
      weights: {
        responsabilidad: 0,
        estabilidad_emocional: 0,
        extraversion: 0,
        amabilidad: 0,
        integridad: 0,
        sjt: 0,
      },
    });
    const scopes = auditBank(DEFAULT_QUESTION_BANK, broken)
      .filter((warning) => warning.level === 'error')
      .map((warning) => warning.scope);
    expect(scopes).toContain('bandas');
    expect(scopes).toContain('ponderacion');
  });
});
