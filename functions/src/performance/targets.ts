/**
 * Monthly deal targets and performance-window arithmetic.
 *
 * Kept free of firebase-admin / firebase-functions imports so it can be unit
 * tested directly (see tests/performanceTargets.test.ts).
 */

// ─── Monthly deal targets by Viterbit profile ────────────────────────────────
export const DEAL_TARGETS_BY_PROFILE: Record<string, number> = {
  'Promotor/a Aviva tu Compra':           34,
  'Promotor/a Aviva tu Compra CM':        17,
  'Promotor/a Aviva tu Compra (Comodín)':        34,
  'Promotor/a Aviva tu Compra (Temporal)':       34,
  'Promotor/a Aviva tu Compra (Internalización)': 34,
  'Promotor/a Aviva tu Negocio':          17,
  'Promotor/a Aviva tu Casa':             17,
  'Trainee Sucursal (Kiosk Trainee)':     72,
  'Gerente de Sucursal (Kiosk Manager)':  72,
};

/** Used only when no configured profile can be recognised at all. */
export const DEFAULT_MONTHLY_TARGET = 17;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lowercase, strip accents, drop the "/a" gender suffix and collapse
 * whitespace, so "Promotor Aviva tu Compra  - Sucursal Centro" and
 * "Promotor/a Aviva tu Compra" reduce to comparable forms.
 */
function normalizeProfile(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\/a\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Configured profiles, longest first — "… Compra CM" must win over "… Compra". */
const NORMALIZED_TARGETS: { normalized: string; profile: string; target: number }[] =
  Object.entries(DEAL_TARGETS_BY_PROFILE)
    .map(([profile, target]) => ({ normalized: normalizeProfile(profile), profile, target }))
    .sort((a, b) => b.normalized.length - a.normalized.length);

export interface ResolvedTarget {
  target: number;
  /** The configured profile that matched, or null when the default was used. */
  matchedProfile: string | null;
}

/**
 * Resolve the monthly deal target for a candidate.
 *
 * `profile` is the canonical Viterbit department profile, but it can be empty
 * when the job's profile lookup failed at webhook time. The fallback is the job
 * title, which carries a store suffix ("Promotor/a Aviva tu Compra - Sucursal
 * Centro"), so an exact-key lookup misses it and silently returns the default —
 * that made a 34-deal promoter be judged against 17. Match exactly first, then
 * by longest configured profile contained in the string.
 */
export function resolveMonthlyTarget(
  profile: string | undefined | null,
  position?: string | undefined | null,
): ResolvedTarget {
  for (const source of [profile, position]) {
    if (!source) continue;
    const normalized = normalizeProfile(source);
    if (!normalized) continue;

    const exact = NORMALIZED_TARGETS.find((t) => t.normalized === normalized);
    if (exact) return { target: exact.target, matchedProfile: exact.profile };

    const partial = NORMALIZED_TARGETS.find((t) => normalized.includes(t.normalized));
    if (partial) return { target: partial.target, matchedProfile: partial.profile };
  }

  return { target: DEFAULT_MONTHLY_TARGET, matchedProfile: null };
}

/**
 * Statuses a candidate can hold when the 30-day verdict is applied
 * retroactively (daily sweep, or the recalculation tool). Deliberately excludes
 * promotor_exitoso, bajo_desempeno and disqualified — those are settled and are
 * never overwritten — as well as the in-flight offer/contract statuses, so a
 * retroactive pass never yanks a candidate out of a live flow.
 */
export const VERDICT_APPLIES_STATUSES = [
  'contract_signed',
  'email_pending',
  'email_ready',
  'induction',
  'onboarding_iniciado',
];

export interface PerformanceWindow {
  fromMs: number;
  toMs: number;
}

/**
 * The closed [start, start + daysMark] window a check measures.
 *
 * Deal counts are compared against a *monthly* target, so the query must be
 * bounded on both ends: an open-ended "created since start date" count run late
 * (a backfilled check, or a retroactive recalculation) accumulates every deal
 * since the candidate joined and inflates the result without limit. Bounding it
 * makes the count reproducible — the same window yields the same number
 * whenever it is evaluated. Mirrors the arithmetic signContract uses to
 * schedule the checks.
 */
export function performanceWindow(startDate: Date, daysMark: number): PerformanceWindow {
  const fromMs = startDate.getTime();
  return { fromMs, toMs: fromMs + daysMark * DAY_MS };
}
