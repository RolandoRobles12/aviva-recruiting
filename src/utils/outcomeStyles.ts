import type { MonthlyCohort, OutcomeCounts, OutcomeGroup, PromotorOutcome } from './reporting';

/**
 * How each outcome is drawn in the operations dashboard.
 *
 * These are status colors, not series identity: Promotor Exitoso is the brand
 * green, Bajo Desempeño red, Baja amber, and "Pendiente" the de-emphasis gray,
 * since a promoter still inside their 30-day window has no verdict yet. The
 * three meaningful steps clear the CVD and normal-vision separation checks
 * against a white surface; green and gray sit below 3:1 contrast, so every mark
 * also carries a visible label and the table repeats every value.
 */
export const OUTCOME_COLORS: Record<PromotorOutcome, string> = {
  si:        '#16b877',
  no:        '#b3261e',
  baja:      '#d97706',
  pendiente: '#9ca3af',
};

/** Full names for legends and tooltips, where there is room to be explicit. */
export const OUTCOME_CHART_LABELS: Record<PromotorOutcome, string> = {
  si:        'Promotor Exitoso',
  no:        'Bajo Desempeño',
  baja:      'Baja',
  pendiente: 'Pendiente (sin corte de 30 días)',
};

/** One bar of an outcome-split stacked chart. */
export interface StackedBar {
  key: string;
  label: string;
  counts: OutcomeCounts;
}

export function cohortBars(cohorts: MonthlyCohort[]): StackedBar[] {
  return cohorts.map((c) => ({ key: c.month, label: c.label, counts: c.counts }));
}

export function groupBars(groups: OutcomeGroup[]): StackedBar[] {
  return groups.map((g) => ({ key: g.key, label: g.key, counts: g.counts }));
}
