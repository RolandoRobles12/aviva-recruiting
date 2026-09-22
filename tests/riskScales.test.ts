// Violence and substance-use risk scales: seed content, sampling, scoring,
// validity and analysis. Kept in one file because the rules only make sense
// together — e.g. critical items are always sampled *because* they are reported
// one by one when admitted.

import { describe, expect, it } from 'vitest';
import { DEFAULT_QUESTION_BANK, DEFAULT_TEST_CONFIG } from '../functions/src/psychometricTest/defaultBank';
import { analyzeBank, type AnalysisSession } from '../functions/src/psychometricTest/itemAnalysis';
import { mergeConfig, normalizeQuestion } from '../functions/src/psychometricTest/normalize';
import { assembleTest, auditBank, sampleBalanced } from '../functions/src/psychometricTest/sampling';
import {
  normObservationsFrom,
  overallRiskOf,
  riskLevelFor,
  scoreSession,
} from '../functions/src/psychometricTest/scoring';
import { computeValidityIndices } from '../functions/src/psychometricTest/validity';
import {
  PSYCHOMETRIC_RISK_SCALES,
  type PsychometricLikertQuestion,
  type PsychometricQuestion,
  type PsychometricRiskScale,
} from '../functions/src/psychometricTest/types';
import { answersForScale, controlAnswers } from '../src/lib/psychometricAnswers';
import type { PsychometricSession } from '../src/types';
import { answerAll, config, fullBank, likert, undefinedPaths } from './helpers';

/**
 * `count` items of one risk scale: the first `criticalCount` are critical and
 * risk keyed, then alternating risk / protective.
 */
function riskScale(scale: PsychometricRiskScale, count: number, criticalCount = 2): PsychometricLikertQuestion[] {
  return Array.from({ length: count }, (_, index) => ({
    ...likert(`${scale}_${index}`, scale, index >= criticalCount && index % 2 === 1, 1000 + index),
    ...(index < criticalCount ? { critical: true } : {}),
  }));
}

function bankWithRisk(): PsychometricQuestion[] {
  return [...fullBank(), ...riskScale('riesgo_violencia', 8), ...riskScale('riesgo_adicciones', 8)];
}

/**
 * Answers every item as a low-risk, trait-favourable candidate would: agree
 * with positive trait items and protective risk items, disagree with the rest.
 */
function lowRiskValue(question: PsychometricLikertQuestion): number {
  const isRisk = (PSYCHOMETRIC_RISK_SCALES as string[]).includes(question.scale);
  if (isRisk) return question.reverseScored ? 5 : 1;
  return question.reverseScored ? 2 : 4;
}

// ─── Seed content ─────────────────────────────────────────────────────────────

describe('the curated risk items', () => {
  for (const scale of PSYCHOMETRIC_RISK_SCALES) {
    const items = DEFAULT_QUESTION_BANK.filter(
      (q): q is PsychometricLikertQuestion => q.type === 'likert' && q.scale === scale
    );

    it(`${scale}: 14 items, half protective, with critical items`, () => {
      expect(items).toHaveLength(14);
      expect(items.filter((q) => q.reverseScored)).toHaveLength(7);
      expect(items.filter((q) => q.critical).length).toBeGreaterThanOrEqual(2);
    });

    it(`${scale}: critical items are risk keyed, so agreeing is admitting`, () => {
      for (const item of items.filter((q) => q.critical)) {
        expect(item.reverseScored, item.text).toBe(false);
      }
    });
  }

  it('never marks a trait item as critical', () => {
    const flagged = DEFAULT_QUESTION_BANK.filter(
      (q) => q.type === 'likert' && q.critical && !(PSYCHOMETRIC_RISK_SCALES as string[]).includes(q.scale)
    );
    expect(flagged).toEqual([]);
  });

  it('with the default config, applies 77 questions including every critical item', () => {
    for (let run = 0; run < 30; run++) {
      const { questions } = assembleTest(DEFAULT_QUESTION_BANK, DEFAULT_TEST_CONFIG);
      expect(questions).toHaveLength(77);
      expect(questions.filter((q) => q.type === 'likert' && q.critical)).toHaveLength(6);
    }
  });

  it('passes the static audit together with the default config', () => {
    const errors = auditBank(DEFAULT_QUESTION_BANK, DEFAULT_TEST_CONFIG).filter((w) => w.level === 'error');
    expect(errors).toEqual([]);
  });
});

