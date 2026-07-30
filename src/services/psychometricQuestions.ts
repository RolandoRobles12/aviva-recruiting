import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  PSYCHOMETRIC_LIKERT_SCALES,
  PSYCHOMETRIC_TRAITS,
  type PsychometricLikertQuestion,
  type PsychometricLikertScale,
  type PsychometricQuestion,
  type PsychometricTestConfig,
} from '../types';

const QUESTIONS_DOC = doc(db, 'settings', 'psychometric_questions');
const CONFIG_DOC = doc(db, 'settings', 'psychometric_config');

// Structural defaults only (weights / cutoffs / sampling) — no question content
// is hardcoded here. The bank itself is either seeded from the curated starter
// bank (the "Cargar banco base" button, which runs server-side) or written item
// by item from the admin tab. Keep in step with
// functions/src/psychometricTest/defaultBank.ts, which is what the server applies.
const DEFAULT_PSYCHOMETRIC_CONFIG: PsychometricTestConfig = {
  weights: {
    responsabilidad: 0.25,
    integridad: 0.2,
    estabilidad_emocional: 0.2,
    sjt: 0.15,
    extraversion: 0.1,
    amabilidad: 0.1,
  },
  bandCutoffs: { lowMax: 55, highMin: 75 },
  percentileCutoffs: { lowMaxPercentile: 25, highMinPercentile: 75 },
  timeLimitMinutes: 35,
  questionCounts: {
    likertPerTrait: 8,
    sjt: 8,
    deseabilidadSocial: 4,
    infrecuencia: 3,
    atencion: 2,
  },
  minItemsPerScale: 4,
  useLocalNorms: true,
};

const VALID_LIKERT_SCALES = new Set<string>(PSYCHOMETRIC_LIKERT_SCALES);

/**
 * Brings a stored question up to the current shape. Items written before the
 * bank had scales carry `trait` instead, and all of them predate the attention
 * item type — read-time normalization is what keeps the editor from wiping
 * fields it does not understand.
 */
function normalizeQuestion(raw: unknown, index: number): PsychometricQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const question = raw as Record<string, unknown>;
  const id = typeof question.id === 'string' ? question.id : '';
  if (!id) return null;

  const text = typeof question.text === 'string' ? question.text : '';
  const enabled = question.enabled !== false;
  const order = typeof question.order === 'number' ? question.order : index;

  if (question.type === 'sjt') {
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const competency = typeof question.competency === 'string' ? question.competency : '';
    return {
      id,
      type: 'sjt',
      text,
      options: rawOptions.map((option) => {
        const record = (option ?? {}) as Record<string, unknown>;
        return {
          text: typeof record.text === 'string' ? record.text : '',
          score: typeof record.score === 'number' ? record.score : 0,
        };
      }),
      // Omitted when empty: the editor writes this object straight back to
      // Firestore, which rejects undefined values.
      ...(competency ? { competency } : {}),
      enabled,
      order,
    };
  }

  if (question.type === 'attention') {
    const expected = typeof question.expectedValue === 'number' ? question.expectedValue : 3;
    return { id, type: 'attention', text, expectedValue: expected, enabled, order };
  }

  const scaleCandidate =
    (typeof question.scale === 'string' && question.scale) ||
    (typeof question.trait === 'string' && question.trait) ||
    '';

  return {
    id,
    type: 'likert',
    scale: (VALID_LIKERT_SCALES.has(scaleCandidate)
      ? scaleCandidate
      : 'responsabilidad') as PsychometricLikertScale,
    text,
    reverseScored: question.reverseScored === true,
    enabled,
    order,
  };
}

export async function getPsychometricQuestions(): Promise<PsychometricQuestion[]> {
  const snap = await getDoc(QUESTIONS_DOC);
  const raw = snap.data()?.questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((question, index) => normalizeQuestion(question, index))
    .filter((question): question is PsychometricQuestion => question !== null)
    .sort((a, b) => a.order - b.order);
}

export async function savePsychometricQuestions(questions: PsychometricQuestion[]): Promise<void> {
  await setDoc(QUESTIONS_DOC, {
    // Likert items are rebuilt field by field so the legacy `trait` key is
    // dropped: it only ever existed as the pre-`scale` field, and keeping both
    // around invites the two disagreeing.
    questions: questions.map((question, index) => {
      if (question.type === 'likert') {
        return {
          id: question.id,
          type: question.type,
          scale: question.scale,
          text: question.text,
          reverseScored: question.reverseScored,
          enabled: question.enabled,
          order: index,
        };
      }
      return { ...question, order: index };
    }),
    updatedAt: serverTimestamp(),
  });
}

