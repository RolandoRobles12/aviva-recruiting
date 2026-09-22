// Data model for the psychometric module. This file is the canonical shape;
// src/types/index.ts mirrors it for the frontend.
//
// Design notes (see docs/psicometricos.md for the full rationale):
//  - Likert items belong to a *scale*. Five of those scales are scored traits;
//    two (deseabilidad_social, infrecuencia) exist only to judge whether the
//    answers can be trusted and never feed the composite score.
//  - Two more Likert scales measure *risk*, not fit: riesgo_violencia and
//    riesgo_adicciones. On them a high score is the unwanted outcome, so they are
//    reported as alerts next to the profile and never averaged into the
//    composite (a candidate cannot "compensate" a violence risk by being very
//    extraverted).
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

/**
 * Risk scales: attitudes toward, and admissions of, work-relevant counterproductive
 * behaviour. Higher = more risk. Reported as alerts, never in the composite.
 */
export type PsychometricRiskScale = 'riesgo_violencia' | 'riesgo_adicciones';

export const PSYCHOMETRIC_RISK_SCALES: PsychometricRiskScale[] = ['riesgo_violencia', 'riesgo_adicciones'];

export function isRiskScale(scale: string): scale is PsychometricRiskScale {
  return (PSYCHOMETRIC_RISK_SCALES as string[]).includes(scale);
}

export type PsychometricLikertScale =
  | PsychometricTrait
  | PsychometricRiskScale
  | PsychometricValidityScale;

/**
 * Likert scales that describe the candidate (as opposed to their response
 * style). These are the ones whose keying and halves the validity checks can
 * compare against each other.
 */
export const PSYCHOMETRIC_CONTENT_SCALES: (PsychometricTrait | PsychometricRiskScale)[] = [
  ...PSYCHOMETRIC_TRAITS,
  ...PSYCHOMETRIC_RISK_SCALES,
];

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
  /**
   * Risk scales only. A critical item describes a concrete behaviour (not an
   * opinion) serious enough that endorsing it is listed on its own in the
   * report, whatever the scale score — and it is always applied when its scale
   * is. It counts toward the score like any other item; it does not change the
   * level by itself.
   */
  critical?: boolean;
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
  /** Likert items per risk scale per session. 0 = every enabled item. */
  likertPerRisk: number;
  sjt: number;
  deseabilidadSocial: number;
  infrecuencia: number;
  atencion: number;
}

/**
 * Risk levels are absolute on purpose. Agreeing with "a veces un golpe es la
 * única forma de que te respeten" means the same thing whatever other candidates
 * answered, and a percentile would call someone "low risk" just because the
 * applicant pool that month was worse.
 */
export interface PsychometricRiskCutoffs {
  /** normalizedScore >= moderateMin → "moderado" */
  moderateMin: number;
  /** normalizedScore >= highMin → "alto" */
  highMin: number;
}

export interface PsychometricTestConfig {
  weights: PsychometricScaleWeights;
  bandCutoffs: PsychometricBandCutoffs;
  percentileCutoffs: PsychometricPercentileCutoffs;
  riskCutoffs: PsychometricRiskCutoffs;
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

export type PsychometricRiskLevel = 'bajo' | 'moderado' | 'alto';

export interface PsychometricRiskResult {
  scale: PsychometricRiskScale;
  /** false when fewer than config.minItemsPerScale items were answered. */
  hasData: boolean;
  itemsApplied: number;
  itemsAnswered: number;
  /** Mean 1-5 in the risk direction (reverse items already flipped). */
  rawAverage: number;
  /** 0-100, higher = more risk. */
  normalizedScore: number;
  /** Position in the local norm sample, informative only — never sets the level. */
  percentile?: number;
  level: PsychometricRiskLevel;
  /**
   * Ids of critical items the candidate endorsed (4-5 in the risk direction).
   * Reported for follow-up; they do not change the level.
   */
  criticalEndorsed: string[];
  /**
   * 'puntaje' when the score reached a cutoff, 'sin_riesgo' otherwise. The two
   * critical-item values only appear on results scored while admitted
   * behaviours still raised the level; the level is now score-only.
   */
  levelReason: 'puntaje' | 'reactivos_criticos' | 'puntaje_y_criticos' | 'sin_riesgo';
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

export const PSYCHOMETRIC_RESULT_VERSION = 3;

export interface PsychometricResult {
  /** 1 = pre-norms/pre-integridad; 2 = pre-risk scales; 3 = this shape. */
  version: number;
  scales: Record<PsychometricScoredScale, PsychometricScaleResult>;
  /** Violence and substance-use risk. Absent on results scored before v3. */
  risks: Record<PsychometricRiskScale, PsychometricRiskResult>;
  /** Highest level across the risk scales that have data; null when none has. */
  overallRisk: PsychometricRiskLevel | null;
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

export type PsychometricNormKey = PsychometricScoredScale | PsychometricRiskScale | 'composite';

export interface PsychometricNorms {
  scales: Partial<Record<PsychometricNormKey, PsychometricNormStat>>;
  updatedAtIso?: string;
}

/** Below this the sample says nothing; bands stay absolute. */
export const NORM_MIN_N_PROVISIONAL = 30;
/** Local percentile ranks are only reasonably stable from ~100 cases up. */
export const NORM_MIN_N_STABLE = 100;
