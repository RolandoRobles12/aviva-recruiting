// Reading results saved by either version of the scorer.
//
// Sessions completed before the redesign stored a flat { traits, sjt } object
// with four traits, absolute bands and two possible validity flags. Rather than
// migrating that data (the old scores were computed by a different instrument
// and rescoring them would be fiction), the UI normalizes on read and labels
// anything with version 1 as coming from the earlier version of the test.

import {
  PSYCHOMETRIC_SCORED_SCALES,
  type PsychometricResult,
  type PsychometricScaleResult,
  type PsychometricScoredScale,
  type PsychometricValidityFlag,
} from '../types';

/** The shape written before result.version existed. */
interface LegacyResult {
  traits?: Record<string, { rawAverage?: number; normalizedScore?: number; band?: string } | undefined>;
  sjt?: { rawAverage?: number; normalizedScore?: number; band?: string };
  compositeScore?: number;
  compositeBand?: string;
  validityFlags?: string[];
}

const VALID_BANDS = new Set(['bajo', 'medio', 'alto']);
const KNOWN_FLAGS = new Set<string>([
  'respuestas_incompletas',
  'control_atencion_fallido',
  'patron_repetitivo',
  'baja_variacion',
  'respuestas_muy_rapidas',
  'respuestas_inconsistentes',
  'inconsistencia_par_impar',
  'escala_infrecuencia_alta',
  'posible_deseabilidad_social',
]);

function bandOf(value: unknown): 'bajo' | 'medio' | 'alto' {
  return VALID_BANDS.has(value as string) ? (value as 'bajo' | 'medio' | 'alto') : 'medio';
}

function emptyScale(scale: PsychometricScoredScale): PsychometricScaleResult {
  return {
    scale,
    hasData: false,
    itemsApplied: 0,
    itemsAnswered: 0,
    rawAverage: 0,
    normalizedScore: 0,
    band: 'medio',
    bandSource: 'absoluta',
  };
}

export function isLegacyResult(result: PsychometricResult | undefined): boolean {
  return !!result && (result.version ?? 1) < 2;
}

/**
 * Returns a v2-shaped result whatever the stored version. Scales absent from a
 * legacy result (integridad, always) come back with hasData false, which the UI
 * renders as "no evaluado" instead of inventing a score.
 */
export function adaptPsychometricResult(raw: PsychometricResult | undefined): PsychometricResult | null {
  if (!raw) return null;
  if ((raw.version ?? 1) >= 2 && raw.scales) return raw;

  const legacy = raw as unknown as LegacyResult;
  const scales = {} as Record<PsychometricScoredScale, PsychometricScaleResult>;

  for (const scale of PSYCHOMETRIC_SCORED_SCALES) {
    const source = scale === 'sjt' ? legacy.sjt : legacy.traits?.[scale];
    const normalizedScore = typeof source?.normalizedScore === 'number' ? source.normalizedScore : null;
    if (normalizedScore === null) {
      scales[scale] = emptyScale(scale);
      continue;
    }
    scales[scale] = {
      scale,
      hasData: true,
      itemsApplied: 0,
      itemsAnswered: 0,
      rawAverage: typeof source?.rawAverage === 'number' ? source.rawAverage : 0,
      normalizedScore,
      band: bandOf(source?.band),
      bandSource: 'absoluta',
    };
  }

  const flags = (legacy.validityFlags ?? []).filter((flag): flag is PsychometricValidityFlag =>
    KNOWN_FLAGS.has(flag)
  );

  return {
    version: 1,
    scales,
    compositeScore: typeof legacy.compositeScore === 'number' ? legacy.compositeScore : 0,
    compositeBand: bandOf(legacy.compositeBand),
    compositeBandSource: 'absoluta',
    compositeHasData: typeof legacy.compositeScore === 'number',
    validity: {
      // The old scorer had no verdict; any flag it raised meant "review".
      verdict: flags.length > 0 ? 'revisar' : 'confiable',
      severity: flags.length * 3,
      flags,
      indices: {
        completionRate: 1,
        attentionChecksTotal: 0,
        attentionChecksFailed: 0,
        longString: 0,
        longStringRatio: 0,
        irv: null,
        evenOddConsistency: null,
        keyingInconsistency: null,
        medianResponseMs: null,
        fastResponseRatio: 0,
        infrequencyScore: null,
        socialDesirabilityScore: null,
      },
    },
    validityFlags: flags,
    normSampleSize: 0,
  };
}

/** Scales without a score, for the "no evaluado" note in the UI. */
export function missingScales(result: PsychometricResult): PsychometricScoredScale[] {
  return PSYCHOMETRIC_SCORED_SCALES.filter((scale) => !result.scales[scale]?.hasData);
}
