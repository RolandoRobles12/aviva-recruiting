// Item and scale statistics over the sessions already collected.
//
// This is what turns the bank from a fixed questionnaire into an instrument that
// improves: it reports internal consistency per scale and, per item, how much
// that item actually contributes. Items with near-zero discrimination or no
// variance add administration time and noise but no information, and the honest
// way to build a short test is to over-write the bank and then retire what does
// not work — which requires measuring it first.
//
// Because sessions sample items at random, the item matrix is unbalanced. Alpha
// is therefore computed available-case (per-item variances, pairwise
// covariances) and reported alongside the smallest pairwise n, so a number
// resting on 12 overlapping cases is not read as a stable estimate.

import {
  PSYCHOMETRIC_TRAITS,
  PSYCHOMETRIC_VALIDITY_SCALES,
  type PsychometricAnswer,
  type PsychometricLikertScale,
  type PsychometricQuestion,
  type PsychometricValidityVerdict,
} from './types';

export type AnalysisScaleKey = PsychometricLikertScale | 'sjt';

const ANALYSIS_SCALE_KEYS: AnalysisScaleKey[] = [
  ...PSYCHOMETRIC_TRAITS,
  ...PSYCHOMETRIC_VALIDITY_SCALES,
  'sjt',
];

/** One completed session, reduced to what the analysis needs. */
export interface AnalysisSession {
  /** Ids of the questions applied in that session. */
  questionIds: string[];
  answers: PsychometricAnswer[];
  optionOrders?: Record<string, number[]>;
  validityVerdict?: PsychometricValidityVerdict;
}

export interface ScaleAnalysis {
  scale: AnalysisScaleKey;
  /** Enabled items of this scale in the bank. */
  itemsInBank: number;
  /** Items with enough responses to enter the estimate. */
  itemsAnalyzed: number;
  /** Sessions in which at least two items of the scale were answered. */
  n: number;
  mean: number | null;
  sd: number | null;
  /** Cronbach's alpha, available-case. Null when the data cannot support it. */
  alpha: number | null;
  /** Smallest number of sessions behind any pair of items in the alpha estimate. */
  minPairwiseN: number | null;
  notes: string[];
}

export interface ItemAnalysis {
  id: string;
  text: string;
  type: PsychometricQuestion['type'];
  scale?: AnalysisScaleKey;
  reverseScored?: boolean;
  n: number;
  /** Likert: reverse-corrected mean (1-5). SJT: mean option score. */
  mean: number | null;
  sd: number | null;
  /** Corrected item-total correlation (the item is excluded from the total). */
  itemTotalCorrelation: number | null;
  /** SJT only: share of candidates choosing each option. */
  optionDistribution?: { text: string; score: number; share: number }[];
  /** Attention checks only: share who answered as instructed. */
  passRate?: number;
  issues: string[];
}

export interface BankAnalysis {
  sessionsAnalyzed: number;
  sessionsExcluded: number;
  scales: ScaleAnalysis[];
  items: ItemAnalysis[];
  generatedAtIso: string;
}

/** An item needs at least this many responses before its statistics mean anything. */
const MIN_N_PER_ITEM = 10;
/** Below this, scale-level numbers are reported but flagged as preliminary. */
const MIN_N_PER_SCALE = 30;
const LOW_DISCRIMINATION = 0.15;
const LOW_VARIANCE_SD = 0.6;
const CEILING_MEAN = 4.6;
const FLOOR_MEAN = 1.4;

// ─── Statistics ───────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample variance (n-1). */
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
}

