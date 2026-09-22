// Risk levels as the recruiter sees them, resolved against the *current* cutoffs.
//
// A stored result keeps the score; the level is only its interpretation against
// the configured cutoffs. Resolving it at read time is what makes the "Riesgo
// moderado/alto desde" fields in the bank config actually govern what every
// screen shows — otherwise a result keeps whatever cutoffs were in force the day
// it was submitted, and the panel, the list chip and the config disagree.
//
// The level is score-only. Admitted critical behaviours are shown next to it for
// follow-up, but never move it: whoever reads "riesgo bajo" has to be able to
// check it against the score and the cutoffs and get the same answer. This also
// re-reads results stored while admitted behaviours still raised the level.
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

export function levelFromScore(score: number, cutoffs: PsychometricRiskCutoffs): PsychometricRiskLevel {
  if (score >= cutoffs.highMin) return 'alto';
  if (score >= cutoffs.moderateMin) return 'moderado';
  return 'bajo';
}

/** A scale that was applied and answered enough to have a score. */
export function isScored(risk: PsychometricRiskResult | undefined): risk is PsychometricRiskResult {
  return !!risk && risk.itemsApplied > 0 && risk.hasData;
}

/** Level of one scale under the given cutoffs; null when it has no score. */
export function resolveRiskLevel(
  risk: PsychometricRiskResult | undefined,
  cutoffs: PsychometricRiskCutoffs
): PsychometricRiskLevel | null {
  return isScored(risk) ? levelFromScore(risk.normalizedScore, cutoffs) : null;
}

/** Highest level across scored scales; null when none was scored. */
export function resolveOverallRisk(
  risks: Partial<Record<PsychometricRiskScale, PsychometricRiskResult>> | undefined,
  cutoffs: PsychometricRiskCutoffs
): PsychometricRiskLevel | null {
  if (!risks) return null;
  let overall: PsychometricRiskLevel | null = null;
  for (const scale of PSYCHOMETRIC_RISK_SCALES) {
    const level = resolveRiskLevel(risks[scale], cutoffs);
    if (level === null) continue;
    if (overall === null || RANK[level] > RANK[overall]) overall = level;
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
  return PSYCHOMETRIC_RISK_SCALES.filter((scale) => resolveRiskLevel(risks[scale], cutoffs) === level);
}
