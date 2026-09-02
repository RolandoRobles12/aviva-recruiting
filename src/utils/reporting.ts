import type { Candidate, CandidateStatus } from '../types';

/**
 * Operations reporting: one row per promoter who actually joined, with the
 * dimensions operations asks for — fecha de ingreso, promotor, plaza, vertical,
 * solicitudes diarias promedio and the Promotor Exitoso verdict.
 */

// ─── Vertical ─────────────────────────────────────────────────────────────────

/**
 * Verticals as operations names them, keyed by the Viterbit department profile.
 * The names live here, not in Viterbit: the branch roles come across as "Trainee
 * Sucursal (Kiosk Trainee)" and "Gerente de Sucursal (Kiosk Manager)" but the
 * vertical operations reports on is Aviva Contigo, so the mapping renames them.
 * "Aviva tu Compra CM" (Casa Marchand) is its own vertical, not a variant of
 * "Aviva tu Compra", so it must be matched before the shorter name — the list
 * is sorted longest-first for exactly that reason.
 */
const VERTICAL_BY_PROFILE: Record<string, string> = {
  'Promotor/a Aviva tu Compra CM': 'Aviva tu Compra CM',
  'Promotor/a Aviva tu Compra':    'Aviva tu Compra',
  'Promotor/a Aviva tu Negocio':   'Aviva tu Negocio',
  'Promotor/a Aviva tu Casa':      'Aviva tu Casa',
  'Trainee Sucursal':              'Aviva Contigo',
  'Gerente de Sucursal':           'Aviva Contigo',
};

