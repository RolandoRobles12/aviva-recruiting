// Scoring logic for the standalone psychometric test module.
// Shared by getTest (start/resume a session) and submitTest (score answers).

export type PsychometricTrait =
  | 'responsabilidad'
  | 'estabilidad_emocional'
  | 'extraversion'
  | 'amabilidad';

export interface PsychometricLikertQuestion {
  id: string;
  type: 'likert';
  text: string;
  trait: PsychometricTrait;
  reverseScored: boolean;
  enabled: boolean;
  order: number;
}

export interface PsychometricSjtOption {
  text: string;
  score: number;
}

export interface PsychometricSjtQuestion {
  id: string;
  type: 'sjt';
  text: string;
  options: PsychometricSjtOption[];
  enabled: boolean;
  order: number;
}

export type PsychometricQuestion = PsychometricLikertQuestion | PsychometricSjtQuestion;

export interface PsychometricTraitWeights {
  responsabilidad: number;
  estabilidad_emocional: number;
  extraversion: number;
  amabilidad: number;
  sjt: number;
}

export interface PsychometricBandCutoffs {
  lowMax: number;
  highMin: number;
}

export interface PsychometricTestConfig {
  weights: PsychometricTraitWeights;
  bandCutoffs: PsychometricBandCutoffs;
  timeLimitMinutes: number;
}

export type PsychometricBand = 'bajo' | 'medio' | 'alto';

export interface PsychometricTraitResult {
  rawAverage: number;
  normalizedScore: number;
  band: PsychometricBand;
}

export interface PsychometricResult {
  traits: Record<PsychometricTrait, PsychometricTraitResult>;
  sjt: PsychometricTraitResult;
  compositeScore: number;
  compositeBand: PsychometricBand;
}

export interface PsychometricAnswer {
  questionId: string;
  value: number;
}

export const PSYCHOMETRIC_TRAITS: PsychometricTrait[] = [
  'responsabilidad',
  'estabilidad_emocional',
  'extraversion',
  'amabilidad',
];

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bandFor(score: number, cutoffs: PsychometricBandCutoffs): PsychometricBand {
  if (score < cutoffs.lowMax) return 'bajo';
  if (score < cutoffs.highMin) return 'medio';
  return 'alto';
}

export function scoreAnswers(
  questions: PsychometricQuestion[],
  answers: PsychometricAnswer[],
  optionOrders: Record<string, number[]>,
  config: PsychometricTestConfig
): PsychometricResult {
  const answerById = new Map(answers.map((a) => [a.questionId, a.value]));

  const traitSums: Record<PsychometricTrait, { sum: number; count: number }> = {
    responsabilidad: { sum: 0, count: 0 },
    estabilidad_emocional: { sum: 0, count: 0 },
    extraversion: { sum: 0, count: 0 },
    amabilidad: { sum: 0, count: 0 },
  };
  let sjtSum = 0;
  let sjtCount = 0;

  for (const q of questions) {
    const value = answerById.get(q.id);
    if (value === undefined) continue;

    if (q.type === 'likert') {
      const scored = q.reverseScored ? 6 - value : value;
      traitSums[q.trait].sum += scored;
      traitSums[q.trait].count += 1;
    } else {
      const order = optionOrders[q.id] ?? q.options.map((_, i) => i);
      const originalIdx = order[value];
      const option = q.options[originalIdx];
      if (option) {
        sjtSum += option.score;
        sjtCount += 1;
      }
    }
  }

  const traits = {} as Record<PsychometricTrait, PsychometricTraitResult>;
  for (const trait of PSYCHOMETRIC_TRAITS) {
    const { sum, count } = traitSums[trait];
    const rawAverage = count > 0 ? sum / count : 0;
    const normalizedScore = count > 0 ? Math.round(((rawAverage - 1) / 4) * 100) : 0;
    traits[trait] = { rawAverage, normalizedScore, band: bandFor(normalizedScore, config.bandCutoffs) };
  }

  const sjtRawAverage = sjtCount > 0 ? sjtSum / sjtCount : 0;
  const sjtNormalized = sjtCount > 0 ? Math.round((sjtRawAverage / 2) * 100) : 0;
  const sjt: PsychometricTraitResult = {
    rawAverage: sjtRawAverage,
    normalizedScore: sjtNormalized,
    band: bandFor(sjtNormalized, config.bandCutoffs),
  };

  const w = config.weights;
  const weightSum = w.responsabilidad + w.estabilidad_emocional + w.extraversion + w.amabilidad + w.sjt;
  const weighted =
    traits.responsabilidad.normalizedScore * w.responsabilidad +
    traits.estabilidad_emocional.normalizedScore * w.estabilidad_emocional +
    traits.extraversion.normalizedScore * w.extraversion +
    traits.amabilidad.normalizedScore * w.amabilidad +
    sjt.normalizedScore * w.sjt;
  const compositeScore = weightSum > 0 ? Math.round(weighted / weightSum) : 0;

  return {
    traits,
    sjt,
    compositeScore,
    compositeBand: bandFor(compositeScore, config.bandCutoffs),
  };
}
