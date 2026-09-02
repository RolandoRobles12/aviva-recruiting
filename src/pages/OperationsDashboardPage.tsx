import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ChartCard,
  Funnel,
  OutcomeDonut,
  OutcomeLegend,
  OutcomeStackedBars,
  SuccessRateBars,
} from '../components/dashboard/OperationsCharts';
import { OUTCOME_COLORS, cohortBars, groupBars } from '../utils/outcomeStyles';
import { useCandidates } from '../hooks/useCandidates';
import {
  OUTCOME_LABELS,
  averageDailyDeals,
  buildReportRows,
  countOutcomes,
  filterByDimensions,
  filterBySlice,
  formatIsoDate,
  funnelStages,
  groupOutcomes,
  monthlyCohorts,
  plazaRotation,
  rowsToCsv,
  type PromotorOutcome,
  type ReportRow,
} from '../utils/reporting';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatStartDate(date: Date | null): string {
  if (!date) return '—';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const OUTCOME_STYLES: Record<PromotorOutcome, string> = {
  si:        'bg-green-50 text-green-700',
  no:        'bg-red-50 text-red-700',
  pendiente: 'bg-gray-100 text-gray-600',
  baja:      'bg-amber-50 text-amber-700',
};

const OUTCOME_FILTERS: { value: 'all' | PromotorOutcome; label: string }[] = [
  { value: 'all', label: 'Todos los resultados' },
  { value: 'si', label: 'Promotor Exitoso' },
  { value: 'no', label: 'Bajo Desempeño' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'baja', label: 'Bajas' },
];

const PAGE_SIZES = [25, 50, 100];

/** Downloads the filtered rows as a CSV Excel opens with the accents intact. */
function downloadCsv(rows: ReportRow[]) {
  const blob = new Blob(['﻿', rowsToCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `promotores-${formatIsoDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function OperationsDashboardPage() {
  const { candidates, loading } = useCandidates();
  const [search, setSearch] = useState('');
  const [vertical, setVertical] = useState('');
  const [plaza, setPlaza] = useState('');
  const [outcome, setOutcome] = useState<'all' | PromotorOutcome>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const allRows = useMemo(() => buildReportRows(candidates), [candidates]);

  const verticals = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.vertical))).sort(),
    [allRows],
  );
  const plazas = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.plaza).filter(Boolean))).sort(),
    [allRows],
  );

  // Two scopes: everything reads the fully filtered slice, except the rotation
  // card, which is a historical property of the plaza and so keeps every hire
  // regardless of the date range and the outcome filter.
  const dimensionRows = useMemo(
    () => filterByDimensions(allRows, { search, vertical, plaza }),
    [allRows, search, vertical, plaza],
  );
  const rows = useMemo(
    () => filterBySlice(dimensionRows, { outcome, from, to }),
    [dimensionRows, outcome, from, to],
  );

  const counts = useMemo(() => countOutcomes(rows), [rows]);
  const stages = useMemo(() => funnelStages(rows), [rows]);
  const solicitudes = useMemo(() => averageDailyDeals(rows), [rows]);
  const byVertical = useMemo(() => groupOutcomes(rows, (r) => r.vertical), [rows]);
  const rotation = useMemo(() => plazaRotation(dimensionRows), [dimensionRows]);
  const cohorts = useMemo(() => monthlyCohorts(rows), [rows]);

  // Clamped rather than reset in an effect, so changing a filter cannot leave the
  // table on a page that no longer exists (or flash an empty page first).
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);

  /** Every filter change sends the reader back to the first page of the new slice. */
  const withReset = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Dashboard de operación</h2>
              <p className="text-xs text-gray-400">
                Promotores que ya ingresaron. El promedio de solicitudes diarias se calcula sobre la
                ventana medida en HubSpot (30 días desde el ingreso; 15 si aún no hay corte de 30).
              </p>
            </div>
            <button
              onClick={() => downloadCsv(rows)}
              disabled={rows.length === 0}
              title="Exporta los promotores que pasan los filtros actuales, no solo la página visible"
              className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3 disabled:opacity-50 shrink-0"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>
        </div>

        {/* Filters — one row above everything they scope */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0 flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => withReset(setSearch)(e.target.value)}
              placeholder="Buscar promotor, plaza o ciudad..."
              className="input-field pl-9 text-sm"
            />
          </div>
          <select value={vertical} onChange={(e) => withReset(setVertical)(e.target.value)} className="input-field text-sm w-auto">
            <option value="">Todas las verticales</option>
            {verticals.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={plaza} onChange={(e) => withReset(setPlaza)(e.target.value)} className="input-field text-sm w-auto max-w-56">
            <option value="">Todas las plazas</option>
            {plazas.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={outcome}
            onChange={(e) => withReset(setOutcome)(e.target.value as 'all' | PromotorOutcome)}
            className="input-field text-sm w-auto"
          >
            {OUTCOME_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Ingreso
            <input type="date" value={from} onChange={(e) => withReset(setFrom)(e.target.value)} className="input-field text-sm w-auto" />
            <span>a</span>
            <input type="date" value={to} onChange={(e) => withReset(setTo)(e.target.value)} className="input-field text-sm w-auto" />
          </label>
        </div>

        {/* Dashboard */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BarChart3 size={40} />}
              title="Sin promotores para este filtro"
              description="Ajusta los filtros o espera a que se firmen los primeros contratos."
            />
          ) : (
            <div className="p-5 space-y-4">
              {/* Headline + funnel + distribución */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="border border-gray-200 rounded-xl p-4 bg-white flex flex-col">
                  <p className="text-sm font-semibold text-gray-800">Tasa de éxito</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Promotores que alcanzaron su meta, sobre los que ya tienen veredicto de 30 días.
                  </p>
                  <p className="text-5xl font-semibold text-gray-900 mt-4 leading-none">
                    {counts.tasaExito === null ? '—' : `${Math.round(counts.tasaExito * 100)}%`}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    {counts.si} de {counts.evaluados} evaluados
                  </p>
                  <dl className="mt-auto pt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-gray-400">Promotores</dt>
                      <dd className="text-gray-900 font-semibold text-sm tabular-nums">{counts.total}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">Solicitudes/día</dt>
                      <dd className="text-gray-900 font-semibold text-sm tabular-nums">
                        {solicitudes === null ? '—' : solicitudes.toFixed(2)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">Bajo desempeño</dt>
                      <dd className="text-gray-900 font-semibold text-sm tabular-nums">{counts.no}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">Sin evaluar</dt>
                      <dd className="text-gray-900 font-semibold text-sm tabular-nums">{counts.pendiente}</dd>
                    </div>
                  </dl>
                </div>

                <ChartCard
                  title="Del ingreso al Promotor Exitoso"
                  subtitle="Cuántos llegan al corte de 30 días y cuántos alcanzan la meta"
                >
                  <Funnel stages={stages} />
                </ChartCard>

                <ChartCard
                  title="Resultado de los promotores"
                  subtitle="Distribución de los promotores filtrados"
                >
                  <OutcomeDonut counts={counts} />
                </ChartCard>
              </div>

              {/* Éxito por vertical + ranking */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <ChartCard
                  title="Tasa de éxito por vertical"
                  subtitle="Exitosos entre evaluados; el conteo indica sobre cuántos se calcula"
                >
                  <SuccessRateBars groups={byVertical} emptyLabel="Sin verticales para este filtro" />
                </ChartCard>

                <ChartCard
                  title="Rotación por plaza"
                  subtitle={
                    rotation.totalPlazas === 0
                      ? 'Sin plazas registradas'
                      : `${rotation.conRotacion} de ${rotation.totalPlazas} plazas (${Math.round((rotation.conRotacion / rotation.totalPlazas) * 100)}%) ya contrataron a más de una persona. Cada contratación extra en la misma plaza significa que la anterior salió.`
                  }
                  action={
                    <span
                      className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 rounded-md px-2 py-1"
                      title="Cuenta todas las contrataciones históricas de cada plaza: no se ajusta al rango de fechas ni al filtro de resultado"
                    >
                      Histórico
                    </span>
                  }
                >
                  <OutcomeStackedBars
                    bars={groupBars(rotation.plazas.slice(0, 10))}
                    annotate={(counts) => `${counts.total} contrataciones`}
                    emptyLabel="Ninguna plaza ha contratado a más de una persona."
                  />
                  <OutcomeLegend />
                </ChartCard>
              </div>

              {/* Cohortes */}
              <ChartCard
                title="Cohortes por mes de ingreso"
                subtitle="Cada mes de ingreso, partido por resultado — los meses recientes siguen mayormente pendientes"
              >
                <OutcomeStackedBars bars={cohortBars(cohorts)} emptyLabel="Sin fechas de ingreso registradas" />
                <OutcomeLegend />
              </ChartCard>

              {/* Table */}
              <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-800">Promotores</h3>
                  <Pagination
                    page={currentPage}
                    totalPages={totalPages}
                    onPage={setPage}
                    summary={`${pageStart + 1}–${pageStart + pageRows.length} de ${rows.length}`}
                    pageSize={pageSize}
                    onPageSize={(size) => { setPageSize(size); setPage(1); }}
                  />
                </div>

                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-2.5 font-medium">Fecha de ingreso</th>
                      <th className="px-4 py-2.5 font-medium">Nombre promotor</th>
                      <th className="px-4 py-2.5 font-medium">Plaza</th>
                      <th className="px-4 py-2.5 font-medium">Vertical</th>
                      <th className="px-4 py-2.5 font-medium text-right">Solicitudes diarias (prom.)</th>
                      <th className="px-4 py-2.5 font-medium">Promotor exitoso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pageRows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50/60">
                        <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatStartDate(r.startDate)}</td>
                        <td className="px-4 py-2.5 text-gray-800 font-medium">{r.name || '—'}</td>
                        <td className="px-4 py-2.5">
                          <p className="text-gray-700 leading-snug">{r.plaza || '—'}</p>
                          {r.city && <p className="text-xs text-gray-400 leading-snug">{r.city}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{r.vertical}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {r.dealAverage ? (
                            <span title={`${r.dealAverage.deals} solicitudes en ${r.dealAverage.days} días`}>
                              {r.dealAverage.average.toFixed(2)}
                              <span className="text-gray-400 text-xs ml-1">/{r.dealAverage.days}d</span>
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${OUTCOME_STYLES[r.outcome]}`}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: OUTCOME_COLORS[r.outcome] }} />
                            {OUTCOME_LABELS[r.outcome]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {totalPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
                    <Pagination
                      page={currentPage}
                      totalPages={totalPages}
                      onPage={setPage}
                      summary={`${pageStart + 1}–${pageStart + pageRows.length} de ${rows.length}`}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ─── Pagination ─────────────────────────────────────────────────── */

/** Rows-per-page picker is optional: the footer copy repeats the nav, not the control. */
function Pagination({ page, totalPages, onPage, summary, pageSize, onPageSize }: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  summary: string;
  pageSize?: number;
  onPageSize?: (size: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      {pageSize !== undefined && onPageSize && (
        <label className="flex items-center gap-1.5">
          Filas
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="input-field text-xs w-auto py-1"
          >
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      )}
      <span className="tabular-nums">{summary}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          aria-label="Página anterior"
          className="p-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="tabular-nums px-1">{page} / {totalPages}</span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          aria-label="Página siguiente"
          className="p-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
