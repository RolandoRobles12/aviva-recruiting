import { parse, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * `viterbitStartDate` is stored as Spanish display text ("15 de julio de 2026")
 * for offer letters, contracts, and the dashboard. `viterbitStartDateIso`
 * ("2026-07-15") is the canonical machine-readable value written alongside it
 * for new/refreshed candidates. Legacy candidates only have the Spanish string,
 * so every parse must accept both formats.
 */

/** Parses an ISO date/datetime or Spanish display date to UTC midnight. */
export function parseStartDateString(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (isoMatch) {
    const date = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
    return isNaN(date.getTime()) ? null : date;
  }

  const parsed = parse(v, "d 'de' MMMM 'de' yyyy", new Date(), { locale: es });
  if (!isValid(parsed)) return null;
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

/** Resolves a candidate's start date, preferring the ISO field over the display text. */
export function parseCandidateStartDate(candidate: Record<string, unknown>): Date | null {
  return (
    parseStartDateString(candidate.viterbitStartDateIso as string | undefined) ??
    parseStartDateString(candidate.viterbitStartDate as string | undefined)
  );
}

/** Normalizes any accepted start-date format to "YYYY-MM-DD" ('' when unparseable). */
export function toIsoDateString(value: string | null | undefined): string {
  return parseStartDateString(value)?.toISOString().slice(0, 10) ?? '';
}
