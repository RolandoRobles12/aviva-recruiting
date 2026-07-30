// Norm-referenced scoring.
//
// Why this exists: a Likert self-report scored as "percent of the maximum"
// produces a compressed, right-skewed distribution — real applicants answering
// honestly land between roughly 65 and 95 on Conscientiousness, so an absolute
// cutoff like "bajo < 40" essentially never fires and "alto >= 70" fires for
// almost everyone. The band is only informative once a score is compared with
// the scores of other candidates for the same kind of role.
//
// So we accumulate a local norm sample (running n / sum / sum of squares per
// scale, from reliable sessions only) and, once it is big enough, report the
// candidate's percentile within it. Below that threshold we keep the absolute
// band and label it as such, so nobody reads a provisional number as a norm.

import {
  NORM_MIN_N_PROVISIONAL,
  NORM_MIN_N_STABLE,
  type PsychometricBand,
  type PsychometricBandCutoffs,
  type PsychometricNormKey,
  type PsychometricNormStat,
  type PsychometricNorms,
  type PsychometricNormSource,
  type PsychometricPercentileCutoffs,
} from './types';

/** An SD below this means the sample carries no usable spread. */
const MIN_USABLE_SD = 1e-6;

export interface NormDistribution {
  n: number;
  mean: number;
  sd: number;
}

/** Sample mean and (sample, n-1) SD from the running aggregate. */
export function distributionFrom(stat: PsychometricNormStat | undefined): NormDistribution | null {
  if (!stat || stat.n < 2) return null;
  const mean = stat.sum / stat.n;
  const variance = (stat.sumSq - stat.n * mean * mean) / (stat.n - 1);
  if (!Number.isFinite(variance) || variance < 0) return null;
  return { n: stat.n, mean, sd: Math.sqrt(variance) };
}

/** Abramowitz & Stegun 7.1.26 — plenty of precision for a percentile label. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Percentile of `score` within the norm sample, clamped to 1-99: with a few
 * hundred cases we cannot honestly distinguish the 99th from the 99.9th.
 */
export function percentileFor(score: number, dist: NormDistribution): number {
  const z = (score - dist.mean) / dist.sd;
  return Math.min(99, Math.max(1, Math.round(normalCdf(z) * 100)));
}

export function bandFromAbsolute(score: number, cutoffs: PsychometricBandCutoffs): PsychometricBand {
  if (score < cutoffs.lowMax) return 'bajo';
  if (score < cutoffs.highMin) return 'medio';
  return 'alto';
}

export function bandFromPercentile(
  percentile: number,
  cutoffs: PsychometricPercentileCutoffs
): PsychometricBand {
  if (percentile < cutoffs.lowMaxPercentile) return 'bajo';
  if (percentile < cutoffs.highMinPercentile) return 'medio';
  return 'alto';
}

export interface ResolvedBand {
  band: PsychometricBand;
  bandSource: PsychometricNormSource;
  percentile?: number;
  zScore?: number;
  normSampleSize: number;
}

/**
 * Picks the band for one score: percentile-referenced when the local sample
 * supports it, absolute otherwise. `bandSource` always says which one was used.
 */
export function resolveBand(
  normalizedScore: number,
  stat: PsychometricNormStat | undefined,
  options: {
    bandCutoffs: PsychometricBandCutoffs;
    percentileCutoffs: PsychometricPercentileCutoffs;
    useLocalNorms: boolean;
  }
): ResolvedBand {
  const dist = options.useLocalNorms ? distributionFrom(stat) : null;

  if (!dist || dist.n < NORM_MIN_N_PROVISIONAL || dist.sd < MIN_USABLE_SD) {
    return {
      band: bandFromAbsolute(normalizedScore, options.bandCutoffs),
      bandSource: 'absoluta',
      normSampleSize: dist?.n ?? 0,
    };
  }

  const percentile = percentileFor(normalizedScore, dist);
  return {
    band: bandFromPercentile(percentile, options.percentileCutoffs),
    bandSource: dist.n >= NORM_MIN_N_STABLE ? 'normas_locales' : 'normas_provisionales',
    percentile,
    zScore: Math.round(((normalizedScore - dist.mean) / dist.sd) * 100) / 100,
    normSampleSize: dist.n,
  };
}

export function emptyNorms(): PsychometricNorms {
  return { scales: {} };
}

/**
 * Folds one observation into the running aggregate. Returns a new object — the
 * caller writes it inside a transaction so concurrent submissions don't race.
 */
export function withObservation(
  norms: PsychometricNorms,
  key: PsychometricNormKey,
  value: number
): PsychometricNorms {
  if (!Number.isFinite(value)) return norms;
  const prev = norms.scales[key] ?? { n: 0, sum: 0, sumSq: 0 };
  return {
    ...norms,
    scales: {
      ...norms.scales,
      [key]: { n: prev.n + 1, sum: prev.sum + value, sumSq: prev.sumSq + value * value },
    },
  };
}