function covariance(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += (xs[i] - mx) * (ys[i] - my);
  return sum / (xs.length - 1);
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const vx = variance(xs);
  const vy = variance(ys);
  if (vx <= 0 || vy <= 0) return null;
  return covariance(xs, ys) / Math.sqrt(vx * vy);
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ─── Response matrix ──────────────────────────────────────────────────────────

interface ScoredSession {
  /** itemId → score on the item's own scale (reverse-corrected for Likert). */
  values: Map<string, number>;
  /** itemId → index of the option chosen, in the bank's own order. */
  sjtChoices: Map<string, number>;
  /** itemId → 1 when the attention check was answered as instructed. */
  attention: Map<string, number>;
}

function scoreSessionForAnalysis(
  session: AnalysisSession,
  byId: Map<string, PsychometricQuestion>
): ScoredSession {
  const applied = new Set(session.questionIds);
  const values = new Map<string, number>();
  const sjtChoices = new Map<string, number>();
  const attention = new Map<string, number>();

  for (const answer of session.answers) {
    if (session.questionIds.length > 0 && !applied.has(answer.questionId)) continue;
    const question = byId.get(answer.questionId);
    if (!question) continue;

    if (question.type === 'likert') {
      values.set(question.id, question.reverseScored ? 6 - answer.value : answer.value);
    } else if (question.type === 'attention') {
      attention.set(question.id, answer.value === question.expectedValue ? 1 : 0);
    } else {
      const order = session.optionOrders?.[question.id] ?? question.options.map((_, i) => i);
      const originalIndex = order[answer.value];
      const option = question.options[originalIndex];
      if (!option) continue;
      values.set(question.id, option.score);
      sjtChoices.set(question.id, originalIndex);
    }
  }

  return { values, sjtChoices, attention };
}

function scaleOf(question: PsychometricQuestion): AnalysisScaleKey | null {
  if (question.type === 'likert') return question.scale;
  if (question.type === 'sjt') return 'sjt';
  return null;
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

/**
 * @param sessions Completed sessions. Sessions whose validity verdict is
 *                 `no_confiable` are excluded: careless data attenuates every
 *                 correlation and would make good items look bad.
 */
export function analyzeBank(bank: PsychometricQuestion[], sessions: AnalysisSession[]): BankAnalysis {
  const byId = new Map(bank.map((q) => [q.id, q]));
  const usable = sessions.filter((s) => s.validityVerdict !== 'no_confiable');
  const scored = usable.map((session) => scoreSessionForAnalysis(session, byId));

  const enabled = bank.filter((q) => q.enabled);

  // itemId → the scored values observed across sessions, and the session index
  // each came from (needed to pair items up for covariances).
  const observations = new Map<string, { sessionIndex: number; value: number }[]>();
  for (const question of enabled) {
    const list: { sessionIndex: number; value: number }[] = [];
    scored.forEach((session, index) => {
      const value = session.values.get(question.id);
      if (value !== undefined) list.push({ sessionIndex: index, value });
    });
    observations.set(question.id, list);
  }

  const scales = ANALYSIS_SCALE_KEYS.map((scale) =>
    analyzeScale(scale, enabled, observations, scored)
  );
  const items = enabled.map((question) => analyzeItem(question, enabled, observations, scored));

  return {
    sessionsAnalyzed: usable.length,
    sessionsExcluded: sessions.length - usable.length,
    scales,
    items,
    generatedAtIso: new Date().toISOString(),
  };
}

function analyzeScale(
  scale: AnalysisScaleKey,
  enabled: PsychometricQuestion[],
  observations: Map<string, { sessionIndex: number; value: number }[]>,
  scored: ScoredSession[]
): ScaleAnalysis {
  const scaleItems = enabled.filter((q) => scaleOf(q) === scale);
  const analyzable = scaleItems.filter((q) => (observations.get(q.id)?.length ?? 0) >= MIN_N_PER_ITEM);
  const notes: string[] = [];

  // Scale score per session = mean of the answered items, so sessions with
  // different item counts stay comparable.
  const scaleScores: number[] = [];
  let sessionsWithScale = 0;
  for (const session of scored) {
    const values = scaleItems
      .map((q) => session.values.get(q.id))
      .filter((v): v is number => v !== undefined);
    if (values.length < 2) continue;
    sessionsWithScale += 1;
    scaleScores.push(mean(values));
  }

  let alpha: number | null = null;
  let minPairwiseN: number | null = null;

  if (analyzable.length >= 3) {
    let sumItemVariance = 0;
    let sumCovariance = 0;
    minPairwiseN = Number.POSITIVE_INFINITY;

    for (let i = 0; i < analyzable.length; i++) {
      const xi = observations.get(analyzable[i].id)!;
      sumItemVariance += variance(xi.map((o) => o.value));

      for (let j = i + 1; j < analyzable.length; j++) {
        const xj = observations.get(analyzable[j].id)!;
        const byIndex = new Map(xj.map((o) => [o.sessionIndex, o.value]));
        const paired = xi.filter((o) => byIndex.has(o.sessionIndex));
        minPairwiseN = Math.min(minPairwiseN, paired.length);
        if (paired.length < 3) continue;
        sumCovariance += covariance(
          paired.map((o) => o.value),
          paired.map((o) => byIndex.get(o.sessionIndex)!)
        );
      }
    }

    const totalVariance = sumItemVariance + 2 * sumCovariance;
    if (totalVariance > 0) {
      const k = analyzable.length;
      alpha = (k / (k - 1)) * (1 - sumItemVariance / totalVariance);
      alpha = Math.max(-1, Math.min(1, alpha));
    }
    if (!Number.isFinite(minPairwiseN)) minPairwiseN = null;
  } else if (scaleItems.length > 0) {
    notes.push(`Se necesitan al menos 3 ítems con ${MIN_N_PER_ITEM}+ respuestas para estimar la consistencia interna.`);
  }

  if (sessionsWithScale > 0 && sessionsWithScale < MIN_N_PER_SCALE) {
    notes.push(`Estimación preliminar: solo ${sessionsWithScale} sesiones incluyen esta escala.`);
  }
  if (alpha !== null && alpha < 0.6) {
    notes.push('Consistencia interna baja (α < .60): revisa los ítems con discriminación baja.');
  }
  if (scale === 'sjt' && alpha !== null) {
    notes.push('En un SJT multidimensional el alfa subestima la calidad; úsalo solo como referencia.');
  }

  return {
    scale,
    itemsInBank: scaleItems.length,
    itemsAnalyzed: analyzable.length,
    n: sessionsWithScale,
    mean: scaleScores.length > 0 ? round(mean(scaleScores)) : null,
    sd: scaleScores.length > 1 ? round(Math.sqrt(variance(scaleScores))) : null,
    alpha: round(alpha),
    minPairwiseN,
    notes,
  };
}

function analyzeItem(
  question: PsychometricQuestion,
  enabled: PsychometricQuestion[],
  observations: Map<string, { sessionIndex: number; value: number }[]>,
  scored: ScoredSession[]
): ItemAnalysis {
  const issues: string[] = [];

  if (question.type === 'attention') {
    const results = scored
      .map((session) => session.attention.get(question.id))
      .filter((v): v is number => v !== undefined);
    const passRate = results.length > 0 ? mean(results) : undefined;
    if (results.length < MIN_N_PER_ITEM) {
      issues.push('Muestra insuficiente para valorar el ítem.');
    } else if (passRate !== undefined && passRate < 0.7) {
      issues.push('Lo falla más del 30% de los candidatos: la instrucción puede ser confusa.');
    }
    return {
      id: question.id,
      text: question.text,
      type: question.type,
      n: results.length,
      mean: null,
      sd: null,
      itemTotalCorrelation: null,
      passRate: passRate !== undefined ? (round(passRate) ?? undefined) : undefined,
      issues,
    };
  }

  const scale = scaleOf(question)!;
  const own = observations.get(question.id) ?? [];
  const values = own.map((o) => o.value);

  // Corrected item-total: the item is left out of the total it is compared with,
  // otherwise every item correlates with itself and looks better than it is.
  const others = enabled.filter((q) => q.id !== question.id && scaleOf(q) === scale);
  const itemScores: number[] = [];
  const restScores: number[] = [];
  for (const observation of own) {
    const session = scored[observation.sessionIndex];
    const rest = others
      .map((q) => session.values.get(q.id))
      .filter((v): v is number => v !== undefined);
    if (rest.length < 2) continue;
    itemScores.push(observation.value);
    restScores.push(mean(rest));
  }

  const itemTotalCorrelation = itemScores.length >= MIN_N_PER_ITEM ? pearson(itemScores, restScores) : null;
  const itemMean = values.length > 0 ? mean(values) : null;
  const itemSd = values.length > 1 ? Math.sqrt(variance(values)) : null;

  if (values.length < MIN_N_PER_ITEM) {
    issues.push('Muestra insuficiente para valorar el ítem.');
  } else {
    if (itemSd !== null && itemSd < LOW_VARIANCE_SD) {
      issues.push('Casi todos responden lo mismo: aporta poca información.');
    }
    if (itemTotalCorrelation !== null && itemTotalCorrelation < LOW_DISCRIMINATION) {
      issues.push('Discriminación baja frente al resto de la escala: considera reformularlo o desactivarlo.');
    }
    if (question.type === 'likert' && itemMean !== null) {
      if (itemMean > CEILING_MEAN) issues.push('Efecto techo: prácticamente nadie está en desacuerdo.');
      if (itemMean < FLOOR_MEAN) issues.push('Efecto piso: prácticamente nadie está de acuerdo.');
    }
  }

  let optionDistribution: ItemAnalysis['optionDistribution'];
  if (question.type === 'sjt') {
    const counts = new Array(question.options.length).fill(0);
    let total = 0;
    for (const session of scored) {
      const chosen = session.sjtChoices.get(question.id);
      if (chosen === undefined || chosen < 0 || chosen >= counts.length) continue;
      counts[chosen] += 1;
      total += 1;
    }
    if (total > 0) {
      optionDistribution = question.options.map((option, index) => ({
        text: option.text,
        score: option.score,
        share: round(counts[index] / total) ?? 0,
      }));
      const best = question.options.reduce((a, b) => (b.score > a.score ? b : a));
      const bestShare = optionDistribution[question.options.indexOf(best)]?.share ?? 0;
      if (total >= MIN_N_PER_ITEM) {
        if (bestShare > 0.9) issues.push('Casi todos eligen la mejor opción: el escenario no discrimina.');
        if (bestShare < 0.15) issues.push('Casi nadie elige la opción clave: revisa la clave o la redacción.');
      }
    }
  }

  return {
    id: question.id,
    text: question.text,
    type: question.type,
    scale,
    reverseScored: question.type === 'likert' ? question.reverseScored : undefined,
    n: values.length,
    mean: round(itemMean),
    sd: round(itemSd),
    itemTotalCorrelation: round(itemTotalCorrelation),
    optionDistribution,
    issues,
  };
}
