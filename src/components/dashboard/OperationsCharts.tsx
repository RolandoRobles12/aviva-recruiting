import type { ReactNode } from 'react';
import {
  OUTCOME_ORDER,
  type FunnelStage,
  type OutcomeCounts,
  type OutcomeGroup,
  type PromotorOutcome,
} from '../../utils/reporting';
import {
  OUTCOME_CHART_HINTS,
  OUTCOME_CHART_LABELS,
  OUTCOME_COLORS,
  type StackedBar,
} from '../../utils/outcomeStyles';

/** Charts for the operations dashboard, in plain SVG/HTML. */

/** One hue, light → dark, for the ordered funnel stages. */
const FUNNEL_COLORS = ['#16b877', '#0f9461', '#026149'];

const pct = (value: number) => `${Math.round(value * 100)}%`;

export function ChartCard({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function OutcomeLegend({ outcomes = OUTCOME_ORDER }: { outcomes?: PromotorOutcome[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
      {outcomes.map((outcome) => (
        <span
          key={outcome}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500"
          title={OUTCOME_CHART_HINTS[outcome]}
        >
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: OUTCOME_COLORS[outcome] }} />
          {OUTCOME_CHART_LABELS[outcome]}
        </span>
      ))}
    </div>
  );
}

/* ─── Funnel ──────────────────────────────────────────────────────────────── */

export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => (
        <div key={stage.key}>
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="text-gray-600">{stage.label}</span>
            <span className="text-gray-400">
              {stage.conversion !== null && `${pct(stage.conversion)} del paso anterior`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-6 bg-gray-50 rounded-md overflow-hidden">
              <div
                className="h-full rounded-r-md"
                style={{ width: `${(stage.value / max) * 100}%`, backgroundColor: FUNNEL_COLORS[i] ?? FUNNEL_COLORS[0] }}
              />
            </div>
            <span className="text-sm font-semibold text-gray-800 w-12 text-right tabular-nums">{stage.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Donut ───────────────────────────────────────────────────────────────── */

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** 2px of surface between segments — the separator is the gap, never a stroke. */
const SEGMENT_GAP = 2;

export function OutcomeDonut({ counts }: { counts: OutcomeCounts }) {
  const segments = OUTCOME_ORDER
    .map((outcome) => ({ outcome, value: counts[outcome] }))
    .filter((s) => s.value > 0);

  const arcs = segments.map(({ outcome, value }, i) => {
    const length = (value / counts.total) * CIRCUMFERENCE;
    return {
      outcome,
      value,
      // Never let the gap eat a sliver segment down to nothing.
      dash: Math.max(length - SEGMENT_GAP, 1),
      // Each arc starts where every earlier one ended.
      offset: segments
        .slice(0, i)
        .reduce((acc, s) => acc + (s.value / counts.total) * CIRCUMFERENCE, 0),
    };
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 130 130" className="w-32 h-32 shrink-0" role="img" aria-label="Distribución de resultados">
        <g transform="rotate(-90 65 65)">
          {arcs.map((arc) => (
            <circle
              key={arc.outcome}
              cx="65" cy="65" r={RADIUS}
              fill="none"
              stroke={OUTCOME_COLORS[arc.outcome]}
              strokeWidth="16"
              strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
              strokeDashoffset={-arc.offset}
            >
              <title>{`${OUTCOME_CHART_LABELS[arc.outcome]}: ${arc.value}`}</title>
            </circle>
          ))}
        </g>
        <text x="65" y="62" textAnchor="middle" className="fill-gray-900" style={{ fontSize: 20, fontWeight: 600 }}>
          {counts.total}
        </text>
        <text x="65" y="78" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>
          promotores
        </text>
      </svg>

      <ul className="space-y-1.5 min-w-0">
        {OUTCOME_ORDER.map((outcome) => (
          <li key={outcome} className="flex items-start gap-2 text-xs" title={OUTCOME_CHART_HINTS[outcome]}>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-0.5" style={{ backgroundColor: OUTCOME_COLORS[outcome] }} />
            <span className="text-gray-600 leading-snug">{OUTCOME_CHART_LABELS[outcome]}</span>
            <span className="text-gray-900 font-semibold tabular-nums ml-auto pl-2">{counts[outcome]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Success rate by dimension ───────────────────────────────────────────── */

/**
 * Success rate per group, as one series against a shared 0–100% track.
 * Groups with nobody evaluated yet show the reason instead of an empty bar, and
 * every bar states its denominator: 100% over two promoters is not the same
 * claim as 62% over forty.
 */
export function SuccessRateBars({ groups, emptyLabel }: { groups: OutcomeGroup[]; emptyLabel: string }) {
  if (groups.length === 0) return <p className="text-xs text-gray-400">{emptyLabel}</p>;

  return (
    <div className="space-y-2.5">
      {groups.map(({ key, counts }) => (
        <div key={key}>
          <div className="flex items-baseline justify-between text-xs mb-1 gap-2">
            <span className="text-gray-600 truncate" title={key}>{key}</span>
            <span className="text-gray-400 shrink-0 tabular-nums">
              {counts.tasaExito === null
                ? 'sin evaluar'
                : `${pct(counts.tasaExito)} · ${counts.si}/${counts.evaluados}`}
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(counts.tasaExito ?? 0) * 100}%`,
                backgroundColor: OUTCOME_COLORS.si,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Stacked outcome bars ────────────────────────────────────────────────── */

const defaultAnnotation = (counts: OutcomeCounts) =>
  counts.tasaExito === null
    ? `${counts.total} · sin evaluar`
    : `${counts.total} · ${pct(counts.tasaExito)} éxito`;

/**
 * One bar per group, split by outcome. Shared scale across bars (never each bar
 * normalised to its own width) so a big group still looks big.
 */
export function OutcomeStackedBars({ bars, emptyLabel, annotate = defaultAnnotation }: {
  bars: StackedBar[];
  emptyLabel: string;
  /** Right-hand label of each bar — say what the length means in this chart. */
  annotate?: (counts: OutcomeCounts) => string;
}) {
  if (bars.length === 0) return <p className="text-xs text-gray-400">{emptyLabel}</p>;
  const max = Math.max(1, ...bars.map((b) => b.counts.total));

  return (
    <div className="space-y-2.5">
      {bars.map((bar) => (
        <div key={bar.key}>
          <div className="flex items-baseline justify-between text-xs mb-1 gap-2">
            <span className="text-gray-600 truncate" title={bar.label}>{bar.label}</span>
            <span className="text-gray-400 shrink-0 tabular-nums">{annotate(bar.counts)}</span>
          </div>
          <div
            className="flex h-3 gap-0.5"
            style={{ width: `${(bar.counts.total / max) * 100}%` }}
          >
            {OUTCOME_ORDER.filter((outcome) => bar.counts[outcome] > 0).map((outcome) => (
              <div
                key={outcome}
                className="h-full first:rounded-l-sm last:rounded-r-sm"
                style={{
                  flexGrow: bar.counts[outcome],
                  backgroundColor: OUTCOME_COLORS[outcome],
                }}
                title={`${OUTCOME_CHART_LABELS[outcome]}: ${bar.counts[outcome]}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
