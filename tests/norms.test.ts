import { describe, expect, it } from 'vitest';
import {
  bandFromAbsolute,
  bandFromPercentile,
  distributionFrom,
  emptyNorms,
  normalCdf,
  percentileFor,
  resolveBand,
  withObservation,
} from '../functions/src/psychometricTest/norms';
import {
  NORM_MIN_N_PROVISIONAL,
  NORM_MIN_N_STABLE,
  type PsychometricNorms,
} from '../functions/src/psychometricTest/types';

const OPTIONS = {
  bandCutoffs: { lowMax: 55, highMin: 75 },
  percentileCutoffs: { lowMaxPercentile: 25, highMinPercentile: 75 },
  useLocalNorms: true,
};

/** Builds a running aggregate with a known mean and spread. */
function sampleOf(values: number[]) {
  return values.reduce(
    (acc, value) => ({ n: acc.n + 1, sum: acc.sum + value, sumSq: acc.sumSq + value * value }),
    { n: 0, sum: 0, sumSq: 0 }
  );
}

/** n values centred on `mean`, alternating ±spread so the SD is predictable. */
function spread(mean: number, delta: number, n: number): number[] {
  return Array.from({ length: n }, (_, index) => (index % 2 === 0 ? mean - delta : mean + delta));
}

describe('distributionFrom', () => {
  it('recovers the mean and SD from the running aggregate', () => {
    const dist = distributionFrom(sampleOf([70, 80, 90]));
    expect(dist).not.toBeNull();
    expect(dist!.n).toBe(3);
    expect(dist!.mean).toBeCloseTo(80, 6);
    expect(dist!.sd).toBeCloseTo(10, 6);
  });

  it('returns null below two observations', () => {
    expect(distributionFrom(sampleOf([70]))).toBeNull();
    expect(distributionFrom(undefined)).toBeNull();
  });
});

describe('normalCdf', () => {
  it('is centred and symmetric', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 4);
    expect(normalCdf(1.645)).toBeCloseTo(0.95, 3);
  });
});

describe('percentileFor', () => {
  it('places the mean at the 50th percentile', () => {
    const dist = { n: 100, mean: 70, sd: 10 };
    expect(percentileFor(70, dist)).toBe(50);
    expect(percentileFor(80, dist)).toBe(84);
  });

  it('never claims more precision than the sample supports', () => {
    const dist = { n: 100, mean: 70, sd: 10 };
    expect(percentileFor(200, dist)).toBe(99);
    expect(percentileFor(-50, dist)).toBe(1);
  });
});

describe('band cutoffs', () => {
  it('reads absolute scores against the configured cutoffs', () => {
    expect(bandFromAbsolute(54, OPTIONS.bandCutoffs)).toBe('bajo');
    expect(bandFromAbsolute(55, OPTIONS.bandCutoffs)).toBe('medio');
    expect(bandFromAbsolute(74, OPTIONS.bandCutoffs)).toBe('medio');
    expect(bandFromAbsolute(75, OPTIONS.bandCutoffs)).toBe('alto');
  });

  it('reads percentiles against the percentile cutoffs', () => {
    expect(bandFromPercentile(24, OPTIONS.percentileCutoffs)).toBe('bajo');
    expect(bandFromPercentile(25, OPTIONS.percentileCutoffs)).toBe('medio');
    expect(bandFromPercentile(75, OPTIONS.percentileCutoffs)).toBe('alto');
  });
});

describe('resolveBand', () => {
  it('stays absolute while the local sample is too small', () => {
    const stat = sampleOf(spread(70, 8, NORM_MIN_N_PROVISIONAL - 1));
    const resolved = resolveBand(90, stat, OPTIONS);
    expect(resolved.bandSource).toBe('absoluta');
    expect(resolved.percentile).toBeUndefined();
    expect(resolved.band).toBe('alto');
  });

  it('switches to provisional percentiles once there are enough cases', () => {
    const stat = sampleOf(spread(70, 8, NORM_MIN_N_PROVISIONAL));
    const resolved = resolveBand(70, stat, OPTIONS);
    expect(resolved.bandSource).toBe('normas_provisionales');
    expect(resolved.percentile).toBe(50);
    expect(resolved.band).toBe('medio');
    expect(resolved.normSampleSize).toBe(NORM_MIN_N_PROVISIONAL);
  });

  it('calls the norms stable from the larger threshold up', () => {
    const stat = sampleOf(spread(70, 8, NORM_MIN_N_STABLE));
    expect(resolveBand(70, stat, OPTIONS).bandSource).toBe('normas_locales');
  });

  it('rescues a score that looks high in absolute terms but is average locally', () => {
    // The whole applicant pool sits high, which is exactly what absolute cutoffs
    // on a self-report get wrong: 82 is "alto" absolutely and average locally.
    const stat = sampleOf(spread(82, 6, NORM_MIN_N_STABLE));
    expect(bandFromAbsolute(82, OPTIONS.bandCutoffs)).toBe('alto');
    const resolved = resolveBand(82, stat, OPTIONS);
    expect(resolved.band).toBe('medio');
    expect(resolved.percentile).toBe(50);
  });

  it('falls back to absolute when the sample has no spread', () => {
    const stat = sampleOf(Array.from({ length: NORM_MIN_N_STABLE }, () => 70));
    expect(resolveBand(70, stat, OPTIONS).bandSource).toBe('absoluta');
  });

  it('honours the switch that disables local norms', () => {
    const stat = sampleOf(spread(70, 8, NORM_MIN_N_STABLE));
    const resolved = resolveBand(90, stat, { ...OPTIONS, useLocalNorms: false });
    expect(resolved.bandSource).toBe('absoluta');
  });
});

describe('withObservation', () => {
  it('accumulates n, sum and sum of squares', () => {
    let norms: PsychometricNorms = emptyNorms();
    norms = withObservation(norms, 'responsabilidad', 60);
    norms = withObservation(norms, 'responsabilidad', 80);
    expect(norms.scales.responsabilidad).toEqual({ n: 2, sum: 140, sumSq: 60 * 60 + 80 * 80 });
  });

  it('ignores values that are not finite numbers', () => {
    const norms = withObservation(emptyNorms(), 'composite', Number.NaN);
    expect(norms.scales.composite).toBeUndefined();
  });

  it('does not mutate the object it was given', () => {
    const before = emptyNorms();
    withObservation(before, 'sjt', 50);
    expect(before.scales.sjt).toBeUndefined();
  });
});
