// Data model for the psychometric module. This file is the canonical shape;
// src/types/index.ts mirrors it for the frontend.
//
// Design notes (see docs/psicometricos.md for the full rationale):
//  - Likert items belong to a *scale*. Five of those scales are scored traits;
//    two (deseabilidad_social, infrecuencia) exist only to judge whether the
//    answers can be trusted and never feed the composite score.
//  - 'attention' items are instructed-response checks ("marca 'En desacuerdo'"),
//    the single most reliable careless-responding signal available to us.
//  - Nothing here is hardcoded content: the bank lives in Firestore. The curated
//    starter bank in defaultBank.ts is seeded on demand, not implicitly.

export type PsychometricTrait =
  | 'responsabilidad'
  | 'estabilidad_emocional'
  | 'extraversion'
  | 'amabilidad'
  | 'integridad';

export const PSYCHOMETRIC_TRAITS: PsychometricTrait[] = [
  'responsabilidad',
  'estabilidad_emocional',
  'extraversion',
  'amabilidad',
  'integridad',
];

/** Likert scales that measure response *style*, not the candidate's profile. */
export type PsychometricValidityScale = 'deseabilidad_social' | 'infrecuencia';

export const PSYCHOMETRIC_VALIDITY_SCALES: PsychometricValidityScale[] = [
  'deseabilidad_social',
  'infrecuencia',
];

export type PsychometricLikertScale = PsychometricTrait | PsychometricValidityScale;

/** Scales that appear as a score in the recruiter's report. */
export type PsychometricScoredScale = PsychometricTrait | 'sjt';

export const PSYCHOMETRIC_SCORED_SCALES: PsychometricScoredScale[] = [
  ...PSYCHOMETRIC_TRAITS,
  'sjt',
];

export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;

// ─── Question bank ────────────────────────────────────────────────────────────

interface PsychometricQuestionBase {
  id: string;
  text: string;
  enabled: boolean;
  order: number;
}

export interface PsychometricLikertQuestion extends PsychometricQuestionBase {
  type: 'likert';
  scale: PsychometricLikertScale;
  /**
   * Legacy field from the first version of the bank, when every Likert item was
   * a trait item. Reads are normalized in bankStore; new items only set `scale`.
   */
  trait?: PsychometricTrait;
  /** true when agreeing with the item means a LOW scale score (scored 6 - value) */
  reverseScored: boolean;
}

/** Instructed-response check: the text tells the candidate which option to pick. */
export interface PsychometricAttentionQuestion extends PsychometricQuestionBase {
  type: 'attention';
  /** The Likert value (1-5) the instruction asks for. */
  expectedValue: number;
}

export interface PsychometricSjtOption {
  text: string;
  /** Effectiveness of the response, 0 = least effective. Max is per-question. */
  score: number;
}

export interface PsychometricSjtQuestion extends PsychometricQuestionBase {
  type: 'sjt';
  /** The scenario. */
  text: string;
  options: PsychometricSjtOption[];
  /** Informative label for the recruiter/analyst — not used in scoring. */
  competency?: string;
}

export type PsychometricQuestion =
  | PsychometricLikertQuestion
  | PsychometricAttentionQuestion
  | PsychometricSjtQuestion;

// ─── Configuration ────────────────────────────────────────────────────────────

export type PsychometricScaleWeights = Record<PsychometricScoredScale, number>;

export interface PsychometricBandCutoffs {
  /** normalizedScore < lowMax → "bajo" */
  lowMax: number;
  /** lowMax <= score < highMin → "medio"; score >= highMin → "alto" */
  highMin: number;
}

/** Cutoffs used once local norms exist and scores become percentile-referenced. */
export interface PsychometricPercentileCutoffs {
  lowMaxPercentile: number;
  highMinPercentile: number;
}

export interface PsychometricQuestionCounts {
  /** Likert items per trait per session. 0 = every enabled item. */
  likertPerTrait: number;
  sjt: number;
  deseabilidadSocial: number;
  infrecuencia: number;
  atencion: number;
}

