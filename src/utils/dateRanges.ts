import { eachDayOfInterval, endOfMonth as endOfMonthFns, endOfWeek, startOfMonth as startOfMonthFns, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
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

// ─── Calendario ───────────────────────────────────────────────────────────────

/** Parses the "YYYY-MM-DD" the inputs and the filter speak; null when empty or malformed. */
export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * The weeks a month calendar draws, padded with the neighbouring days so every
 * row is a full week. Days outside the month are kept (not nulled) so the grid
 * can dim them and still let a click land on them.
 */
export function monthMatrix(month: Date): Date[][] {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonthFns(month), { locale: es }),
    end: endOfWeek(endOfMonthFns(month), { locale: es }),
  });

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** True when `day` falls inside [from, to], with either end open. */
export function isWithinRange(day: Date, from: Date | null, to: Date | null): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return Boolean(from || to);
}

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const shortDate = (date: Date) => `${date.getDate()} ${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;

/**
 * What the picker's button reads: the name of the preset when the range is one,
 * and the span itself otherwise — collapsed when both ends share a month, so a
 * single month reads "1 – 31 jul 2026" instead of repeating itself.
 */
export function formatRangeLabel(range: DateRange, today = new Date()): string {
  const preset = detectDateRangePreset(range, today);
  if (preset !== 'personalizado') {
    return DATE_PRESETS.find((p) => p.value === preset)?.label ?? 'Todo el histórico';
  }

  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (from && !to) return `Desde ${shortDate(from)}`;
  if (!from && to) return `Hasta ${shortDate(to)}`;
  if (!from || !to) return 'Todo el histórico';

  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return `${from.getDate()} – ${shortDate(to)}`;
  }
  return `${shortDate(from)} – ${shortDate(to)}`;
}