// ─── Normalization ────────────────────────────────────────────────────────────

describe('normalizeQuestion · risk items', () => {
  it('keeps a risk item and its critical mark', () => {
    const q = normalizeQuestion(
      { id: 'v1', type: 'likert', scale: 'riesgo_violencia', text: 'x', reverseScored: false, critical: true },
      0
    );
    expect(q).toMatchObject({ scale: 'riesgo_violencia', critical: true });
  });

  it('drops a critical mark on a trait item instead of alerting on it', () => {
    const q = normalizeQuestion(
      { id: 't1', type: 'likert', scale: 'responsabilidad', text: 'x', reverseScored: false, critical: true },
      0
    );
    expect(q).not.toHaveProperty('critical');
  });

  it('fills the risk settings into a config saved before they existed', () => {
    const merged = mergeConfig({
      questionCounts: { likertPerTrait: 6, sjt: 5, deseabilidadSocial: 4, infrecuencia: 3, atencion: 2 },
    } as never);
    expect(merged.riskCutoffs).toEqual(DEFAULT_TEST_CONFIG.riskCutoffs);
    expect(merged.questionCounts.likertPerRisk).toBe(DEFAULT_TEST_CONFIG.questionCounts.likertPerRisk);
    expect(merged.questionCounts.likertPerTrait).toBe(6);
  });
});

// ─── Sampling ─────────────────────────────────────────────────────────────────

describe('sampling · risk scales', () => {
  it('always applies the critical items, whatever the draw', () => {
    const items = riskScale('riesgo_adicciones', 14, 3);
    for (let run = 0; run < 50; run++) {
      const taken = sampleBalanced(items, 6);
      expect(taken.filter((q) => q.critical)).toHaveLength(3);
      expect(taken).toHaveLength(6);
    }
  });

  it('widens a cap too small to fit every critical item rather than drop one', () => {
    const items = riskScale('riesgo_violencia', 10, 4);
    const taken = sampleBalanced(items, 3);
    expect(taken.filter((q) => q.critical)).toHaveLength(4);
  });

  it('applies the configured number per risk scale and mixes them with the traits', () => {
    const { questions } = assembleTest(bankWithRisk(), config({ questionCounts: { ...config().questionCounts, likertPerRisk: 6 } }));
    for (const scale of PSYCHOMETRIC_RISK_SCALES) {
      expect(questions.filter((q) => q.type === 'likert' && q.scale === scale)).toHaveLength(6);
    }
    // Not a block at the end: the first risk item shows up well before the
    // last trait item.
    const firstRisk = questions.findIndex(
      (q) => q.type === 'likert' && (PSYCHOMETRIC_RISK_SCALES as string[]).includes(q.scale)
    );
    const lastTrait = questions.map((q) => q.type === 'likert' && q.scale === 'responsabilidad').lastIndexOf(true);
    expect(firstRisk).toBeLessThan(lastTrait);
  });

  it('keeps working on a bank that has no risk items yet', () => {
    const { questions } = assembleTest(fullBank(), config());
    expect(questions.length).toBeGreaterThan(0);
    const scored = scoreSession({ questions, answers: answerAll(questions), config: config() });
    expect(scored.result.overallRisk).toBeNull();
    for (const scale of PSYCHOMETRIC_RISK_SCALES) {
      expect(scored.result.risks[scale]).toMatchObject({ hasData: false, itemsApplied: 0, level: 'bajo' });
    }
  });
});

