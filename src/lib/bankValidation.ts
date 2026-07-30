// Validation of the question bank + config, as shown in the admin editor.
//
// Two rules shape the messages here:
//
//  1. Report the *cause*, not every symptom. "Aplicar 2 ítems por rasgo" is one
//     misconfigured field; reporting it once per trait produced five identical
//     errors pointing at five scales that were perfectly fine.
//  2. Every issue says where it is fixed (`anchor`) and, when the remedy is
//     unambiguous, offers it (`fix`). An error the admin cannot act on is just
//     noise on the screen.
//
// Kept free of any Firebase import so it can be tested directly.

import {
  PSYCHOMETRIC_SCALE_LABELS,
  PSYCHOMETRIC_TRAITS,
  type PsychometricLikertQuestion,
  type PsychometricQuestion,
  type PsychometricTestConfig,
} from '../types';

/** Fields of the configuration panel an issue can point at. */
export type BankConfigField =
  | 'likertPerTrait'
  | 'sjt'
  | 'deseabilidadSocial'
  | 'infrecuencia'
  | 'atencion'
  | 'minItemsPerScale'
  | 'bandCutoffs'
  | 'percentileCutoffs'
  | 'weights';

export type BankIssueAnchor =
  | { kind: 'question'; questionId: string }
  | { kind: 'section'; section: string }
  | { kind: 'config'; field: BankConfigField };

/** Remedies that are unambiguous enough to apply with one click. */
export type BankIssueFixId =
  | 'aplicar_minimo_por_rasgo'
  | 'aplicar_recomendado_por_rasgo'
  | 'aplicar_minimo_sjt'
  | 'aplicar_recomendado_sjt'
  | 'ordenar_cortes_absolutos'
  | 'ordenar_percentiles';

/**
 * Questions per trait below which a scale's score gets noticeably noisy. Eight
 * is where a short Likert scale usually reaches an acceptable reliability.
 */
export const RECOMMENDED_PER_TRAIT = 8;

/** Scenarios below which the SJT score bounces around too much between candidates. */
export const RECOMMENDED_SJT_SCENARIOS = 5;

export interface BankValidationIssue {
  level: 'error' | 'warning';
  message: string;
  anchor?: BankIssueAnchor;
  fix?: { id: BankIssueFixId; label: string };
  /** Kept for callers that still key issues by question. */
  questionId?: string;
}

/** Applies a one-click remedy. Returns a new config; never mutates. */
export function applyBankFix(
  fixId: BankIssueFixId,
  config: PsychometricTestConfig
): PsychometricTestConfig {
  switch (fixId) {
    case 'aplicar_minimo_por_rasgo':
      return {
        ...config,
        questionCounts: { ...config.questionCounts, likertPerTrait: config.minItemsPerScale },
      };
    case 'aplicar_recomendado_por_rasgo':
      return {
        ...config,
        questionCounts: { ...config.questionCounts, likertPerTrait: RECOMMENDED_PER_TRAIT },
      };
    case 'aplicar_minimo_sjt':
      return {
        ...config,
        questionCounts: { ...config.questionCounts, sjt: config.minItemsPerScale },
      };
    case 'aplicar_recomendado_sjt':
      return {
        ...config,
        questionCounts: { ...config.questionCounts, sjt: RECOMMENDED_SJT_SCENARIOS },
      };
    case 'ordenar_cortes_absolutos':
      return {
        ...config,
        bandCutoffs: { lowMax: config.bandCutoffs.highMin, highMin: config.bandCutoffs.lowMax },
      };
    case 'ordenar_percentiles':
      return {
        ...config,
        percentileCutoffs: {
          lowMaxPercentile: config.percentileCutoffs.highMinPercentile,
          highMinPercentile: config.percentileCutoffs.lowMaxPercentile,
        },
      };
  }
}

function label(scale: string): string {
  return PSYCHOMETRIC_SCALE_LABELS[scale as keyof typeof PSYCHOMETRIC_SCALE_LABELS] ?? scale;
}

/**
 * Checks the bank *before* it is saved. The server drops malformed items rather
 * than guessing, so catching these here is the difference between an admin
 * seeing the problem and a candidate silently taking a broken test.
 */
