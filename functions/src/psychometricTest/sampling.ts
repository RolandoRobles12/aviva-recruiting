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

import {
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
 * Draws `count` items from one trait keeping the positive/reverse split as even
 * as possible, backfilling from the other side when the bank is lopsided.
 */
function sampleBalanced(items: PsychometricLikertQuestion[], count: number): PsychometricLikertQuestion[] {
  const positive = items.filter((q) => !q.reverseScored);
  const reversed = items.filter((q) => q.reverseScored);

  const want = !count || count <= 0 ? items.length : Math.min(count, items.length);
  const wantReversed = Math.floor(want / 2);
  const wantPositive = want - wantReversed;

  const takenPositive = sampleN(positive, Math.min(wantPositive, positive.length));
  const takenReversed = sampleN(reversed, Math.min(wantReversed, reversed.length));

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
    interleaveByScale([...traitItems, ...styleItems]),
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

  for (const trait of PSYCHOMETRIC_TRAITS) {
    const items = likert.filter((q) => q.scale === trait);
    const reversed = items.filter((q) => q.reverseScored).length;
    const positive = items.length - reversed;
    const applied = counts.likertPerTrait > 0 ? Math.min(counts.likertPerTrait, items.length) : items.length;

    if (items.length === 0) {
      warnings.push({ level: 'error', scope: trait, message: 'No hay ítems activos para este rasgo.' });
      continue;
    }
    if (applied < config.minItemsPerScale) {
      warnings.push({
        level: 'error',
        scope: trait,
        message: `Se aplicarían ${applied} ítems y el mínimo para reportar puntaje es ${config.minItemsPerScale}.`,
      });
    } else if (applied < 6) {
      warnings.push({
        level: 'warning',
        scope: trait,
        message: `Con ${applied} ítems la consistencia interna suele quedar por debajo de .70. Se recomiendan 8 o más.`,
      });
    }
    if (reversed === 0 || positive === 0) {
      warnings.push({
        level: 'warning',
        scope: trait,
        message: 'Todos los ítems tienen la misma dirección. Mezcla ítems normales e invertidos para controlar el sesgo de aquiescencia.',
      });
    }
    if (counts.likertPerTrait > items.length) {
      warnings.push({
        level: 'warning',
        scope: trait,
        message: `Se piden ${counts.likertPerTrait} ítems por sesión y solo hay ${items.length} activos.`,
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
      message: 'Con menos de 5 escenarios el puntaje de juicio situacional es muy inestable.',
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
      message: 'Con menos de 2 controles de atención no se puede distinguir un descuido de una respuesta al azar.',
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
        message: 'Se recomiendan al menos 3 ítems para que la escala sea interpretable.',
      });
    }
  }

  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    warnings.push({
      level: 'error',
      scope: 'ponderacion',
      message: 'Todos los pesos están en 0: el score compuesto no se puede calcular.',
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

  return warnings;
}
