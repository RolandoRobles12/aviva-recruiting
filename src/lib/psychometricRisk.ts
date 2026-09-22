// Risk levels as the recruiter sees them, resolved against the *current* cutoffs.
//
// A stored result keeps the score and the critical items the candidate admitted;
// the level is only an interpretation of those two against the configured
// cutoffs. Resolving it at read time is what makes the "Riesgo moderado/alto
// desde" fields in the bank config actually govern what every screen shows —
// otherwise a result keeps whatever cutoffs were in force the day it was
// submitted, and the panel, the list chip and the config disagree.
//
// Same rule as riskLevelFor in functions/src/psychometricTest/scoring.ts (the
// tests check both agree). Kept free of any Firebase import so it can be tested.

import {
  PSYCHOMETRIC_RISK_SCALES,
  type PsychometricRiskCutoffs,
  type PsychometricRiskLevel,
  type PsychometricRiskResult,
  type PsychometricRiskScale,
} from '../types';

export const DEFAULT_RISK_CUTOFFS: PsychometricRiskCutoffs = { moderateMin: 30, highMin: 50 };

const RANK: Record<PsychometricRiskLevel, number> = { bajo: 0, moderado: 1, alto: 2 };

function maxLevel(a: PsychometricRiskLevel, b: PsychometricRiskLevel): PsychometricRiskLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

export function levelFromScore(score: number, cutoffs: PsychometricRiskCutoffs): PsychometricRiskLevel {
  if (score >= cutoffs.highMin) return 'alto';
  if (score >= cutoffs.moderateMin) return 'moderado';
  return 'bajo';
}

export function levelFromCriticals(count: number): PsychometricRiskLevel {
  return count >= 2 ? 'alto' : count === 1 ? 'moderado' : 'bajo';
}

export interface ResolvedRisk {
  /** Final level: the higher of the two below. */
  level: PsychometricRiskLevel;
  /** What the score alone says; null when there are too few answers to score. */
  scoreLevel: PsychometricRiskLevel | null;
  /** What the admitted behaviours alone say. */
  criticalLevel: PsychometricRiskLevel;
  /** True when the admitted behaviours, not the score, set the final level. */
  raisedByCriticals: boolean;
}

export function resolveRisk(risk: PsychometricRiskResult, cutoffs: PsychometricRiskCutoffs): ResolvedRisk {
  const scoreLevel = risk.hasData ? levelFromScore(risk.normalizedScore, cutoffs) : null;
  const criticalLevel = levelFromCriticals(risk.criticalEndorsed.length);
  const level = maxLevel(scoreLevel ?? 'bajo', criticalLevel);
  return {
    level,
    scoreLevel,
    criticalLevel,
    raisedByCriticals: RANK[criticalLevel] > RANK[scoreLevel ?? 'bajo'],
  };
}

/** A scale that was applied and has either a score or an admitted behaviour. */
export function isMeasured(risk: PsychometricRiskResult | undefined): risk is PsychometricRiskResult {
  return !!risk && risk.itemsApplied > 0 && (risk.hasData || risk.criticalEndorsed.length > 0);
}

/** Highest resolved level across measured scales; null when none was measured. */
export function resolveOverallRisk(
  risks: Partial<Record<PsychometricRiskScale, PsychometricRiskResult>> | undefined,
  cutoffs: PsychometricRiskCutoffs
): PsychometricRiskLevel | null {
  if (!risks) return null;
  let overall: PsychometricRiskLevel | null = null;
  for (const scale of PSYCHOMETRIC_RISK_SCALES) {
    const risk = risks[scale];
    if (!isMeasured(risk)) continue;
    const { level } = resolveRisk(risk, cutoffs);
    overall = overall === null ? level : maxLevel(overall, level);
  }
  return overall;
}

/** Scales at a given resolved level, for "Riesgo alto: violencia y consumo". */
export function scalesAtLevel(
  risks: Partial<Record<PsychometricRiskScale, PsychometricRiskResult>> | undefined,
  level: PsychometricRiskLevel,
  cutoffs: PsychometricRiskCutoffs
): PsychometricRiskScale[] {
  if (!risks) return [];
  return PSYCHOMETRIC_RISK_SCALES.filter((scale) => {
    const risk = risks[scale];
    return isMeasured(risk) && resolveRisk(risk, cutoffs).level === level;
  });
}
