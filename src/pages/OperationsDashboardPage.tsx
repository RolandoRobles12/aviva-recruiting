import { useMemo, useState } from 'react';
import { BarChart3, Download, Search, Trophy, TrendingDown, Clock, Users } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { EmptyState } from '../components/ui/EmptyState';
import { useCandidates } from '../hooks/useCandidates';
import {
  OUTCOME_LABELS,
  buildReportRows,
  formatIsoDate,
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
  { value: 'all', label: 'Todos' },
  { value: 'si', label: 'Promotor Exitoso' },
  { value: 'no', label: 'Bajo Desempeño' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'baja', label: 'Bajas' },
];

const SIN_DATO = 'Sin dato';

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

  const allRows = useMemo(() => buildReportRows(candidates), [candidates]);

  const verticals = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.vertical))).sort(),
    [allRows],
  );
  const plazas = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.plaza).filter(Boolean))).sort(),
    [allRows],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (term && !`${r.name} ${r.plaza} ${r.city}`.toLowerCase().includes(term)) return false;
      if (vertical && r.vertical !== vertical) return false;
      if (plaza && r.plaza !== plaza) return false;
      if (outcome !== 'all' && r.outcome !== outcome) return false;
      const iso = formatIsoDate(r.startDate);
      if (from && (!iso || iso < from)) return false;
      if (to && (!iso || iso > to)) return false;
      return true;
    });
  }, [allRows, search, vertical, plaza, outcome, from, to]);

  const stats = useMemo(() => {
    const measured = rows.filter((r) => r.dealAverage);
    const sum = measured.reduce((acc, r) => acc + (r.dealAverage?.average ?? 0), 0);
    const exitosos = rows.filter((r) => r.outcome === 'si').length;
    const evaluados = rows.filter((r) => r.outcome === 'si' || r.outcome === 'no').length;
    return {
      total: rows.length,
      exitosos,
      bajoDesempeno: rows.filter((r) => r.outcome === 'no').length,
      pendientes: rows.filter((r) => r.outcome === 'pendiente').length,
      // Over evaluated promoters only — counting the ones still inside their
      // window as failures would understate the rate every single month.
      tasaExito: evaluados > 0 ? Math.round((exitosos / evaluados) * 100) : null,
      promedioSolicitudes: measured.length > 0 ? sum / measured.length : null,
    };
  }, [rows]);

  const byVertical = useMemo(() => groupBy(rows, (r) => r.vertical), [rows]);
  const byPlaza = useMemo(
    () => groupBy(rows, (r) => r.plaza || SIN_DATO).slice(0, 10),
    [rows],
  );
  const byMonth = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of rows) {
      if (!r.startDate) continue;
      const month = formatIsoDate(r.startDate).slice(0, 7);
      buckets.set(month, (buckets.get(month) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, total]) => ({
        label: `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`,
        total,
      }));
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header + stats */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center justify-between mb-3">
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
              className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3 disabled:opacity-50"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatChip icon={<Users size={13} />}       label="Promotores"        value={String(stats.total)} color="gray" />
            <StatChip icon={<Trophy size={13} />}      label="Promotor Exitoso"  value={String(stats.exitosos)} color="green" />
            <StatChip icon={<TrendingDown size={13} />} label="Bajo Desempeño"   value={String(stats.bajoDesempeno)} color="red" />
            <StatChip icon={<Clock size={13} />}       label="Pendientes"        value={String(stats.pendientes)} color="amber" />
            <StatChip icon={<BarChart3 size={13} />}   label="Tasa de éxito"     value={stats.tasaExito === null ? '—' : `${stats.tasaExito}%`} color="blue" />
            <StatChip icon={<BarChart3 size={13} />}   label="Solicitudes/día"   value={stats.promedioSolicitudes === null ? '—' : stats.promedioSolicitudes.toFixed(2)} color="indigo" />
          </div>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0 flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar promotor, plaza o ciudad..."
              className="input-field pl-9 text-sm"
            />
          </div>
          <select value={vertical} onChange={(e) => setVertical(e.target.value)} className="input-field text-sm w-auto">
            <option value="">Todas las verticales</option>
            {verticals.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={plaza} onChange={(e) => setPlaza(e.target.value)} className="input-field text-sm w-auto max-w-56">
            <option value="">Todas las plazas</option>
            {plazas.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as 'all' | PromotorOutcome)}
            className="input-field text-sm w-auto"
          >
            {OUTCOME_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Ingreso
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field text-sm w-auto" />
            <span>a</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field text-sm w-auto" />
          </label>
        </div>

        {/* Report */}
        <div className="flex-1 overflow-auto bg-white">
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
            <>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr className="text-left text-gray-500">
                    <th className="px-5 py-2.5 font-medium">Fecha de ingreso</th>
                    <th className="px-5 py-2.5 font-medium">Nombre promotor</th>
                    <th className="px-5 py-2.5 font-medium">Plaza</th>
                    <th className="px-5 py-2.5 font-medium">Vertical</th>
                    <th className="px-5 py-2.5 font-medium text-right">Solicitudes diarias (prom.)</th>
                    <th className="px-5 py-2.5 font-medium">Promotor exitoso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/60">
                      <td className="px-5 py-2.5 text-gray-600 whitespace-nowrap">{formatStartDate(r.startDate)}</td>
                      <td className="px-5 py-2.5 text-gray-800 font-medium">{r.name || '—'}</td>
                      <td className="px-5 py-2.5">
                        <p className="text-gray-700 leading-snug">{r.plaza || '—'}</p>
                        {r.city && <p className="text-xs text-gray-400 leading-snug">{r.city}</p>}
                      </td>
                      <td className="px-5 py-2.5 text-gray-600">{r.vertical}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {r.dealAverage ? (
                          <span title={`${r.dealAverage.deals} solicitudes en ${r.dealAverage.days} días`}>
                            {r.dealAverage.average.toFixed(2)}
                            <span className="text-gray-400 text-xs ml-1">/{r.dealAverage.days}d</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${OUTCOME_STYLES[r.outcome]}`}>
                          {OUTCOME_LABELS[r.outcome]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Charts — secondary to the table, so they sit below it */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 border-t border-gray-100">
                <ChartCard title="Promotores por vertical" bars={byVertical.map((g) => ({
                  label: g.key,
                  value: g.total,
                  caption: `${g.total}`,
                }))} />
                <ChartCard title="Tasa de éxito por vertical" bars={byVertical.map((g) => ({
                  label: g.key,
                  value: g.evaluados > 0 ? Math.round((g.exitosos / g.evaluados) * 100) : 0,
                  caption: g.evaluados > 0 ? `${Math.round((g.exitosos / g.evaluados) * 100)}%` : 'sin evaluar',
                }))} />
                <ChartCard title="Top 10 plazas por promotores" bars={byPlaza.map((g) => ({
                  label: g.key,
                  value: g.total,
                  caption: `${g.total}`,
                }))} />
                <div className="lg:col-span-3">
                  <ChartCard title="Ingresos por mes" bars={byMonth.map((m) => ({
                    label: m.label,
                    value: m.total,
                    caption: `${m.total}`,
                  }))} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ─── Aggregation ─────────────────────────────────────────────────────────── */

interface Group {
  key: string;
  total: number;
  exitosos: number;
  /** Promoters whose 30-day verdict is already in — the success-rate denominator. */
  evaluados: number;
}

function groupBy(rows: ReportRow[], keyOf: (row: ReportRow) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { key, total: 0, exitosos: 0, evaluados: 0 };
    group.total++;
    if (row.outcome === 'si') { group.exitosos++; group.evaluados++; }
    if (row.outcome === 'no') group.evaluados++;
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}

/* ─── Presentational ──────────────────────────────────────────────────────── */

const CHIP_COLORS: Record<string, string> = {
  gray:   'bg-gray-100 text-gray-700',
  green:  'bg-green-50 text-green-700',
  red:    'bg-red-50 text-red-700',
  amber:  'bg-amber-50 text-amber-700',
  blue:   'bg-blue-50 text-blue-700',
  indigo: 'bg-indigo-50 text-indigo-700',
};

function StatChip({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${CHIP_COLORS[color] ?? CHIP_COLORS.gray}`}>
      {icon}
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function ChartCard({ title, bars }: {
  title: string;
  bars: { label: string; value: number; caption: string }[];
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">{title}</h3>
      {bars.length === 0 ? (
        <p className="text-xs text-gray-400">Sin datos</p>
      ) : (
        <div className="space-y-2">
          {bars.map((bar) => (
            <div key={bar.label}>
              <div className="flex items-center justify-between text-xs text-gray-600 mb-0.5">
                <span className="truncate pr-2" title={bar.label}>{bar.label}</span>
                <span className="text-gray-400 shrink-0">{bar.caption}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full"
                  style={{ width: `${(bar.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
