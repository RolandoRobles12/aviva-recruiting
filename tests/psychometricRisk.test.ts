import { describe, expect, it } from 'vitest';
import { riskLevelFor } from '../functions/src/psychometricTest/scoring';
import { resolveOverallRisk, resolveRisk, scalesAtLevel } from '../src/lib/psychometricRisk';
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
    // Stored level deliberately wrong: the resolver must not rely on it.
    level: 'bajo',
    criticalEndorsed: Array.from({ length: critical }, (_, i) => `${scale}_${i}`),
    levelReason: 'sin_riesgo',
  };
}

describe('resolveRisk', () => {
  it('agrees with the server rule for every score, critical count and cutoff pair', () => {
    for (const cutoffs of [
      { moderateMin: 30, highMin: 50 },
      { moderateMin: 40, highMin: 60 },
    ]) {
      for (let score = 0; score <= 100; score += 5) {
        for (const critical of [0, 1, 2, 3]) {
          for (const hasData of [true, false]) {
            const server = riskLevelFor(score, hasData, critical, cutoffs).level;
            expect(resolveRisk(risk('riesgo_adicciones', score, critical, hasData), cutoffs).level).toBe(server);
          }
        }
      }
    }
  });

  it('explains a level raised by admitted behaviours rather than by the score', () => {
    // The reported case: score 30 under cutoffs 40/60, two behaviours admitted.
    const resolved = resolveRisk(risk('riesgo_adicciones', 30, 2), { moderateMin: 40, highMin: 60 });
    expect(resolved).toEqual({
      level: 'alto',
      scoreLevel: 'bajo',
      criticalLevel: 'alto',
      raisedByCriticals: true,
    });
  });

  it('follows the configured cutoffs, not the level stored at submission', () => {
    const r = risk('riesgo_violencia', 45);
    expect(resolveRisk(r, { moderateMin: 30, highMin: 40 }).level).toBe('alto');
    expect(resolveRisk(r, { moderateMin: 50, highMin: 70 }).level).toBe('bajo');
  });
});

describe('resolveOverallRisk', () => {
  const cutoffs = { moderateMin: 40, highMin: 60 };

  it('takes the highest measured level', () => {
    const risks = { riesgo_violencia: risk('riesgo_violencia', 13), riesgo_adicciones: risk('riesgo_adicciones', 30, 2) };
    expect(resolveOverallRisk(risks, cutoffs)).toBe('alto');
    expect(scalesAtLevel(risks, 'alto', cutoffs)).toEqual(['riesgo_adicciones']);
  });

  it('ignores scales that were not applied or have nothing to go on', () => {
    const risks = {
      riesgo_violencia: { ...risk('riesgo_violencia', 0), itemsApplied: 0, hasData: false },
      riesgo_adicciones: risk('riesgo_adicciones', 0, 0, false),
    };
    expect(resolveOverallRisk(risks, cutoffs)).toBeNull();
    expect(resolveOverallRisk(undefined, cutoffs)).toBeNull();
  });
});
