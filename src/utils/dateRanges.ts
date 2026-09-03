import { formatIsoDate } from './reporting';

/**
 * Ready-made ranges for the hiring-date filter.
 *
 * Picking a month out of two native date inputs means dragging the calendar
 * back one month at a time, twice — and the second input opens on today again,
 * so the work is done twice over. These cover the ranges operations actually
 * asks for in one click; the inputs stay visible and filled in, so the range is
 * never a mystery and can still be adjusted by hand.
 */
export type DateRangePreset =
  | 'todo'
  | 'mes_actual'
  | 'mes_pasado'
  | 'ultimos_30'
  | 'ultimos_90'
  | 'anio_actual'
  | 'personalizado';

export interface DateRange {
  from: string;
  to: string;
}

const startOfMonth = (date: Date, offset = 0) =>
  new Date(date.getFullYear(), date.getMonth() + offset, 1);

/** Day 0 of the next month is the last day of this one. */
const endOfMonth = (date: Date, offset = 0) =>
  new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);

const daysAgo = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);

/** 'personalizado' is deliberately absent: it is what a range matches nothing else. */
export const DATE_PRESETS: { value: Exclude<DateRangePreset, 'personalizado'>; label: string }[] = [
  { value: 'todo',        label: 'Todo el histórico' },
  { value: 'mes_actual',  label: 'Este mes' },
  { value: 'mes_pasado',  label: 'Mes pasado' },
  { value: 'ultimos_30',  label: 'Últimos 30 días' },
  { value: 'ultimos_90',  label: 'Últimos 90 días' },
  { value: 'anio_actual', label: 'Este año' },
];

export function resolveDateRange(preset: DateRangePreset, today = new Date()): DateRange {
  switch (preset) {
    case 'mes_actual':
      return { from: formatIsoDate(startOfMonth(today)), to: formatIsoDate(endOfMonth(today)) };
    case 'mes_pasado':
      return { from: formatIsoDate(startOfMonth(today, -1)), to: formatIsoDate(endOfMonth(today, -1)) };
    case 'ultimos_30':
      // Inclusive of today, so "30 días" is 30 days of data, not 31.
      return { from: formatIsoDate(daysAgo(today, 29)), to: formatIsoDate(today) };
    case 'ultimos_90':
      return { from: formatIsoDate(daysAgo(today, 89)), to: formatIsoDate(today) };
    case 'anio_actual':
      return {
        from: formatIsoDate(new Date(today.getFullYear(), 0, 1)),
        to: formatIsoDate(new Date(today.getFullYear(), 11, 31)),
      };
    case 'todo':
    case 'personalizado':
      return { from: '', to: '' };
  }
}

/**
 * Which preset a range corresponds to, so the picker keeps showing the name of
 * what is on screen instead of falling to "personalizado" the moment it is set.
 */
export function detectDateRangePreset(range: DateRange, today = new Date()): DateRangePreset {
  if (!range.from && !range.to) return 'todo';

  for (const { value } of DATE_PRESETS) {
    const preset = resolveDateRange(value, today);
    if (preset.from === range.from && preset.to === range.to) return value;
  }

  return 'personalizado';
}
