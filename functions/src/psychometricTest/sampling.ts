// Assembling one candidate's test out of the bank.
//
// Sampling is stratified rather than random, because a random draw from a mixed
// bank produces sessions that cannot be scored the same way:
//
//  - balanced keying per trait (half positively worded, half reverse worded).
//    An all-positive scale measures agreement as much as it measures the trait,
//    and it makes the keying-inconsistency check impossible to compute
//  - the response-style scales and the attention checks are drawn separately, so
//    shortening the test never silently removes the ability to detect careless
//    responding
//  - items are interleaved so that two consecutive questions rarely belong to the
//    same trait. Blocks of same-trait items invite pattern answering and inflate
//    internal consistency for the wrong reason
//  - attention checks are spread across the test instead of landing wherever the
//    shuffle puts them
//  - risk items are mixed into the same block as the traits. Grouped together,
//    a run of questions about fights and alcohol reads as "this is the part
//    they are screening me on" and invites the most guarded answers of the test
//  - critical risk items are always applied. They are the few items whose
//    endorsement is reported on its own, so leaving one out at random would
//    make the same candidate's alert depend on the draw

import {
  PSYCHOMETRIC_RISK_SCALES,
  PSYCHOMETRIC_TRAITS,
  PSYCHOMETRIC_VALIDITY_SCALES,
  type PsychometricAttentionQuestion,
  type PsychometricLikertQuestion,
  type PsychometricQuestion,
  type PsychometricSjtQuestion,
  type PsychometricTestConfig,
  type PsychometricTrait,
} from './types';

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Take `count` at random. 0 or a count at/over the list length keeps everything. */
export function sampleN<T>(items: T[], count: number): T[] {
  if (!count || count <= 0 || count >= items.length) return shuffle(items);
  return shuffle(items).slice(0, count);
}

/**
 * Takes `want` items from one keying side, starting with the ones that must be
 * applied and filling the rest at random.
 */
function takeSide(items: PsychometricLikertQuestion[], want: number): PsychometricLikertQuestion[] {
  const required = items.filter((q) => q.critical);
  const optional = items.filter((q) => !q.critical);
  // sampleN treats 0 as "take everything", so an exhausted quota has to be
  // handled here rather than passed through.
  const taken = want > 0 ? sampleN(required, Math.min(want, required.length)) : [];
  const remaining = Math.min(want - taken.length, optional.length);
  return remaining > 0 ? [...taken, ...sampleN(optional, remaining)] : taken;
}

/**
 * Draws `count` items from one scale keeping the positive/reverse split as even
 * as possible, backfilling from the other side when the bank is lopsided.
 * Critical items are taken first within their side, and a cap too small to fit
 * all of them is widened rather than dropping one.
 */
export function sampleBalanced(
  items: PsychometricLikertQuestion[],
  count: number
): PsychometricLikertQuestion[] {
  const positive = items.filter((q) => !q.reverseScored);
  const reversed = items.filter((q) => q.reverseScored);
  const criticalCount = items.filter((q) => q.critical).length;

  const requested = !count || count <= 0 ? items.length : Math.min(count, items.length);
  const want = Math.max(requested, criticalCount);
  const wantReversed = Math.max(Math.floor(want / 2), reversed.filter((q) => q.critical).length);
  const wantPositive = Math.max(want - wantReversed, positive.filter((q) => q.critical).length);

  const takenPositive = takeSide(positive, Math.min(wantPositive, positive.length));
  const takenReversed = takeSide(reversed, Math.min(wantReversed, reversed.length));

  const selected = [...takenPositive, ...takenReversed];
  if (selected.length < want) {
    const used = new Set(selected.map((q) => q.id));
    const leftovers = sampleN(items.filter((q) => !used.has(q.id)), 0);
    selected.push(...leftovers.slice(0, want - selected.length));
  }
  return selected;
}

/**
 * Orders items so consecutive questions come from different scales, always
 * drawing from the scale with the most items left so the spread holds to the end.
 */
function interleaveByScale(items: PsychometricLikertQuestion[]): PsychometricLikertQuestion[] {
  const buckets = new Map<string, PsychometricLikertQuestion[]>();
  for (const question of shuffle(items)) {
    const bucket = buckets.get(question.scale) ?? [];
    bucket.push(question);
    buckets.set(question.scale, bucket);
  }

  const out: PsychometricLikertQuestion[] = [];
  let previousScale: string | null = null;

  for (;;) {
    const remaining = [...buckets.entries()].filter(([, bucket]) => bucket.length > 0);
    if (remaining.length === 0) break;
    const eligible = remaining.filter(([scale]) => scale !== previousScale);
    const pool = eligible.length > 0 ? eligible : remaining;
    pool.sort((a, b) => b[1].length - a[1].length);
    const [scale, bucket] = pool[0];
    out.push(bucket.shift()!);
    previousScale = scale;
  }

  return out;
}