export function validateBank(
  questions: PsychometricQuestion[],
  config: PsychometricTestConfig
): BankValidationIssue[] {
  const issues: BankValidationIssue[] = [];
  const seen = new Set<string>();

  // ── Per-item checks ──
  for (const question of questions) {
    const at = (message: string, level: 'error' | 'warning' = 'error') =>
      issues.push({
        level,
        message,
        questionId: question.id,
        anchor: { kind: 'question', questionId: question.id },
      });

    if (seen.has(question.id)) at('Hay dos preguntas con el mismo identificador.');
    seen.add(question.id);

    if (!question.text.trim()) at('Falta el texto de la pregunta.');

    if (question.type === 'sjt') {
      const filled = question.options.filter((option) => option.text.trim());
      if (filled.length < 2) at('Un escenario necesita al menos 2 opciones con texto.');
      else if (new Set(filled.map((option) => option.score)).size < 2) {
        at('Todas las opciones tienen el mismo puntaje: el escenario no distingue nada.');
      }
    }

    if (question.type === 'attention' && (question.expectedValue < 1 || question.expectedValue > 5)) {
      at('La respuesta esperada del control de atención debe estar entre 1 y 5.');
    }
  }

  const enabled = questions.filter((question) => question.enabled);
  const likert = enabled.filter((q): q is PsychometricLikertQuestion => q.type === 'likert');
  const counts = config.questionCounts;

  // ── The sampling cap, checked once ──
  // When the cap itself is below the reporting minimum, every trait fails for
  // the same reason and the fix is a single field. Reporting it per trait sent
  // admins looking at scales that had plenty of items.
  const capBlocksEveryTrait = counts.likertPerTrait > 0 && counts.likertPerTrait < config.minItemsPerScale;
  if (capBlocksEveryTrait) {
    issues.push({
      level: 'error',
      message: `Cada candidato responde ${counts.likertPerTrait} preguntas por rasgo, y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje: así, ningún rasgo se podría calificar.`,
      anchor: { kind: 'config', field: 'likertPerTrait' },
      fix: { id: 'aplicar_minimo_por_rasgo', label: `Aplicar ${config.minItemsPerScale} por rasgo` },
    });
  }

  // The same cap, one notch up: it is not blocking, but it makes every trait
  // score noisier. Again a single field, so a single message — anchored at the
  // field and not at the traits, whose own items are perfectly fine.
  if (!capBlocksEveryTrait && counts.likertPerTrait > 0 && counts.likertPerTrait < RECOMMENDED_PER_TRAIT) {
    const capIsWhatBinds = PSYCHOMETRIC_TRAITS.some(
      (trait) => likert.filter((question) => question.scale === trait).length > counts.likertPerTrait
    );
    if (capIsWhatBinds) {
      issues.push({
        level: 'warning',
        message: `Cada candidato responde ${counts.likertPerTrait} preguntas por rasgo. Con tan pocas, el puntaje de cada rasgo sale con bastante margen de error: se recomiendan ${RECOMMENDED_PER_TRAIT} o más.`,
        anchor: { kind: 'config', field: 'likertPerTrait' },
        fix: {
          id: 'aplicar_recomendado_por_rasgo',
          label: `Aplicar ${RECOMMENDED_PER_TRAIT} por rasgo`,
        },
      });
    }
  }

  // ── Per-trait coverage ──
  // Everything below is about the bank being short, which is fixed by adding
  // questions to that scale — hence the anchor pointing at its section.
  for (const trait of PSYCHOMETRIC_TRAITS) {
    const items = likert.filter((question) => question.scale === trait);
    const anchor: BankIssueAnchor = { kind: 'section', section: trait };

    if (items.length === 0) {
      issues.push({
        level: 'error',
        message: `${label(trait)} no tiene preguntas activas: el rasgo no se podrá calificar.`,
        anchor,
      });
      continue;
    }

    if (items.length < config.minItemsPerScale) {
      issues.push({
        level: 'error',
        message: `${label(trait)} tiene ${items.length} preguntas activas y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje.`,
        anchor,
      });
    } else if (items.length < RECOMMENDED_PER_TRAIT) {
      issues.push({
        level: 'warning',
        message: `${label(trait)} tiene ${items.length} preguntas activas. Con menos de ${RECOMMENDED_PER_TRAIT} el puntaje del rasgo sale con más margen de error.`,
        anchor,
      });
    }

    const reversed = items.filter((question) => question.reverseScored).length;
    if (reversed === 0 || reversed === items.length) {
      issues.push({
        level: 'warning',
        message: `${label(trait)}: todas las preguntas están redactadas en el mismo sentido. Conviene marcar algunas como "invertidas" (donde estar de acuerdo sea lo desfavorable), porque hay gente que tiende a decir que sí a todo.`,
        anchor,
      });
    }
  }

  // ── SJT scenarios ──
  // Mirrors the trait logic above: a cap-side issue (the session applies too
  // few) is distinct from a pool-side issue (the bank itself is short), and
  // each is reported — and fixed — where it actually lives.
  const sjtPool = enabled.filter((question) => question.type === 'sjt').length;

  const sjtCapBlocksScoring = counts.sjt > 0 && counts.sjt < config.minItemsPerScale;
  if (sjtCapBlocksScoring) {
    issues.push({
      level: 'error',
      message: `Cada candidato responde ${counts.sjt} escenarios, y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje al juicio situacional.`,
      anchor: { kind: 'config', field: 'sjt' },
      fix: { id: 'aplicar_minimo_sjt', label: `Aplicar ${config.minItemsPerScale} escenarios` },
    });
  } else if (counts.sjt > 0 && counts.sjt < RECOMMENDED_SJT_SCENARIOS && sjtPool > counts.sjt) {
    issues.push({
      level: 'warning',
      message: `Cada candidato responde ${counts.sjt} escenarios. Con menos de ${RECOMMENDED_SJT_SCENARIOS}, el puntaje de juicio situacional varía mucho de un candidato a otro.`,
      anchor: { kind: 'config', field: 'sjt' },
      fix: { id: 'aplicar_recomendado_sjt', label: `Aplicar ${RECOMMENDED_SJT_SCENARIOS} escenarios` },
    });
  }

  if (sjtPool === 0) {
    issues.push({
      level: 'error',
      message: 'No hay escenarios de juicio situacional activos: no se podrá calificar el juicio situacional.',
      anchor: { kind: 'section', section: 'sjt' },
    });
  } else if (sjtPool < config.minItemsPerScale) {
    issues.push({
      level: 'error',
      message: `Hay ${sjtPool} escenarios activos y hacen falta al menos ${config.minItemsPerScale} para poder darle un puntaje al juicio situacional.`,
      anchor: { kind: 'section', section: 'sjt' },
    });
  } else if (!sjtCapBlocksScoring && sjtPool < RECOMMENDED_SJT_SCENARIOS) {
    issues.push({
      level: 'warning',
      message: `Hay ${sjtPool} escenarios activos. Se recomiendan ${RECOMMENDED_SJT_SCENARIOS} o más para variar la prueba entre candidatos.`,
      anchor: { kind: 'section', section: 'sjt' },
    });
  }

  // ── Attention checks ──
  const checks = enabled.filter((question) => question.type === 'attention').length;
  if (counts.atencion > 0 && checks === 0) {
    issues.push({
      level: 'error',
      message: 'La configuración aplica controles de atención pero no hay ninguno activo en el banco.',
      anchor: { kind: 'section', section: 'atencion' },
    });
  } else if (Math.min(counts.atencion, checks) < 2) {
    // Point at whichever side is actually the limit: the cap or the bank.
    const limitedByConfig = counts.atencion > 0 && counts.atencion < 2;
    issues.push({
      level: 'warning',
      message: limitedByConfig
        ? `Se aplica ${counts.atencion} pregunta de control por sesión. Con menos de 2 no se puede distinguir un descuido de alguien que responde sin leer.`
        : `Hay ${checks} pregunta(s) de control activa(s). Con menos de 2 no se puede distinguir un descuido de alguien que responde sin leer.`,
      anchor: limitedByConfig
        ? { kind: 'config', field: 'atencion' }
        : { kind: 'section', section: 'atencion' },
    });
  }

  // ── Scoring configuration ──
  if (config.bandCutoffs.lowMax >= config.bandCutoffs.highMin) {
    issues.push({
      level: 'error',
      message: `El corte absoluto de "bajo" (${config.bandCutoffs.lowMax}) debe ser menor que el de "alto" (${config.bandCutoffs.highMin}).`,
      anchor: { kind: 'config', field: 'bandCutoffs' },
      fix: { id: 'ordenar_cortes_absolutos', label: 'Invertir los cortes' },
    });
  }
  if (config.percentileCutoffs.lowMaxPercentile >= config.percentileCutoffs.highMinPercentile) {
    issues.push({
      level: 'error',
      message: `El percentil de "bajo" (${config.percentileCutoffs.lowMaxPercentile}) debe ser menor que el de "alto" (${config.percentileCutoffs.highMinPercentile}).`,
      anchor: { kind: 'config', field: 'percentileCutoffs' },
      fix: { id: 'ordenar_percentiles', label: 'Invertir los percentiles' },
    });
  }
  if (Object.values(config.weights).reduce((sum, weight) => sum + weight, 0) <= 0) {
    issues.push({
      level: 'error',
      message: 'Todos los pesos están en 0, así que no se puede calcular el puntaje general.',
      anchor: { kind: 'config', field: 'weights' },
    });
  }

  return issues;
}
