import { describe, expect, it } from 'vitest';
import { mergeConfig, normalizeBank, normalizeQuestion } from '../functions/src/psychometricTest/normalize';
import {
  DEFAULT_QUESTION_BANK,
  DEFAULT_TEST_CONFIG,
} from '../functions/src/psychometricTest/defaultBank';
import {
  PSYCHOMETRIC_TRAITS,
  type PsychometricLikertQuestion,
} from '../functions/src/psychometricTest/types';
import { undefinedPaths } from './helpers';

describe('normalizeQuestion', () => {
  it('migrates a legacy Likert item that only has `trait`', () => {
    const question = normalizeQuestion(
      { id: 'old_1', type: 'likert', text: 'Llego puntual', trait: 'responsabilidad', reverseScored: false },
      0
    );
    expect(question).toMatchObject({ type: 'likert', scale: 'responsabilidad', enabled: true, order: 0 });
  });

  it('treats an item with no type as Likert, the way the first version stored them', () => {
    const question = normalizeQuestion({ id: 'old_2', text: 'Cumplo lo que prometo', trait: 'amabilidad' }, 3);
    expect(question).toMatchObject({ type: 'likert', scale: 'amabilidad', order: 3 });
  });

  it('drops a Likert item whose scale cannot be recognised', () => {
    expect(normalizeQuestion({ id: 'x', type: 'likert', text: 'Algo', trait: 'inventado' }, 0)).toBeNull();
    expect(normalizeQuestion({ id: 'x', type: 'likert', text: 'Algo' }, 0)).toBeNull();
  });

  it('drops items with no id or no text', () => {
    expect(normalizeQuestion({ type: 'likert', text: 'Sin id', trait: 'integridad' }, 0)).toBeNull();
    expect(normalizeQuestion({ id: 'y', type: 'likert', text: '   ', trait: 'integridad' }, 0)).toBeNull();
  });

  it('keeps only SJT options that carry both text and a score', () => {
    const question = normalizeQuestion(
      {
        id: 's',
        type: 'sjt',
        text: 'Escenario',
        options: [
          { text: 'Buena', score: 3 },
          { text: '', score: 2 },
          { text: 'Sin puntaje' },
          { text: 'Mala', score: 0 },
        ],
      },
      0
    );
    expect(question?.type).toBe('sjt');
    expect(question && question.type === 'sjt' ? question.options : []).toEqual([
      { text: 'Buena', score: 3 },
      { text: 'Mala', score: 0 },
    ]);
  });

  it('drops an SJT scenario left with fewer than two usable options', () => {
    expect(
      normalizeQuestion({ id: 's', type: 'sjt', text: 'Escenario', options: [{ text: 'Sola', score: 1 }] }, 0)
    ).toBeNull();
  });

  it('drops an attention check whose expected answer is off the scale', () => {
    expect(normalizeQuestion({ id: 'a', type: 'attention', text: 'Marca X', expectedValue: 9 }, 0)).toBeNull();
    expect(normalizeQuestion({ id: 'a', type: 'attention', text: 'Marca X' }, 0)).toBeNull();
    expect(
      normalizeQuestion({ id: 'a', type: 'attention', text: 'Marca X', expectedValue: 2 }, 0)
    ).toMatchObject({ type: 'attention', expectedValue: 2 });
  });

  it('defaults enabled to true but respects an explicit false', () => {
    const base = { id: 'z', type: 'likert', text: 'Texto', trait: 'extraversion' };
    expect(normalizeQuestion(base, 0)?.enabled).toBe(true);
    expect(normalizeQuestion({ ...base, enabled: false }, 0)?.enabled).toBe(false);
  });
});

describe('normalizeBank', () => {
  it('drops duplicates and sorts by order', () => {
    const bank = normalizeBank([
      { id: 'b', type: 'likert', text: 'Segundo', trait: 'integridad', order: 5 },
      { id: 'a', type: 'likert', text: 'Primero', trait: 'integridad', order: 1 },
      { id: 'a', type: 'likert', text: 'Duplicado', trait: 'integridad', order: 2 },
      'basura',
      null,
    ]);
    expect(bank.map((question) => question.id)).toEqual(['a', 'b']);
    expect(bank[0].text).toBe('Primero');
  });

  it('returns an empty bank for anything that is not an array', () => {
    expect(normalizeBank(undefined)).toEqual([]);
    expect(normalizeBank({ questions: [] })).toEqual([]);
  });
});

