import { describe, expect, it } from 'vitest';
import { RECOMMENDED_PER_TRAIT, applyBankFix, validateBank } from '../src/lib/bankValidation';
import {
  PSYCHOMETRIC_TRAITS,
  type PsychometricQuestion,
  type PsychometricTestConfig,
} from '../src/types';

function config(overrides: Partial<PsychometricTestConfig> = {}): PsychometricTestConfig {
  return {
    weights: {
      responsabilidad: 0.25,
      integridad: 0.2,
      estabilidad_emocional: 0.2,
      sjt: 0.15,
      extraversion: 0.1,
      amabilidad: 0.1,
    },
    bandCutoffs: { lowMax: 55, highMin: 75 },
    percentileCutoffs: { lowMaxPercentile: 25, highMinPercentile: 75 },
    timeLimitMinutes: 35,
    questionCounts: { likertPerTrait: 8, sjt: 8, deseabilidadSocial: 4, infrecuencia: 3, atencion: 2 },
    minItemsPerScale: 4,
    useLocalNorms: true,
    ...overrides,
  };
}

/** A healthy bank: every trait covered with balanced keying, plus the extras. */
function healthyBank(itemsPerTrait = 20): PsychometricQuestion[] {
  const questions: PsychometricQuestion[] = [];
  for (const trait of PSYCHOMETRIC_TRAITS) {
    for (let i = 0; i < itemsPerTrait; i++) {
      questions.push({
        id: `${trait}_${i}`,
        type: 'likert',
        scale: trait,
        text: `Reactivo ${i} de ${trait}`,
        reverseScored: i % 2 === 1,
        enabled: true,
        order: questions.length,
      });
    }
  }
  for (let i = 0; i < 6; i++) {
    questions.push({
      id: `desea_${i}`,
      type: 'likert',
      scale: 'deseabilidad_social',
      text: `Deseabilidad ${i}`,
      reverseScored: false,
      enabled: true,
      order: questions.length,
    });
  }
  for (let i = 0; i < 5; i++) {
    questions.push({
      id: `infre_${i}`,
      type: 'likert',
      scale: 'infrecuencia',
      text: `Infrecuencia ${i}`,
      reverseScored: false,
      enabled: true,
      order: questions.length,
    });
  }
  for (let i = 0; i < 3; i++) {
    questions.push({
      id: `aten_${i}`,
      type: 'attention',
      text: `Control ${i}`,
      expectedValue: 2,
      enabled: true,
      order: questions.length,
    });
  }
  for (let i = 0; i < 8; i++) {
    questions.push({
      id: `sjt_${i}`,
      type: 'sjt',
      text: `Escenario ${i}`,
      options: [
        { text: 'Mejor', score: 3 },
        { text: 'Buena', score: 2 },
        { text: 'Regular', score: 1 },
        { text: 'Mala', score: 0 },
      ],
      enabled: true,
      order: questions.length,
    });
  }
  return questions;
}