/** Places the attention checks at evenly spaced positions, never first or last. */
function insertAttentionChecks(
  items: PsychometricQuestion[],
  checks: PsychometricAttentionQuestion[]
): PsychometricQuestion[] {
  if (checks.length === 0) return items;
  const out = [...items];
  const step = (out.length + 1) / (checks.length + 1);
  checks.forEach((check, index) => {
    const target = Math.round((index + 1) * step) + index;
    const position = Math.min(Math.max(target, 1), out.length);
    out.splice(position, 0, check);
  });
  return out;
}

export interface AssembledTest {
  /** Applied questions in presentation order: personality block, then scenarios. */
  questions: PsychometricQuestion[];
  /** Displayed option order per SJT question, frozen for the session. */
  optionOrders: Record<string, number[]>;
}

export function assembleTest(
  bank: PsychometricQuestion[],
  config: PsychometricTestConfig
): AssembledTest {
  const enabled = bank.filter((q) => q.enabled);
  const counts = config.questionCounts;

  const likert = enabled.filter((q): q is PsychometricLikertQuestion => q.type === 'likert');

  const traitItems = PSYCHOMETRIC_TRAITS.flatMap((trait: PsychometricTrait) =>
    sampleBalanced(
      likert.filter((q) => q.scale === trait),
      counts.likertPerTrait
    )
  );

  const riskItems = PSYCHOMETRIC_RISK_SCALES.flatMap((scale) =>
    sampleBalanced(
      likert.filter((q) => q.scale === scale),
      counts.likertPerRisk
    )
  );

  const styleItems = PSYCHOMETRIC_VALIDITY_SCALES.flatMap((scale) =>
    sampleN(
      likert.filter((q) => q.scale === scale),
      scale === 'deseabilidad_social' ? counts.deseabilidadSocial : counts.infrecuencia
    )
  );

  const attentionChecks = sampleN(
    enabled.filter((q): q is PsychometricAttentionQuestion => q.type === 'attention'),
    counts.atencion
  );

  const scenarios = sampleN(
    enabled.filter((q): q is PsychometricSjtQuestion => q.type === 'sjt'),
    counts.sjt
  );

  const personalityBlock = insertAttentionChecks(
    interleaveByScale([...traitItems, ...riskItems, ...styleItems]),
    attentionChecks
  );

  const questions: PsychometricQuestion[] = [...personalityBlock, ...scenarios];

  const optionOrders: Record<string, number[]> = {};
  for (const question of scenarios) {
    optionOrders[question.id] = shuffle(question.options.map((_, index) => index));
  }

  return { questions, optionOrders };
}

// ─── Bank health checks ───────────────────────────────────────────────────────

/** Questions per trait below which a scale's score gets noticeably noisy. */
const RECOMMENDED_PER_TRAIT = 8;

export type BankWarningLevel = 'error' | 'warning';

export interface BankWarning {
  level: BankWarningLevel;
  scope: string;
  message: string;
}

/**
 * Static checks on the bank + config, before anybody takes the test. These are
 * the problems that silently produce meaningless scores: too few items on a
 * scale for it to be reliable, a scale with no reverse-worded items, a session
 * configured to apply more items than the bank holds, or careless-responding
 * detection that cannot run because the bank has no checks in it.
 */
