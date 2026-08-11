/**
 * Single source of truth for "is this candidate ready to receive the offer
 * letter?".
 *
 * The offer is only emailed once every hiring detail is known in Viterbit:
 *
 *   - salario y fecha de inicio — they are printed on the letter itself
 *   - buró y psicometría de integridad — candidate-level Viterbit custom fields
 *     holding a link to each report; a value present means the result is in
 *
 * When anything is still unknown the candidate is created but parked in
 * `offer_held`; the recruiter fills the data in Viterbit, refreshes it from the
 * dashboard, and resends the letter.
 */

export interface HiringDetailFields {
  viterbitSalary?: unknown;
  viterbitStartDate?: unknown;
  viterbitBuro?: unknown;
  viterbitPsicometriaIntegridad?: unknown;
}

export type HiringDetailKey = keyof HiringDetailFields;

export const HIRING_DETAIL_LABELS: Record<HiringDetailKey, string> = {
  viterbitSalary: 'salario',
  viterbitStartDate: 'fecha de inicio',
  viterbitBuro: 'buró',
  viterbitPsicometriaIntegridad: 'psicometría de integridad',
};

export const HIRING_DETAIL_KEYS: HiringDetailKey[] = [
  'viterbitSalary',
  'viterbitStartDate',
  'viterbitBuro',
  'viterbitPsicometriaIntegridad',
];

/**
 * Placeholder values Viterbit users type (or pick from a select) to mean
 * "no result yet". They are treated as unknown so the offer stays held.
 * "No aplica" is deliberately NOT here — that is a real, known answer.
 */
const PENDING_VALUES = new Set([
  'pendiente',
  'pendiente de resultado',
  'pendientes',
  'en proceso',
  'en revision',
  'en revisión',
  'en curso',
  'sin resultado',
  'sin resultados',
  'por definir',
  'tbd',
  '-',
  '--',
]);

/** True when the field carries a real value (not empty, not a "pending" marker). */
export function isHiringDetailKnown(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !PENDING_VALUES.has(trimmed.toLowerCase());
}

/** Labels of the hiring details still unknown, in display order. */
export function getMissingHiringDetails(candidate: HiringDetailFields): string[] {
  return HIRING_DETAIL_KEYS
    .filter((key) => !isHiringDetailKnown(candidate[key]))
    .map((key) => HIRING_DETAIL_LABELS[key]);
}

/** "salario, buró y psicometría de integridad" */
export function formatMissingHiringDetails(missing: string[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) return missing[0];
  return `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`;
}