describe('validateBank', () => {
  it('accepts a healthy bank with a matching config', () => {
    expect(validateBank(healthyBank(), config()).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('reports a sampling cap below the minimum once, not once per trait', () => {
    // The case that confused an admin in production: a full bank (20 items per
    // trait) with "Ítems Likert por rasgo" set to 2 produced five identical
    // errors naming five scales that were perfectly fine.
    const issues = validateBank(healthyBank(20), config({ questionCounts: { ...config().questionCounts, likertPerTrait: 2 } }));
    const errors = issues.filter((issue) => issue.level === 'error');

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('responde 2 preguntas por rasgo');
    expect(errors[0].anchor).toEqual({ kind: 'config', field: 'likertPerTrait' });
    expect(errors[0].fix?.id).toBe('aplicar_minimo_por_rasgo');
    // And it must not point the blame at the traits.
    for (const trait of PSYCHOMETRIC_TRAITS) {
      expect(errors[0].message).not.toContain(trait);
    }
  });

  it('clears that error once its one-click fix is applied', () => {
    const base = config({ questionCounts: { ...config().questionCounts, likertPerTrait: 2 } });
    const issue = validateBank(healthyBank(), base).find((i) => i.fix)!;
    const fixed = applyBankFix(issue.fix!.id, base);

    expect(fixed.questionCounts.likertPerTrait).toBe(base.minItemsPerScale);
    expect(validateBank(healthyBank(), fixed).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('reports a cap below the recommended size once, pointing at the setting', () => {
    // Reported case: a full bank (20 per trait) with the cap at 4 produced five
    // identical suggestions, each linking to a trait whose questions were fine.
    const issues = validateBank(
      healthyBank(20),
      config({ questionCounts: { ...config().questionCounts, likertPerTrait: 4 } })
    );
    const warnings = issues.filter((issue) => issue.level === 'warning');

    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].anchor).toEqual({ kind: 'config', field: 'likertPerTrait' });
    expect(warnings[0].fix?.id).toBe('aplicar_recomendado_por_rasgo');
    // The traits are not at fault, so they must not be named.
    for (const trait of PSYCHOMETRIC_TRAITS) {
      expect(warnings[0].message).not.toContain(trait);
    }
  });

  it('clears that suggestion once the recommended size is applied', () => {
    const base = config({ questionCounts: { ...config().questionCounts, likertPerTrait: 4 } });
    const warning = validateBank(healthyBank(20), base).find((issue) => issue.fix)!;
    const fixed = applyBankFix(warning.fix!.id, base);

    expect(fixed.questionCounts.likertPerTrait).toBe(RECOMMENDED_PER_TRAIT);
    expect(validateBank(healthyBank(20), fixed)).toEqual([]);
  });

  it('blames the trait, not the cap, when the bank is what is short', () => {
    // 5 questions available and no cap: adding questions is the actual remedy.
    const issues = validateBank(
      healthyBank(5),
      config({ questionCounts: { ...config().questionCounts, likertPerTrait: 0 } })
    );
    const warnings = issues.filter((issue) => issue.level === 'warning');

    expect(warnings).toHaveLength(PSYCHOMETRIC_TRAITS.length);
    expect(warnings[0].message).toContain('5 preguntas activas');
    expect(warnings[0].anchor).toMatchObject({ kind: 'section' });
  });

  it('keeps the wording free of statistical jargon', () => {
    const issues = validateBank(
      healthyBank(5),
      config({ questionCounts: { ...config().questionCounts, likertPerTrait: 4 } })
    );
    const text = issues.map((issue) => issue.message).join(' ').toLowerCase();
    for (const term of ['consistencia interna', 'aquiescencia', '.70', 'ítems']) {
      expect(text, `no deberia decir "${term}"`).not.toContain(term);
    }
  });

  it('still blames the trait when the bank itself is short', () => {
    const issues = validateBank(healthyBank(2), config({ questionCounts: { ...config().questionCounts, likertPerTrait: 0 } }));
    const errors = issues.filter((issue) => issue.level === 'error');

    expect(errors).toHaveLength(PSYCHOMETRIC_TRAITS.length);
    expect(errors[0].message).toContain('2 preguntas activas');
    expect(errors[0].anchor).toMatchObject({ kind: 'section' });
  });

  it('reports a trait with no items at all', () => {
    const bank = healthyBank().filter((q) => !(q.type === 'likert' && q.scale === 'integridad'));
    const errors = validateBank(bank, config()).filter((issue) => issue.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('no tiene preguntas activas');
    expect(errors[0].anchor).toEqual({ kind: 'section', section: 'integridad' });
  });

  it('offers to swap inverted cutoffs', () => {
    const broken = config({ bandCutoffs: { lowMax: 80, highMin: 40 } });
    const issue = validateBank(healthyBank(), broken).find(
      (i) => i.fix?.id === 'ordenar_cortes_absolutos'
    )!;
    expect(issue.message).toContain('(80)');
    const fixed = applyBankFix(issue.fix!.id, broken);
    expect(fixed.bandCutoffs).toEqual({ lowMax: 40, highMin: 80 });
    expect(validateBank(healthyBank(), fixed).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('offers to swap inverted percentiles', () => {
    const broken = config({ percentileCutoffs: { lowMaxPercentile: 90, highMinPercentile: 10 } });
    const issue = validateBank(healthyBank(), broken).find((i) => i.fix?.id === 'ordenar_percentiles')!;
    const fixed = applyBankFix(issue.fix!.id, broken);
    expect(fixed.percentileCutoffs).toEqual({ lowMaxPercentile: 10, highMinPercentile: 90 });
  });

  it('anchors item-level problems at the item', () => {
    const bank = healthyBank();
    bank[0] = { ...bank[0], text: '  ' };
    const issue = validateBank(bank, config()).find((i) => i.message.includes('Falta el texto'))!;
    expect(issue.anchor).toEqual({ kind: 'question', questionId: bank[0].id });
    expect(issue.questionId).toBe(bank[0].id);
  });

  it('never produces an issue the admin cannot act on', () => {
    // Every message must say where it is fixed, otherwise it is just noise.
    const broken = config({
      questionCounts: { likertPerTrait: 1, sjt: 0, deseabilidadSocial: 0, infrecuencia: 0, atencion: 1 },
      bandCutoffs: { lowMax: 90, highMin: 10 },
      percentileCutoffs: { lowMaxPercentile: 80, highMinPercentile: 20 },
    });
    const bank = healthyBank(3);
    bank.push({ ...bank[0], id: 'dup', text: '' });

    const issues = validateBank(bank, broken);
    expect(issues.length).toBeGreaterThan(3);
    for (const issue of issues) {
      expect(issue.anchor, issue.message).toBeDefined();
    }
  });
});
