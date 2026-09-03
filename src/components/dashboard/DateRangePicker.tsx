import { useEffect, useRef, useState } from 'react';
import { addMonths, isSameDay, isSameMonth, isToday } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  DATE_PRESETS,
  detectDateRangePreset,
  formatRangeLabel,
  isWithinRange,
  monthMatrix,
  parseIsoDate,
  resolveDateRange,
  type DateRange,
} from '../../utils/dateRanges';
import { formatIsoDate } from '../../utils/reporting';

const WEEKDAYS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const monthTitle = (date: Date) => `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

/** Roughly what the popover measures; used only to decide which edge to anchor it to. */
const POPOVER_WIDTH = 680;

/**
 * One calendar for the whole range: click the first day, click the last, done.
 *
 * Two native date inputs made picking a past month twice the work — each opens
 * on today and has to be dragged back month by month — so this shows two months
 * at once with the presets beside them, and paints the range as it is being
 * drawn so the reader sees what they are about to select.
 */
export function DateRangePicker({ value, onChange }: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  // The left month of the pair. Opens where the current range starts, so
  // reopening a July range does not land the reader back in September.
  const [leftMonth, setLeftMonth] = useState(() => parseIsoDate(value.from) ?? new Date());
  /** First click of a new range; the second click closes it. */
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);
  /** The picker sits mid-row, so on a narrow screen it has to open leftwards. */
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const from = parseIsoDate(value.from);
  const to = parseIsoDate(value.to);

  // While drawing, the highlight follows the cursor: the reader sees the range
  // before committing to it.
  const previewFrom = pendingStart && hovered ? (hovered < pendingStart ? hovered : pendingStart) : from;
  const previewTo = pendingStart ? (hovered && hovered > pendingStart ? hovered : pendingStart) : to;

  const openPicker = () => {
    // Measured on click rather than in an effect: by the time the popover
    // renders the decision is already made, so it never jumps.
    const rect = containerRef.current?.getBoundingClientRect();
    setAlignRight(rect ? rect.left + POPOVER_WIDTH > window.innerWidth - 16 : false);
    setLeftMonth(parseIsoDate(value.from) ?? new Date());
    setPendingStart(null);
    setHovered(null);
    setOpen((current) => !current);
  };

  const pickDay = (day: Date) => {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    // Clicking backwards is not a mistake: it just means the range was drawn
    // right to left.
    const [start, end] = day < pendingStart ? [day, pendingStart] : [pendingStart, day];
    onChange({ from: formatIsoDate(start), to: formatIsoDate(end) });
    setPendingStart(null);
    setHovered(null);
    setOpen(false);
  };

  const activePreset = detectDateRangePreset(value);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={openPicker}
        className="input-field text-sm w-auto flex items-center gap-2 hover:bg-gray-50"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={14} className="text-gray-400 shrink-0" />
        <span className="text-gray-700">Ingreso: {formatRangeLabel(value)}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Elegir rango de fechas de ingreso"
          className={`absolute top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-3 flex gap-3 ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
          {/* Presets */}
          <div className="flex flex-col gap-0.5 pr-3 border-r border-gray-100 w-40 shrink-0">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => {
                  onChange(resolveDateRange(preset.value));
                  setPendingStart(null);
                  setOpen(false);
                }}
                className={`text-left text-xs px-2 py-1.5 rounded-lg transition-colors ${
                  activePreset === preset.value
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Two months */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                aria-label="Mes anterior"
                className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <ChevronLeft size={15} />
              </button>
              <p className="text-xs text-gray-500">
                {pendingStart ? 'Elige el día final' : 'Elige el día inicial'}
              </p>
              <button
                onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                aria-label="Mes siguiente"
                className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="flex gap-4">
              {[leftMonth, addMonths(leftMonth, 1)].map((month) => (
                <MonthGrid
                  key={month.toISOString()}
                  month={month}
                  from={previewFrom}
                  to={previewTo}
                  onPick={pickDay}
                  onHover={setHovered}
                />
              ))}
            </div>

            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400">{formatRangeLabel(value)}</p>
              {(value.from || value.to) && (
                <button
                  onClick={() => {
                    onChange({ from: '', to: '' });
                    setPendingStart(null);
                    setOpen(false);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  <X size={12} />
                  Quitar filtro
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthGrid({ month, from, to, onPick, onHover }: {
  month: Date;
  from: Date | null;
  to: Date | null;
  onPick: (day: Date) => void;
  onHover: (day: Date | null) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 text-center capitalize mb-1.5">
        {monthTitle(month)}
      </p>
      <div className="grid grid-cols-7 gap-y-0.5 w-56">
        {WEEKDAYS.map((day) => (
          <span key={day} className="text-[10px] text-gray-400 text-center h-4 leading-4">{day}</span>
        ))}

        {monthMatrix(month).flat().map((day) => {
          const outside = !isSameMonth(day, month);
          const isStart = from && isSameDay(day, from);
          const isEnd = to && isSameDay(day, to);
          const inRange = isWithinRange(day, from, to);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              className={[
                'h-8 text-xs rounded-lg transition-colors',
                outside ? 'text-gray-300' : 'text-gray-700',
                isStart || isEnd
                  ? 'bg-primary-600 text-white font-semibold hover:bg-primary-700'
                  : inRange
                    ? 'bg-primary-50 text-primary-800 rounded-none'
                    : 'hover:bg-gray-100',
                !inRange && !isStart && !isEnd && isToday(day) ? 'ring-1 ring-inset ring-primary-200' : '',
              ].join(' ')}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