export function auditBank(bank: PsychometricQuestion[], config: PsychometricTestConfig): BankWarning[] {
  const warnings: BankWarning[] = [];
  const enabled = bank.filter((q) => q.enabled);
  const likert = enabled.filter((q): q is PsychometricLikertQuestion => q.type === 'likert');
  const counts = config.questionCounts;

  // The sampling cap is a single setting, so it is reported once instead of
  // once per trait — repeating it pointed admins at scales that were fine.
  const capBlocksEveryTrait =
    counts.likertPerTrait > 0 && counts.likertPerTrait < config.minItemsPerScale;
  if (capBlocksEveryTrait) {
    warnings.push({
      level: 'error',
      scope: 'configuracion',
      message: `Cada candidato responde ${counts.likertPerTrait} preguntas por rasgo, y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje: así, ningún rasgo se podría calificar.`,
    });
  } else if (counts.likertPerTrait > 0 && counts.likertPerTrait < RECOMMENDED_PER_TRAIT) {
    warnings.push({
      level: 'warning',
      scope: 'configuracion',
      message: `Cada candidato responde ${counts.likertPerTrait} preguntas por rasgo. Con tan pocas, el puntaje de cada rasgo sale con bastante margen de error: se recomiendan ${RECOMMENDED_PER_TRAIT} o más.`,
    });
  }

  for (const trait of PSYCHOMETRIC_TRAITS) {
    const items = likert.filter((q) => q.scale === trait);
    const reversed = items.filter((q) => q.reverseScored).length;
    const positive = items.length - reversed;

    if (items.length === 0) {
      warnings.push({ level: 'error', scope: trait, message: 'No tiene preguntas activas: el rasgo no se podrá calificar.' });
      continue;
    }
    if (items.length < config.minItemsPerScale) {
      warnings.push({
        level: 'error',
        scope: trait,
        message: `Tiene ${items.length} preguntas activas y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje.`,
      });
    } else if (items.length < RECOMMENDED_PER_TRAIT) {
      warnings.push({
        level: 'warning',
        scope: trait,
        message: `Tiene ${items.length} preguntas activas. Con menos de ${RECOMMENDED_PER_TRAIT} el puntaje del rasgo sale con más margen de error.`,
      });
    }
    if (reversed === 0 || positive === 0) {
      warnings.push({
        level: 'warning',
        scope: trait,
        message: 'Todas las preguntas están redactadas en el mismo sentido. Conviene marcar algunas como invertidas, porque hay gente que tiende a decir que sí a todo.',
      });
    }
  }

  // Risk scales are optional: a bank without them simply does not report risk.
  // Once a scale has items, though, it has to be scoreable and balanced.
  if (counts.likertPerRisk > 0 && counts.likertPerRisk < config.minItemsPerScale) {
    warnings.push({
      level: 'error',
      scope: 'configuracion',
      message: `Cada candidato responde ${counts.likertPerRisk} preguntas por escala de riesgo, y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje.`,
    });
  }
  for (const scale of PSYCHOMETRIC_RISK_SCALES) {
    const items = likert.filter((q) => q.scale === scale);
    if (items.length === 0) {
      warnings.push({
        level: 'warning',
        scope: scale,
        message: 'No tiene preguntas activas: esta prueba no reportará este riesgo. Carga el banco base para agregarlas.',
      });
      continue;
    }
    if (items.length < config.minItemsPerScale) {
      warnings.push({
        level: 'error',
        scope: scale,
        message: `Tiene ${items.length} preguntas activas y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje.`,
      });
    }
    const reversed = items.filter((q) => q.reverseScored).length;
    if (reversed === 0 || reversed === items.length) {
      warnings.push({
        level: 'warning',
        scope: scale,
        message: 'Todas las preguntas están redactadas en el mismo sentido. Conviene tener también afirmaciones protectoras (invertidas).',
      });
    }
    if (!items.some((q) => q.critical)) {
      warnings.push({
        level: 'warning',
        scope: scale,
        message: 'No tiene reactivos críticos: solo se podrá alertar por el puntaje, no por conductas concretas admitidas.',
      });
    }
  }

  const scenarios = enabled.filter((q) => q.type === 'sjt');
  if (scenarios.length === 0) {
    warnings.push({ level: 'error', scope: 'sjt', message: 'No hay escenarios de juicio situacional activos.' });
  } else if ((counts.sjt > 0 ? Math.min(counts.sjt, scenarios.length) : scenarios.length) < 5) {
    warnings.push({
      level: 'warning',
      scope: 'sjt',
      message: 'Con menos de 5 escenarios el puntaje de juicio situacional varía demasiado de un candidato a otro.',
    });
  }

  const checks = enabled.filter((q) => q.type === 'attention');
  if (counts.atencion > 0 && checks.length === 0) {
    warnings.push({
      level: 'error',
      scope: 'atencion',
      message: 'La configuración pide controles de atención pero el banco no tiene ninguno activo.',
    });
  } else if (Math.min(counts.atencion, checks.length) < 2) {
    warnings.push({
      level: 'warning',
      scope: 'atencion',
      message: 'Con menos de 2 preguntas de control no se puede distinguir un descuido de alguien que responde sin leer.',
    });
  }

  for (const scale of PSYCHOMETRIC_VALIDITY_SCALES) {
    const items = likert.filter((q) => q.scale === scale);
    const requested = scale === 'deseabilidad_social' ? counts.deseabilidadSocial : counts.infrecuencia;
    if (requested > 0 && items.length === 0) {
      warnings.push({
        level: 'warning',
        scope: scale,
        message: 'La configuración pide ítems de esta escala pero el banco no tiene ninguno activo.',
      });
    } else if (items.length > 0 && Math.min(requested || items.length, items.length) < 3) {
      warnings.push({
        level: 'warning',
        scope: scale,
        message: 'Se recomiendan al menos 3 preguntas para que esta escala de control sirva de algo.',
      });
    }
  }

  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    warnings.push({
      level: 'error',
      scope: 'ponderacion',
      message: 'Todos los pesos están en 0, así que no se puede calcular el puntaje general.',
    });
  }

  if (config.bandCutoffs.lowMax >= config.bandCutoffs.highMin) {
    warnings.push({
      level: 'error',
      scope: 'bandas',
      message: 'El corte de la banda "bajo" debe ser menor que el de la banda "alto".',
    });
  }
  if (config.percentileCutoffs.lowMaxPercentile >= config.percentileCutoffs.highMinPercentile) {
    warnings.push({
      level: 'error',
      scope: 'bandas',
      message: 'Los percentiles de corte están invertidos.',
    });
  }
  if (config.riskCutoffs.moderateMin >= config.riskCutoffs.highMin) {
    warnings.push({
      level: 'error',
      scope: 'bandas',
      message: 'El corte de riesgo "moderado" debe ser menor que el de riesgo "alto".',
    });
  }

  return warnings;
}
