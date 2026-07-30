import { describe, expect, it } from 'vitest';
import {
  adaptPsychometricResult,
  isLegacyResult,
  missingScales,
} from '../src/lib/psychometricResult';
import type { PsychometricResult } from '../src/types';

/** A result exactly as the first version of the scorer wrote it. */
const LEGACY = {
  traits: {
    responsabilidad: { rawAverage: 4.2, normalizedScore: 80, band: 'alto' },
    estabilidad_emocional: { rawAverage: 3.1, normalizedScore: 53, band: 'medio' },
    extraversion: { rawAverage: 2.0, normalizedScore: 25, band: 'bajo' },
    amabilidad: { rawAverage: 3.8, normalizedScore: 70, band: 'alto' },
  },
  sjt: { rawAverage: 1.5, normalizedScore: 75, band: 'alto' },
  compositeScore: 61,
  compositeBand: 'medio',
  validityFlags: ['baja_variacion'],
} as unknown as PsychometricResult;

describe('adaptPsychometricResult', () => {
  it('returns null when there is no result', () => {
    expect(adaptPsychometricResult(undefined)).toBeNull();
  });

  it('reshapes a legacy result without inventing the scales it never had', () => {
    const result = adaptPsychometricResult(LEGACY)!;
    expect(result.version).toBe(1);
    expect(isLegacyResult(result)).toBe(true);

    expect(result.scales.responsabilidad).toMatchObject({
      hasData: true,
      normalizedScore: 80,
      band: 'alto',
      bandSource: 'absoluta',
    });
    expect(result.scales.sjt.normalizedScore).toBe(75);

    // integridad did not exist back then: it must read as "no evaluado", not 0.
    expect(result.scales.integridad.hasData).toBe(false);
    expect(missingScales(result)).toEqual(['integridad']);
  });

  it('maps the old flags onto the verdict the old scorer implied', () => {
    const result = adaptPsychometricResult(LEGACY)!;
    expect(result.validity.flags).toEqual(['baja_variacion']);
    expect(result.validity.verdict).toBe('revisar');
    expect(result.validity.indices.irv).toBeNull();
    expect(result.normSampleSize).toBe(0);
  });

  it('calls a flagless legacy result reliable', () => {
    const clean = adaptPsychometricResult({ ...LEGACY, validityFlags: [] } as PsychometricResult)!;
    expect(clean.validity.verdict).toBe('confiable');
  });

  it('drops flag names it does not recognise', () => {
    const odd = adaptPsychometricResult({
      ...LEGACY,
      validityFlags: ['baja_variacion', 'algo_que_ya_no_existe'],
    } as unknown as PsychometricResult)!;
    expect(odd.validity.flags).toEqual(['baja_variacion']);
  });

  it('passes a current result straight through', () => {
    const current = {
      version: 2,
      scales: {
        responsabilidad: {
          scale: 'responsabilidad',
          hasData: true,
          itemsApplied: 8,
          itemsAnswered: 8,
          rawAverage: 4,
          normalizedScore: 75,
          percentile: 60,
          band: 'medio',
          bandSource: 'normas_locales',
        },
      },
      compositeScore: 70,
      compositeBand: 'medio',
      compositeBandSource: 'normas_locales',
      compositeHasData: true,
      validity: { verdict: 'confiable', severity: 0, flags: [], indices: {} },
      validityFlags: [],
      normSampleSize: 140,
    } as unknown as PsychometricResult;

    expect(adaptPsychometricResult(current)).toBe(current);
    expect(isLegacyResult(current)).toBe(false);
  });

  it('survives a legacy result with pieces missing', () => {
    const partial = adaptPsychometricResult({ traits: {} } as unknown as PsychometricResult)!;
    expect(partial.compositeHasData).toBe(false);
    expect(partial.scales.sjt.hasData).toBe(false);
    expect(missingScales(partial)).toHaveLength(6);
  });
});
