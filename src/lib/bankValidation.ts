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
  | 'ordenar_cortes_absolutos'
  | 'ordenar_percentiles';

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
      message: `Se aplican ${counts.likertPerTrait} ítems por rasgo y el mínimo para reportar un puntaje es ${config.minItemsPerScale}: con esta configuración ningún rasgo se podría calificar.`,
      anchor: { kind: 'config', field: 'likertPerTrait' },
      fix: { id: 'aplicar_minimo_por_rasgo', label: `Aplicar ${config.minItemsPerScale} por rasgo` },
    });
  }

  // ── Per-trait coverage ──
  for (const trait of PSYCHOMETRIC_TRAITS) {
    const items = likert.filter((question) => question.scale === trait);
    const anchor: BankIssueAnchor = { kind: 'section', section: trait };

    if (items.length === 0) {
      issues.push({
        level: 'error',
        message: `${label(trait)} no tiene ítems activos: el rasgo no se podrá calificar.`,
        anchor,
      });
      continue;
    }

    const applied =
      counts.likertPerTrait > 0 ? Math.min(counts.likertPerTrait, items.length) : items.length;

    // Only report the bank being short — the config cap is reported once above.
    if (items.length < config.minItemsPerScale) {
      issues.push({
        level: 'error',
        message: `${label(trait)} tiene ${items.length} ítems activos y el mínimo para reportar un puntaje es ${config.minItemsPerScale}.`,
        anchor,
      });
    } else if (!capBlocksEveryTrait && applied < 6) {
      issues.push({
        level: 'warning',
        message: `${label(trait)}: con ${applied} ítems por sesión la consistencia interna suele quedar por debajo de .70.`,
        anchor,
      });
    }

    const reversed = items.filter((question) => question.reverseScored).length;
    if (reversed === 0 || reversed === items.length) {
      issues.push({
        level: 'warning',
        message: `${label(trait)}: todos los ítems van en la misma dirección. Mezcla normales e invertidos para controlar el sesgo de aquiescencia.`,
        anchor,
      });
    }
  }

  // ── Scenarios and attention checks ──
  if (!enabled.some((question) => question.type === 'sjt')) {
    issues.push({
      level: 'warning',
      message: 'No hay escenarios de juicio situacional activos.',
      anchor: { kind: 'section', section: 'sjt' },
    });
  }

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
        ? `Se aplica ${counts.atencion} control de atención por sesión: con menos de 2 no se distingue un descuido de responder al azar.`
        : `Hay ${checks} control(es) de atención activo(s): con menos de 2 no se distingue un descuido de responder al azar.`,
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
      message: 'Todos los pesos están en 0: no se puede calcular el score compuesto.',
      anchor: { kind: 'config', field: 'weights' },
    });
  }

  return issues;
}
