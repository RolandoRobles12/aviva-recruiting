import { describe, expect, it } from 'vitest';
import { riskLevelFor } from '../functions/src/psychometricTest/scoring';
import { resolveOverallRisk, resolveRiskLevel, scalesAtLevel } from '../src/lib/psychometricRisk';
import type { PsychometricRiskResult, PsychometricRiskScale } from '../src/types';

function risk(
  scale: PsychometricRiskScale,
  normalizedScore: number,
  critical = 0,
  hasData = true
): PsychometricRiskResult {
  return {
    scale,
    hasData,
    itemsApplied: 10,
    itemsAnswered: hasData ? 10 : 2,
    rawAverage: 1 + (normalizedScore / 100) * 4,
    normalizedScore,
    // Stored level deliberately wrong (as on results scored while admitted
    // behaviours still raised it): the resolver must not rely on it.
    level: 'alto',
    criticalEndorsed: Array.from({ length: critical }, (_, i) => `${scale}_${i}`),
    levelReason: 'reactivos_criticos',
  };
}

describe('resolveRiskLevel', () => {
  it('agrees with the server rule for every score and cutoff pair', () => {
    for (const cutoffs of [
      { moderateMin: 30, highMin: 50 },
      { moderateMin: 40, highMin: 60 },
    ]) {
      for (let score = 0; score <= 100; score += 5) {
        expect(resolveRiskLevel(risk('riesgo_adicciones', score), cutoffs)).toBe(
          riskLevelFor(score, true, cutoffs).level
        );
      }
    }
  });

  it('ignores admitted behaviours: the level comes from the score only', () => {
    // The reported case: score 30 under cutoffs 40/60, two behaviours admitted.
    expect(resolveRiskLevel(risk('riesgo_adicciones', 30, 2), { moderateMin: 40, highMin: 60 })).toBe('bajo');
  });

  it('follows the configured cutoffs, not the level stored at submission', () => {
    const r = risk('riesgo_violencia', 45);
    expect(resolveRiskLevel(r, { moderateMin: 30, highMin: 40 })).toBe('alto');
    expect(resolveRiskLevel(r, { moderateMin: 50, highMin: 70 })).toBe('bajo');
  });

  it('has no level for a scale without a score, admitted behaviours or not', () => {
    expect(resolveRiskLevel(risk('riesgo_violencia', 0, 2, false), { moderateMin: 30, highMin: 50 })).toBeNull();
  });
});

describe('resolveOverallRisk', () => {
  const cutoffs = { moderateMin: 40, highMin: 60 };

  it('takes the highest scored level', () => {
    const risks = { riesgo_violencia: risk('riesgo_violencia', 45), riesgo_adicciones: risk('riesgo_adicciones', 30, 2) };
    expect(resolveOverallRisk(risks, cutoffs)).toBe('moderado');
    expect(scalesAtLevel(risks, 'moderado', cutoffs)).toEqual(['riesgo_violencia']);
  });

  it('is null when no scale was scored', () => {
    const risks = {
      riesgo_violencia: { ...risk('riesgo_violencia', 0), itemsApplied: 0, hasData: false },
      riesgo_adicciones: risk('riesgo_adicciones', 0, 2, false),
    };
    expect(resolveOverallRisk(risks, cutoffs)).toBeNull();
    expect(resolveOverallRisk(undefined, cutoffs)).toBeNull();
  });
});