export async function getPsychometricConfig(): Promise<PsychometricTestConfig> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    await setDoc(CONFIG_DOC, DEFAULT_PSYCHOMETRIC_CONFIG);
    return DEFAULT_PSYCHOMETRIC_CONFIG;
  }
  // Merge with defaults so configs saved before a field existed (percentile
  // cutoffs, the integridad weight, the new sampling counts) don't come back
  // with it missing.
  const data = snap.data() as Partial<PsychometricTestConfig>;
  return {
    ...DEFAULT_PSYCHOMETRIC_CONFIG,
    ...data,
    weights: { ...DEFAULT_PSYCHOMETRIC_CONFIG.weights, ...(data.weights ?? {}) },
    bandCutoffs: { ...DEFAULT_PSYCHOMETRIC_CONFIG.bandCutoffs, ...(data.bandCutoffs ?? {}) },
    percentileCutoffs: {
      ...DEFAULT_PSYCHOMETRIC_CONFIG.percentileCutoffs,
      ...(data.percentileCutoffs ?? {}),
    },
    questionCounts: {
      ...DEFAULT_PSYCHOMETRIC_CONFIG.questionCounts,
      ...(data.questionCounts ?? {}),
    },
  };
}

export async function savePsychometricConfig(config: PsychometricTestConfig): Promise<void> {
  await setDoc(CONFIG_DOC, config);
}

// ─── Editor-side validation ───────────────────────────────────────────────────

export interface BankValidationIssue {
  level: 'error' | 'warning';
  questionId?: string;
  message: string;
}

/**
 * Checks the bank *before* it is saved. The server drops malformed items rather
 * than guessing, so catching these here is the difference between an admin
 * seeing the problem and a candidate silently taking a shorter test than the
 * configuration says.
 */
export function validateBank(
  questions: PsychometricQuestion[],
  config: PsychometricTestConfig
): BankValidationIssue[] {
  const issues: BankValidationIssue[] = [];
  const seen = new Set<string>();

  for (const question of questions) {
    if (seen.has(question.id)) {
      issues.push({
        level: 'error',
        questionId: question.id,
        message: 'Hay dos preguntas con el mismo identificador.',
      });
    }
    seen.add(question.id);

    if (!question.text.trim()) {
      issues.push({ level: 'error', questionId: question.id, message: 'Falta el texto de la pregunta.' });
    }

    if (question.type === 'sjt') {
      const filled = question.options.filter((option) => option.text.trim());
      if (filled.length < 2) {
        issues.push({
          level: 'error',
          questionId: question.id,
          message: 'Un escenario necesita al menos 2 opciones con texto.',
        });
      }
      const scores = new Set(filled.map((option) => option.score));
      if (filled.length >= 2 && scores.size < 2) {
        issues.push({
          level: 'error',
          questionId: question.id,
          message: 'Todas las opciones tienen el mismo puntaje: el escenario no distingue nada.',
        });
      }
    }

    if (question.type === 'attention' && (question.expectedValue < 1 || question.expectedValue > 5)) {
      issues.push({
        level: 'error',
        questionId: question.id,
        message: 'La respuesta esperada del control de atención debe estar entre 1 y 5.',
      });
    }
  }

  const enabled = questions.filter((question) => question.enabled);
  const likert = enabled.filter((q): q is PsychometricLikertQuestion => q.type === 'likert');

  for (const trait of PSYCHOMETRIC_TRAITS) {
    const items = likert.filter((question) => question.scale === trait);
    const applied =
      config.questionCounts.likertPerTrait > 0
        ? Math.min(config.questionCounts.likertPerTrait, items.length)
        : items.length;

    if (items.length === 0) {
      issues.push({ level: 'error', message: `El rasgo "${trait}" no tiene ítems activos.` });
      continue;
    }
    if (applied < config.minItemsPerScale) {
      issues.push({
        level: 'error',
        message: `"${trait}": se aplicarían ${applied} ítems y el mínimo para reportar puntaje es ${config.minItemsPerScale}.`,
      });
    } else if (applied < 6) {
      issues.push({
        level: 'warning',
        message: `"${trait}": con ${applied} ítems la consistencia interna suele quedar por debajo de .70.`,
      });
    }
    const reversed = items.filter((question) => question.reverseScored).length;
    if (reversed === 0 || reversed === items.length) {
      issues.push({
        level: 'warning',
        message: `"${trait}": todos los ítems van en la misma dirección. Mezcla normales e invertidos.`,
      });
    }
  }

  if (!enabled.some((question) => question.type === 'sjt')) {
    issues.push({ level: 'warning', message: 'No hay escenarios de juicio situacional activos.' });
  }

  const checks = enabled.filter((question) => question.type === 'attention').length;
  if (config.questionCounts.atencion > 0 && checks === 0) {
    issues.push({
      level: 'error',
      message: 'La configuración aplica controles de atención pero no hay ninguno activo en el banco.',
    });
  } else if (Math.min(config.questionCounts.atencion, checks) < 2) {
    issues.push({
      level: 'warning',
      message: 'Con menos de 2 controles de atención no se distingue un descuido de responder al azar.',
    });
  }

  if (config.bandCutoffs.lowMax >= config.bandCutoffs.highMin) {
    issues.push({ level: 'error', message: 'El corte de "bajo" debe ser menor que el de "alto".' });
  }
  if (config.percentileCutoffs.lowMaxPercentile >= config.percentileCutoffs.highMinPercentile) {
    issues.push({ level: 'error', message: 'Los percentiles de corte están invertidos.' });
  }
  if (Object.values(config.weights).reduce((a, b) => a + b, 0) <= 0) {
    issues.push({
      level: 'error',
      message: 'Todos los pesos están en 0: no se puede calcular el score compuesto.',
    });
  }

  return issues;
}
