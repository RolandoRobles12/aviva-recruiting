import type { Candidate } from '../types';

/**
 * Client-side mirror of functions/src/utils/hiringDetails.ts — kept in sync by
 * hand because the Vite build only compiles `src`. The backend re-checks this
 * gate on every send; this copy exists so buttons and alerts reflect it
 * instantly.
 *
 * The offer letter is only sent once salary, start date, buró and psicometría
 * de integridad are all known in Viterbit.
 */

export const HIRING_DETAIL_LABELS = {
  viterbitSalary: 'salario',
  viterbitStartDate: 'fecha de inicio',
  viterbitBuro: 'buró',
  viterbitPsicometriaIntegridad: 'psicometría de integridad',
} as const;

export type HiringDetailKey = keyof typeof HIRING_DETAIL_LABELS;

export const HIRING_DETAIL_KEYS: HiringDetailKey[] = [
  'viterbitSalary',
  'viterbitStartDate',
  'viterbitBuro',
  'viterbitPsicometriaIntegridad',
];

/** Values Viterbit uses for "no result yet" — treated as unknown. */
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

export function isHiringDetailKnown(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !PENDING_VALUES.has(trimmed.toLowerCase());
}

/**
 * The contract only prints salary and start date — buró and psicometría gate
 * the offer letter, not the contract, so legacy candidates who signed before
 * those fields existed are not blocked here.
 */
export const CONTRACT_HIRING_DETAIL_KEYS: HiringDetailKey[] = [
  'viterbitSalary',
  'viterbitStartDate',
];

/** Labels of the hiring details still unknown, in display order. */
export function getMissingHiringDetails(
  c: Partial<Candidate>,
  keys: HiringDetailKey[] = HIRING_DETAIL_KEYS,
): string[] {
  return keys
    .filter((key) => !isHiringDetailKnown(c[key]))
    .map((key) => HIRING_DETAIL_LABELS[key]);
}

/** "salario, buró y psicometría de integridad" */
export function formatMissingHiringDetails(missing: string[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) return missing[0];
  return `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`;
}