describe('mergeConfig', () => {
  it('fills in fields added after a config was saved', () => {
    // A config written by the first version of the admin UI.
    const legacy = {
      weights: {
        responsabilidad: 0.2,
        estabilidad_emocional: 0.2,
        extraversion: 0.2,
        amabilidad: 0.2,
        sjt: 0.2,
      },
      bandCutoffs: { lowMax: 40, highMin: 70 },
      timeLimitMinutes: 30,
      questionCounts: { likertPerTrait: 0, sjt: 0 },
    } as never;

    const merged = mergeConfig(legacy);
    expect(merged.bandCutoffs).toEqual({ lowMax: 40, highMin: 70 });
    expect(merged.timeLimitMinutes).toBe(30);
    expect(merged.questionCounts.likertPerTrait).toBe(0);
    // Newly added fields come from the defaults instead of arriving undefined.
    expect(merged.weights.integridad).toBe(DEFAULT_TEST_CONFIG.weights.integridad);
    expect(merged.percentileCutoffs).toEqual(DEFAULT_TEST_CONFIG.percentileCutoffs);
    expect(merged.questionCounts.atencion).toBe(DEFAULT_TEST_CONFIG.questionCounts.atencion);
    expect(merged.minItemsPerScale).toBe(DEFAULT_TEST_CONFIG.minItemsPerScale);
    expect(merged.useLocalNorms).toBe(DEFAULT_TEST_CONFIG.useLocalNorms);
  });

  it('returns the defaults when nothing is stored', () => {
    expect(mergeConfig(undefined)).toEqual(DEFAULT_TEST_CONFIG);
  });
});

describe('the curated starter bank', () => {
  it('survives normalization intact — no item is silently unusable', () => {
    expect(normalizeBank(DEFAULT_QUESTION_BANK)).toHaveLength(DEFAULT_QUESTION_BANK.length);
  });

  it('normalizes into objects that can be written to Firestore', () => {
    // Normalized questions are snapshotted into the session document, so an
    // optional field left as undefined would fail the write that starts a test.
    expect(undefinedPaths(normalizeBank(DEFAULT_QUESTION_BANK))).toEqual([]);
    expect(
      undefinedPaths(
        normalizeBank([{ id: 's', type: 'sjt', text: 'Escenario sin competencia', options: [
          { text: 'A', score: 1 },
          { text: 'B', score: 0 },
        ] }])
      )
    ).toEqual([]);
  });

  it('has unique ids and a contiguous order', () => {
    const ids = new Set(DEFAULT_QUESTION_BANK.map((question) => question.id));
    expect(ids.size).toBe(DEFAULT_QUESTION_BANK.length);
    DEFAULT_QUESTION_BANK.forEach((question, index) => expect(question.order).toBe(index));
  });

  it('covers every trait with enough items, half of them reverse worded', () => {
    for (const trait of PSYCHOMETRIC_TRAITS) {
      const items = DEFAULT_QUESTION_BANK.filter(
        (q): q is PsychometricLikertQuestion => q.type === 'likert' && q.scale === trait
      );
      expect(items.length, trait).toBeGreaterThanOrEqual(14);
      const reversed = items.filter((question) => question.reverseScored).length;
      expect(reversed, trait).toBe(items.length / 2);
    }
  });

  it('ships the response-style scales and the attention checks the scorer expects', () => {
    const countScale = (scale: string) =>
      DEFAULT_QUESTION_BANK.filter((q) => q.type === 'likert' && q.scale === scale).length;
    expect(countScale('deseabilidad_social')).toBeGreaterThanOrEqual(
      DEFAULT_TEST_CONFIG.questionCounts.deseabilidadSocial
    );
    expect(countScale('infrecuencia')).toBeGreaterThanOrEqual(
      DEFAULT_TEST_CONFIG.questionCounts.infrecuencia
    );
    expect(DEFAULT_QUESTION_BANK.filter((q) => q.type === 'attention').length).toBeGreaterThanOrEqual(
      DEFAULT_TEST_CONFIG.questionCounts.atencion
    );
    expect(DEFAULT_QUESTION_BANK.filter((q) => q.type === 'sjt').length).toBeGreaterThanOrEqual(
      DEFAULT_TEST_CONFIG.questionCounts.sjt
    );
  });

  it('gives every scenario a distinct best answer', () => {
    for (const question of DEFAULT_QUESTION_BANK) {
      if (question.type !== 'sjt') continue;
      const scores = question.options.map((option) => option.score);
      expect(new Set(scores).size, question.id).toBe(scores.length);
      expect(Math.max(...scores), question.id).toBeGreaterThan(0);
    }
  });

  it('never keys the response-style scales in reverse', () => {
    // Their score is read as "how much did they agree", so a reverse item would
    // silently invert the flag.
    const styleItems = DEFAULT_QUESTION_BANK.filter(
      (q): q is PsychometricLikertQuestion =>
        q.type === 'likert' && (q.scale === 'deseabilidad_social' || q.scale === 'infrecuencia')
    );
    expect(styleItems.every((question) => !question.reverseScored)).toBe(true);
  });
});