// ─── Level rule ───────────────────────────────────────────────────────────────

describe('riskLevelFor', () => {
  const cutoffs = { moderateMin: 30, highMin: 50 };

  it('maps the score through the absolute cutoffs', () => {
    expect(riskLevelFor(10, true, cutoffs)).toEqual({ level: 'bajo', levelReason: 'sin_riesgo' });
    expect(riskLevelFor(29, true, cutoffs).level).toBe('bajo');
    expect(riskLevelFor(30, true, cutoffs)).toEqual({ level: 'moderado', levelReason: 'puntaje' });
    expect(riskLevelFor(50, true, cutoffs)).toEqual({ level: 'alto', levelReason: 'puntaje' });
  });

  it('gives no level above "bajo" to a scale that could not be scored', () => {
    expect(riskLevelFor(0, false, cutoffs).level).toBe('bajo');
  });
});

// ─── Scoring ──────────────────────────────────────────────────────────────────

describe('scoreSession · risk scales', () => {
  const questions = bankWithRisk();

  it('scores a low-risk candidate low on both scales', () => {
    const { result } = scoreSession({
      questions,
      answers: answerAll(questions, { likertValue: lowRiskValue }),
      config: config(),
    });
    for (const scale of PSYCHOMETRIC_RISK_SCALES) {
      expect(result.risks[scale]).toMatchObject({ hasData: true, normalizedScore: 0, level: 'bajo', criticalEndorsed: [] });
    }
    expect(result.overallRisk).toBe('bajo');
  });

  it('reports a high risk when the candidate endorses the risk statements', () => {
    const { result } = scoreSession({
      questions,
      answers: answerAll(questions, {
        likertValue: (q) =>
          q.scale === 'riesgo_violencia' ? (q.reverseScored ? 1 : 5) : lowRiskValue(q),
      }),
      config: config(),
    });
    expect(result.risks.riesgo_violencia.normalizedScore).toBe(100);
    expect(result.risks.riesgo_violencia.level).toBe('alto');
    expect(result.risks.riesgo_violencia.criticalEndorsed).toHaveLength(2);
    expect(result.risks.riesgo_adicciones.level).toBe('bajo');
    expect(result.overallRisk).toBe('alto');
  });

  it('lists admitted behaviours without letting them change the level', () => {
    // Two critical items admitted, everything else low risk: the score stays
    // under the cutoff, so the level is "bajo" — the behaviours are reported
    // apart for the interview.
    const { result } = scoreSession({
      questions,
      answers: answerAll(questions, {
        likertValue: (q) =>
          q.id === 'riesgo_adicciones_0' || q.id === 'riesgo_adicciones_1' ? 4 : lowRiskValue(q),
      }),
      config: config(),
    });
    expect(result.risks.riesgo_adicciones.normalizedScore).toBeLessThan(config().riskCutoffs.moderateMin);
    expect(result.risks.riesgo_adicciones).toMatchObject({
      level: 'bajo',
      levelReason: 'sin_riesgo',
      criticalEndorsed: ['riesgo_adicciones_0', 'riesgo_adicciones_1'],
    });
    expect(result.overallRisk).toBe('bajo');
  });

  it('keeps risk out of the composite score', () => {
    const base = scoreSession({ questions, answers: answerAll(questions, { likertValue: lowRiskValue }), config: config() });
    const risky = scoreSession({
      questions,
      answers: answerAll(questions, {
        likertValue: (q) =>
          (PSYCHOMETRIC_RISK_SCALES as string[]).includes(q.scale) ? (q.reverseScored ? 1 : 5) : lowRiskValue(q),
      }),
      config: config(),
    });
    expect(risky.result.compositeScore).toBe(base.result.compositeScore);
    expect(risky.result.overallRisk).toBe('alto');
  });

  it('feeds the risk scores into the norm sample', () => {
    const { result } = scoreSession({ questions, answers: answerAll(questions, { likertValue: lowRiskValue }), config: config() });
    const keys = normObservationsFrom(result).map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['riesgo_violencia', 'riesgo_adicciones']));
  });

  it('shows a percentile only as context, never changing the level', () => {
    const norms = { scales: { riesgo_violencia: { n: 200, sum: 200 * 10, sumSq: 200 * (10 * 10 + 8 * 8) } } };
    const { result } = scoreSession({
      questions,
      answers: answerAll(questions, { likertValue: lowRiskValue }),
      config: config(),
      norms,
    });
    expect(result.risks.riesgo_violencia.percentile).toBeDefined();
    expect(result.risks.riesgo_violencia.level).toBe('bajo');
  });

  it('produces a result Firestore can store', () => {
    const { result } = scoreSession({ questions, answers: answerAll(questions), config: config() });
    expect(undefinedPaths(result)).toEqual([]);
  });

  it('overallRiskOf ignores scales that were never applied', () => {
    const { result } = scoreSession({ questions: fullBank(), answers: answerAll(fullBank()), config: config() });
    expect(overallRiskOf(result.risks)).toBeNull();
  });
});