export interface PsychometricTestConfig {
  weights: PsychometricScaleWeights;
  bandCutoffs: PsychometricBandCutoffs;
  percentileCutoffs: PsychometricPercentileCutoffs;
  timeLimitMinutes: number;
  questionCounts: PsychometricQuestionCounts;
  /** A scale below this many answered items is reported as "sin datos", not as 0. */
  minItemsPerScale: number;
  /** When true, bands come from the local norm sample as soon as it is big enough. */
  useLocalNorms: boolean;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export type PsychometricBand = 'bajo' | 'medio' | 'alto';

/**
 * Where the band came from. An absolute band on a "percent of maximum" score is
 * weak for self-report Likert data (applicants cluster in the top third), so we
 * switch to the local sample as soon as there is enough of it.
 */
export type PsychometricNormSource = 'absoluta' | 'normas_provisionales' | 'normas_locales';

export interface PsychometricScaleResult {
  scale: PsychometricScoredScale;
  /** false when fewer than config.minItemsPerScale items were answered. */
  hasData: boolean;
  itemsApplied: number;
  itemsAnswered: number;
  /** Likert: mean 1-5. SJT: mean option score. */
  rawAverage: number;
  /** 0-100, share of the maximum attainable score. */
  normalizedScore: number;
  /** Position in the local norm sample, when available. */
  percentile?: number;
  zScore?: number;
  band: PsychometricBand;
  bandSource: PsychometricNormSource;
}

export type PsychometricValidityFlag =
  | 'respuestas_incompletas'
  | 'control_atencion_fallido'
  | 'patron_repetitivo'
  | 'baja_variacion'
  | 'respuestas_muy_rapidas'
  | 'respuestas_inconsistentes'
  | 'inconsistencia_par_impar'
  | 'escala_infrecuencia_alta'
  | 'posible_deseabilidad_social';

export type PsychometricValidityVerdict = 'confiable' | 'revisar' | 'no_confiable';

export interface PsychometricValidityIndices {
  /** Answered / applied, over the whole test. */
  completionRate: number;
  attentionChecksTotal: number;
  attentionChecksFailed: number;
  /** Longest run of identical consecutive Likert answers, in presentation order. */
  longString: number;
  longStringRatio: number;
  /**
   * Intra-individual response variability: SD of the candidate's own Likert
   * answers. Null when there are too few items to compute it — 0 is a real and
   * very meaningful value (the same option every time), so it cannot double as
   * "not computed".
   */
  irv: number | null;
  /** Even-odd split-half consistency across scales (Spearman-Brown corrected). */
  evenOddConsistency: number | null;
  /** Mean gap, per trait, between positively and reverse-keyed items (0-4). */
  keyingInconsistency: number | null;
  medianResponseMs: number | null;
  /** Share of items answered faster than the item's reading time allows. */
  fastResponseRatio: number;
  infrequencyScore: number | null;
  socialDesirabilityScore: number | null;
}

export interface PsychometricValidity {
  verdict: PsychometricValidityVerdict;
  /** Accumulated severity points behind the verdict — see validity.ts. */
  severity: number;
  flags: PsychometricValidityFlag[];
  indices: PsychometricValidityIndices;
}

export const PSYCHOMETRIC_RESULT_VERSION = 2;

export interface PsychometricResult {
  /** 1 = pre-norms/pre-integridad results; 2 = this shape. */
  version: number;
  scales: Record<PsychometricScoredScale, PsychometricScaleResult>;
  compositeScore: number;
  compositePercentile?: number;
  compositeZScore?: number;
  compositeBand: PsychometricBand;
  compositeBandSource: PsychometricNormSource;
  compositeHasData: boolean;
  validity: PsychometricValidity;
  /** Kept so results saved by this version stay readable by the old UI. */
  validityFlags: PsychometricValidityFlag[];
  /** Size of the norm sample the bands were referenced against (0 = absolute). */
  normSampleSize: number;
  scoredAtIso: string;
}

export interface PsychometricAnswer {
  questionId: string;
  /** likert/attention: 1-5. sjt: index of the option *as displayed*. */
  value: number;
  /** ms between the question appearing and being answered. */
  responseMs?: number;
}

// ─── Local norms ──────────────────────────────────────────────────────────────

export interface PsychometricNormStat {
  n: number;
  sum: number;
  sumSq: number;
}

export type PsychometricNormKey = PsychometricScoredScale | 'composite';

export interface PsychometricNorms {
  scales: Partial<Record<PsychometricNormKey, PsychometricNormStat>>;
  updatedAtIso?: string;
}

/** Below this the sample says nothing; bands stay absolute. */
export const NORM_MIN_N_PROVISIONAL = 30;
/** Local percentile ranks are only reasonably stable from ~100 cases up. */
export const NORM_MIN_N_STABLE = 100;