/** Mirrors functions/src/performance/targets.ts so both read the same profiles. */
function normalizeProfile(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\/a\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_VERTICALS = Object.entries(VERTICAL_BY_PROFILE)
  .map(([profile, vertical]) => ({ normalized: normalizeProfile(profile), vertical }))
  .sort((a, b) => b.normalized.length - a.normalized.length);

export const SIN_VERTICAL = 'Sin vertical';

/** Label for a grouping key the candidate has no value for (plaza, ciudad). */
export const SIN_DATO = 'Sin dato';

/**
 * The vertical of a candidate, from their canonical profile and, when that is
 * missing, the job title — which carries a store suffix ("Promotor/a Aviva tu
 * Compra - Sucursal Centro"), so matching is by containment, not equality.
 */
export function resolveVertical(
  profile: string | undefined | null,
  position?: string | undefined | null,
): string {
  for (const source of [profile, position]) {
    if (!source) continue;
    const normalized = normalizeProfile(source);
    if (!normalized) continue;

    const match =
      NORMALIZED_VERTICALS.find((v) => v.normalized === normalized) ??
      NORMALIZED_VERTICALS.find((v) => normalized.includes(v.normalized));
    if (match) return match.vertical;
  }
  // An unmapped profile is still worth reporting under its own name — a new
  // vertical in Viterbit would otherwise silently pile up under one bucket.
  return profile?.trim() || position?.trim() || SIN_VERTICAL;
}

// ─── Solicitudes diarias ──────────────────────────────────────────────────────

export interface DealAverage {
  /** Deals counted by the performance check (HubSpot). */
  deals: number;
  /** Length in days of the window those deals were counted over. */
  days: 15 | 30;
  average: number;
}

/**
 * Average daily applications for a promoter.
 *
 * The HubSpot deal counts stored on the candidate are measured over closed
 * windows (15 and 30 days from the start date), so the average is the count
 * divided by that window — dividing by the days elapsed since they joined would
 * shrink the number of anyone more than 30 days in, since the count stops there.
 * The 30-day window wins when both exist: it is the one the verdict uses.
 */
export function dealAverage(candidate: Candidate): DealAverage | null {
  if (typeof candidate.performance30DayDeals === 'number') {
    return { deals: candidate.performance30DayDeals, days: 30, average: candidate.performance30DayDeals / 30 };
  }
  if (typeof candidate.performance15DayDeals === 'number') {
    return { deals: candidate.performance15DayDeals, days: 15, average: candidate.performance15DayDeals / 15 };
  }
  return null;
}

// ─── Promotor exitoso ─────────────────────────────────────────────────────────

/** 'pendiente' = still inside the 30-day window, or not yet evaluated. */
export type PromotorOutcome = 'si' | 'no' | 'pendiente' | 'baja';

export const OUTCOME_LABELS: Record<PromotorOutcome, string> = {
  si: 'Sí',
  no: 'No',
  pendiente: 'Pendiente',
  baja: 'Baja',
};

/**
 * Mirrors the status the daily performance check writes, rather than
 * re-deciding it here: the report must never disagree with Viterbit.
 */
export function promotorOutcome(candidate: Candidate): PromotorOutcome {
  if (candidate.status === 'promotor_exitoso') return 'si';
  if (candidate.status === 'bajo_desempeno') return 'no';
  if (candidate.status === 'disqualified') return 'baja';
  return 'pendiente';
}

/** Days from the start date to the verdict, matching the 30-day performance check. */
export const EVALUATION_WINDOW_DAYS = 30;

/**
 * The check that settles the verdict runs once a day at 09:00 Mexico City, so a
 * promoter whose day 30 just passed is waiting on the next run, not stuck. The
 * grace keeps them out of the alert until the run has had its turn.
 */
export const EVALUATION_GRACE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a promoter is still pending after their 30 days are up — each value is a
 * distinct dead end in the performance pipeline, not a state of the promoter:
 *
 *  - sin_fecha: no parseable start date, so signContract never scheduled the
 *    15/30-day checks and there is nothing to process;
 *  - sin_hubspot: neither a HubSpot owner id nor a corporate email, so the daily
 *    check skips the candidate and retries forever — there are no deals to count
 *    until the accounts exist. A missing owner id alone is NOT this case: the
 *    check recovers it from the corporate email (findOwnerIdByEmail) the first
 *    time it processes them;
 *  - sin_conteo: everything is in place but no count was ever recorded — the
 *    check doc was never created (contract signed before this flow existed, or
 *    the fire-and-forget write failed) or HubSpot kept failing.
 */
export type PendingIssue = 'sin_fecha' | 'sin_hubspot' | 'sin_conteo';

export const PENDING_ISSUE_LABELS: Record<PendingIssue, string> = {
  sin_fecha:   'sin fecha de ingreso registrada',
  sin_hubspot: 'sin cuentas corporativas provisionadas',
  sin_conteo:  'sin conteo de solicitudes registrado',
};

export const PENDING_ISSUE_HINTS: Record<PendingIssue, string> = {
  sin_fecha:   'Sin fecha de ingreso no se programaron sus cortes de 15 y 30 días. Captura la fecha en Viterbit y actualiza al candidato.',
  sin_hubspot: 'El corte diario lo salta porque no tiene correo corporativo ni usuario de HubSpot con qué contar sus solicitudes: primero hay que provisionar sus cuentas.',
  sin_conteo:  'Ya pasaron 30 días y nunca se registró su conteo. Corre "Evaluar desempeño ahora" en Configuración → Admin.',
};

/**
 * A promoter past their 30 days with no verdict is a stuck pipeline, not a
 * pending evaluation, so the report names the dead end instead of filing them
 * under "aún no le toca".
 */
function resolvePendingIssue(
  candidate: Candidate,
  startDate: Date | null,
  outcome: PromotorOutcome,
  now: Date,
): PendingIssue | null {
  if (outcome !== 'pendiente') return null;
  if (!startDate) return 'sin_fecha';

  const dueMs = startDate.getTime() + (EVALUATION_WINDOW_DAYS + EVALUATION_GRACE_DAYS) * DAY_MS;
  if (dueMs > now.getTime()) return null;

  // El corte diario recupera el hubspotOwnerId desde el correo corporativo, así
  // que solo es bloqueo de HubSpot cuando tampoco hay correo del cual partir.
  if (!candidate.hubspotOwnerId && !candidate.corporateEmail) return 'sin_hubspot';
  return 'sin_conteo';
}

// ─── Start date ───────────────────────────────────────────────────────────────

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Start dates are stored as ISO ("2026-07-15") since the Viterbit sync started
 * writing viterbitStartDateIso; older candidates only carry the Spanish display
 * text ("15 de julio de 2026"), so both shapes must parse.
 */
export function parseStartDate(candidate: Candidate): Date | null {
  for (const value of [candidate.viterbitStartDateIso, candidate.viterbitStartDate]) {
    if (!value) continue;
    const v = value.trim();

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (iso) {
      const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (!isNaN(date.getTime())) return date;
      continue;
    }

    const spanish = /^(\d{1,2})\s+de\s+([a-záéíóúü]+)\s+de\s+(\d{4})$/.exec(
      v.normalize('NFC').toLowerCase(),
    );
    if (spanish) {
      const month = SPANISH_MONTHS.indexOf(spanish[2]);
      if (month !== -1) {
        const date = new Date(Number(spanish[3]), month, Number(spanish[1]));
        if (!isNaN(date.getTime())) return date;
      }
    }
  }
  return null;
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/** Statuses a candidate holds once they have signed and joined. */
export const JOINED_STATUSES: CandidateStatus[] = [
  'contract_signed',
  'email_pending',
  'email_ready',
  'induction',
  'onboarding_iniciado',
  'promotor_exitoso',
  'bajo_desempeno',
];

export interface ReportRow {
  id: string;
  startDate: Date | null;
  name: string;
  plaza: string;
  city: string;
  vertical: string;
  dealAverage: DealAverage | null;
  outcome: PromotorOutcome;
  /** Set only when the promoter is stuck: pending with their 30 days already up. */
  pendingIssue: PendingIssue | null;
}

export function toReportRow(candidate: Candidate, now = new Date()): ReportRow {
  const startDate = parseStartDate(candidate);
  const outcome = promotorOutcome(candidate);

  return {
    id: candidate.id,
    startDate,
    name: `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim(),
    plaza: candidate.plaza?.trim() ?? '',
    city: candidate.plazaCity?.trim() ?? '',
    vertical: resolveVertical(candidate.profile ?? candidate.viterbitDepartmentProfile, candidate.position),
    dealAverage: dealAverage(candidate),
    outcome,
    pendingIssue: resolvePendingIssue(candidate, startDate, outcome, now),
  };
}

/**
 * The promoters the report covers: everyone who joined, plus the ones
 * disqualified after signing — they worked, and dropping them would flatter the
 * success rate.
 */
export function buildReportRows(candidates: Candidate[], now = new Date()): ReportRow[] {
  return candidates
    .filter((c) =>
      JOINED_STATUSES.includes(c.status) ||
      (c.status === 'disqualified' && !!c.contractSignedAt))
    .map((c) => toReportRow(c, now))
    .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

/**
 * Filters that pick *which* promoters the dashboard is about — a store, a
 * vertical, a name. Rotation history honours these: "las plazas de Aviva tu
 * Casa" is still a question about whole plazas.
 */
export interface DimensionFilters {
  search?: string;
  vertical?: string;
  plaza?: string;
}

/**
 * Filters that cut a slice out of each promoter's history — a hiring window, a
 * verdict. Rotation deliberately ignores these: a plaza that burned through
 * four people over a year is a difficult plaza even when you are looking at
 * August, and counting only the ones who failed would not be counting hires
 * any more.
 */
/** 'atrasado' selects the stuck promoters rather than one of the four outcomes. */
export type OutcomeFilter = 'all' | PromotorOutcome | 'atrasado';

export interface SliceFilters {
  outcome?: OutcomeFilter;
  /** ISO dates, inclusive. */
  from?: string;
  to?: string;
}

export function filterByDimensions(rows: ReportRow[], filters: DimensionFilters): ReportRow[] {
  const term = filters.search?.trim().toLowerCase() ?? '';
  return rows.filter((row) => {
    if (term && !`${row.name} ${row.plaza} ${row.city}`.toLowerCase().includes(term)) return false;
    if (filters.vertical && row.vertical !== filters.vertical) return false;
    if (filters.plaza && row.plaza !== filters.plaza) return false;
    return true;
  });
}

export function filterBySlice(rows: ReportRow[], filters: SliceFilters): ReportRow[] {
  return rows.filter((row) => {
    if (filters.outcome === 'atrasado') {
      if (!row.pendingIssue) return false;
    } else if (filters.outcome && filters.outcome !== 'all' && row.outcome !== filters.outcome) {
      return false;
    }
    const iso = formatIsoDate(row.startDate);
    // A promoter with no parseable start date cannot be placed in a window, so
    // any date bound excludes them rather than silently keeping them in.
    if (filters.from && (!iso || iso < filters.from)) return false;
    if (filters.to && (!iso || iso > filters.to)) return false;
    return true;
  });
}

// ─── Agregados para el dashboard ──────────────────────────────────────────────

/** Reading order of the outcomes: settled verdicts first, then who is still open. */
export const OUTCOME_ORDER: PromotorOutcome[] = ['si', 'no', 'baja', 'pendiente'];

export interface OutcomeCounts {
  si: number;
  no: number;
  baja: number;
  pendiente: number;
  total: number;
  /** Promoters with a settled 30-day verdict (sí + no) — the success-rate denominator. */
  evaluados: number;
  /** Share of evaluated promoters who made it, or null while nobody is evaluated. */
  tasaExito: number | null;
}

export function countOutcomes(rows: ReportRow[]): OutcomeCounts {
  const counts = { si: 0, no: 0, baja: 0, pendiente: 0 };
  for (const row of rows) counts[row.outcome]++;

  const evaluados = counts.si + counts.no;
  return {
    ...counts,
    total: rows.length,
    evaluados,
    // A promoter still inside their 30-day window is not a failure, so they stay
    // out of the denominator — otherwise every fresh cohort drags the rate down.
    tasaExito: evaluados > 0 ? counts.si / evaluados : null,
  };
}

export interface OutcomeGroup {
  key: string;
  counts: OutcomeCounts;
}

/**
 * Outcomes grouped by any dimension (vertical, plaza, ciudad), ordered by how
 * much evidence each group carries: a 100% rate over two promoters should not
 * outrank a 70% rate over forty.
 */
export function groupOutcomes(rows: ReportRow[], keyOf: (row: ReportRow) => string): OutcomeGroup[] {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = keyOf(row) || SIN_DATO;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return Array.from(groups.entries())
    .map(([key, groupRows]) => ({ key, counts: countOutcomes(groupRows) }))
    .sort((a, b) =>
      b.counts.evaluados - a.counts.evaluados ||
      b.counts.total - a.counts.total ||
      a.key.localeCompare(b.key));
}

export interface PlazaRotation {
  /** Plazas that already hired more than once, most hires first. */
  plazas: OutcomeGroup[];
  /** Plazas with at least one hire — the denominator of the rotation share. */
  totalPlazas: number;
  /** How many of those plazas already needed a second person. */
  conRotacion: number;
}

/**
 * Hiring repeated on the same store, which is a warning sign rather than a
 * ranking of good plazas: a store only opens a second vacancy because the first
 * promoter left, so more hires on one plaza means the seat is not holding.
 *
 * Rows with no plaza are dropped: they are different unknown stores, and piling
 * them into one bucket would invent the worst plaza in the report.
 */
export function plazaRotation(rows: ReportRow[]): PlazaRotation {
  const groups = groupOutcomes(rows.filter((r) => r.plaza), (r) => r.plaza);
  const repetidas = groups.filter((g) => g.counts.total > 1);

  return {
    plazas: [...repetidas].sort((a, b) =>
      b.counts.total - a.counts.total || a.key.localeCompare(b.key)),
    totalPlazas: groups.length,
    conRotacion: repetidas.length,
  };
}

export interface StuckPending {
  total: number;
  /** Dead ends, biggest first — what to go fix, in order. */
  byIssue: { issue: PendingIssue; total: number }[];
}

/** Promoters whose 30 days are up but who never got a verdict, by dead end. */
export function stuckPending(rows: ReportRow[]): StuckPending {
  const counts = new Map<PendingIssue, number>();
  for (const row of rows) {
    if (row.pendingIssue) counts.set(row.pendingIssue, (counts.get(row.pendingIssue) ?? 0) + 1);
  }

  return {
    total: rows.filter((r) => r.pendingIssue).length,
    byIssue: Array.from(counts.entries())
      .map(([issue, total]) => ({ issue, total }))
      .sort((a, b) => b.total - a.total),
  };
}

export interface FunnelStage {
  key: 'ingresaron' | 'evaluados' | 'exitosos';
  label: string;
  value: number;
  /** Conversion from the previous stage, null on the first one. */
  conversion: number | null;
}

/** Ingresaron → llegaron al corte de 30 días → alcanzaron la meta. */
export function funnelStages(rows: ReportRow[]): FunnelStage[] {
  const { total, evaluados, si } = countOutcomes(rows);
  return [
    { key: 'ingresaron', label: 'Ingresaron',            value: total,     conversion: null },
    { key: 'evaluados',  label: 'Evaluados a 30 días',   value: evaluados, conversion: total > 0 ? evaluados / total : null },
    { key: 'exitosos',   label: 'Promotor Exitoso',      value: si,        conversion: evaluados > 0 ? si / evaluados : null },
  ];
}

export interface MonthlyCohort {
  /** "2026-07" — sortable key. */
  month: string;
  /** "jul 26" — axis label. */
  label: string;
  counts: OutcomeCounts;
}

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Cohorts by month of hire, oldest first, capped to the most recent `limit`. */
export function monthlyCohorts(rows: ReportRow[], limit = 12): MonthlyCohort[] {
  const months = new Map<string, ReportRow[]>();
  for (const row of rows) {
    if (!row.startDate) continue;
    const month = formatIsoDate(row.startDate).slice(0, 7);
    const bucket = months.get(month);
    if (bucket) bucket.push(row);
    else months.set(month, [row]);
  }

  return Array.from(months.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([month, monthRows]) => ({
      month,
      label: `${MONTH_ABBR[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`,
      counts: countOutcomes(monthRows),
    }));
}

/** Average of the promoters who have a measured window; null when none do. */
export function averageDailyDeals(rows: ReportRow[]): number | null {
  const measured = rows.filter((r) => r.dealAverage);
  if (measured.length === 0) return null;
  return measured.reduce((acc, r) => acc + (r.dealAverage?.average ?? 0), 0) / measured.length;
}

// ─── Export ───────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'Fecha de ingreso',
  'Nombre promotor',
  'Plaza',
  'Ciudad',
  'Vertical',
  'Solicitudes diarias promedio',
  'Promotor exitoso',
];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatIsoDate(date: Date | null): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function rowsToCsv(rows: ReportRow[]): string {
  const body = rows.map((r) => [
    formatIsoDate(r.startDate),
    r.name,
    r.plaza,
    r.city,
    r.vertical,
    r.dealAverage ? r.dealAverage.average.toFixed(2) : '',
    // Un pendiente atorado sale con su motivo: la exportación es donde
    // operación los persigue, y "Pendiente" a secas no dice qué arreglar.
    r.pendingIssue
      ? `${OUTCOME_LABELS[r.outcome]} — ${PENDING_ISSUE_LABELS[r.pendingIssue]}`
      : OUTCOME_LABELS[r.outcome],
  ].map(csvCell).join(','));

  return [CSV_HEADERS.map(csvCell).join(','), ...body].join('\r\n');
}