// ─── Validity ─────────────────────────────────────────────────────────────────

describe('validity · risk scales', () => {
  it('counts contradictions between risk and protective items', () => {
    // Only risk items applied: agreeing with everything ("me he peleado a
    // golpes" AND "los conflictos se resuelven hablando") is inconsistent.
    const questions = [...riskScale('riesgo_violencia', 8), ...riskScale('riesgo_adicciones', 8)];
    const indices = computeValidityIndices(questions, answerAll(questions, { likertValue: 5 }));
    expect(indices.keyingInconsistency).not.toBeNull();
    expect(indices.keyingInconsistency!).toBeGreaterThan(1.25);
  });
});

// ─── Item analysis ────────────────────────────────────────────────────────────

describe('analyzeBank · risk scales', () => {
  const items = riskScale('riesgo_violencia', 6, 2);
  const sessions: AnalysisSession[] = Array.from({ length: 40 }, (_, index) => ({
    questionIds: items.map((q) => q.id),
    // One candidate in ten admits everything; the rest deny it.
    answers: items.map((q) => ({
      questionId: q.id,
      value: index % 10 === 0 ? (q.reverseScored ? 1 : 5) : q.reverseScored ? 5 : 1,
    })),
    validityVerdict: 'confiable',
  }));
  const analysis = analyzeBank(items, sessions);

  it('does not call a low base rate a floor effect', () => {
    for (const item of analysis.items) {
      expect(item.issues.join(' ')).not.toContain('Efecto piso');
      expect(item.issues.join(' ')).not.toContain('Casi todos responden lo mismo');
    }
  });

  it('reports how many candidates admit each critical behaviour', () => {
    const critical = analysis.items.filter((item) => item.critical);
    expect(critical).toHaveLength(2);
    for (const item of critical) expect(item.endorsementRate).toBe(0.1);
  });
});

// ─── Recruiter's answer detail ────────────────────────────────────────────────

describe('answer detail · risk scales', () => {
  const questions = [likert('v1', 'riesgo_violencia'), likert('d1', 'deseabilidad_social')] as never[];
  const session = {
    id: 's',
    candidateName: 'x',
    candidateEmail: 'x',
    token: 't',
    status: 'completed',
    appliedQuestions: questions,
    answers: [
      { questionId: 'v1', value: 5 },
      { questionId: 'd1', value: 1 },
    ],
  } as unknown as PsychometricSession;

  it('reads agreeing with a risk statement as unfavourable', () => {
    const [item] = answersForScale(session, [], 'riesgo_violencia');
    expect(item.tone).toBe('desfavorable');
  });

  it('keeps risk items out of the response-quality controls', () => {
    expect(controlAnswers(session, []).map((item) => item.question.id)).toEqual(['d1']);
  });
});
