import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  detectDateRangePreset,
  formatRangeLabel,
  isWithinRange,
  monthMatrix,
  resolveDateRange,
} from '../src/utils/dateRanges';
import { formatIsoDate } from '../src/utils/reporting';

// Jueves 3 de septiembre de 2026.
const today = new Date(2026, 8, 3);

describe('resolveDateRange', () => {
  it('cubre el mes en curso completo, no solo hasta hoy', () => {
    expect(resolveDateRange('mes_actual', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('cubre el mes pasado de punta a punta', () => {
    expect(resolveDateRange('mes_pasado', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('cuenta los últimos días incluyendo hoy', () => {
    // 30 días de datos, no 31.
    expect(resolveDateRange('ultimos_30', today)).toEqual({ from: '2026-08-05', to: '2026-09-03' });
    expect(resolveDateRange('ultimos_90', today)).toEqual({ from: '2026-06-06', to: '2026-09-03' });
  });

  it('toma el año calendario completo', () => {
    expect(resolveDateRange('anio_actual', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('deja el rango abierto para todo el histórico', () => {
    expect(resolveDateRange('todo', today)).toEqual({ from: '', to: '' });
  });

  it('cruza el año al pedir el mes pasado en enero', () => {
    expect(resolveDateRange('mes_pasado', new Date(2026, 0, 15)))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('respeta los meses cortos', () => {
    expect(resolveDateRange('mes_actual', new Date(2026, 1, 10)))
      .toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('detectDateRangePreset', () => {
  it('reconoce cada rango que él mismo produce', () => {
    for (const { value } of DATE_PRESETS) {
      expect(detectDateRangePreset(resolveDateRange(value, today), today)).toBe(value);
    }
  });

  it('llama personalizado a lo que se escribió a mano', () => {
    expect(detectDateRangePreset({ from: '2026-07-01', to: '2026-07-15' }, today)).toBe('personalizado');
  });

  it('trata un rango a medias como personalizado, no como todo el histórico', () => {
    expect(detectDateRangePreset({ from: '2026-07-01', to: '' }, today)).toBe('personalizado');
    expect(detectDateRangePreset({ from: '', to: '' }, today)).toBe('todo');
  });
});

describe('monthMatrix', () => {
  it('arma semanas completas de lunes a domingo', () => {
    const weeks = monthMatrix(new Date(2026, 8, 1)); // septiembre 2026
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // Septiembre de 2026 empieza en martes: la primera fila abre el 31 de agosto.
    expect(formatIsoDate(weeks[0][0])).toBe('2026-08-31');
    expect(weeks[0][1].getDate()).toBe(1);
    expect(formatIsoDate(weeks.at(-1)!.at(-1)!)).toBe('2026-10-04');
  });

  it('incluye todos los días del mes exactamente una vez', () => {
    const dias = monthMatrix(new Date(2026, 1, 15)).flat().filter((d) => d.getMonth() === 1);
    expect(dias).toHaveLength(28);
  });
});

describe('formatRangeLabel', () => {
  it('usa el nombre del rango cuando corresponde a uno', () => {
    expect(formatRangeLabel(resolveDateRange('mes_pasado', today), today)).toBe('Mes pasado');
    expect(formatRangeLabel({ from: '', to: '' }, today)).toBe('Todo el histórico');
  });

  it('colapsa el mes repetido cuando el rango cabe en uno solo', () => {
    expect(formatRangeLabel({ from: '2026-07-01', to: '2026-07-31' }, today)).toBe('1 – 31 jul 2026');
  });

  it('escribe ambos extremos cuando cruzan de mes', () => {
    expect(formatRangeLabel({ from: '2026-07-10', to: '2026-08-20' }, today))
      .toBe('10 jul 2026 – 20 ago 2026');
  });

  it('describe un rango abierto por un extremo', () => {
    expect(formatRangeLabel({ from: '2026-07-10', to: '' }, today)).toBe('Desde 10 jul 2026');
    expect(formatRangeLabel({ from: '', to: '2026-07-10' }, today)).toBe('Hasta 10 jul 2026');
  });
});

describe('isWithinRange', () => {
  const day = new Date(2026, 6, 15);

  it('incluye los extremos del rango', () => {
    expect(isWithinRange(day, new Date(2026, 6, 15), new Date(2026, 6, 20))).toBe(true);
    expect(isWithinRange(day, new Date(2026, 6, 10), new Date(2026, 6, 15))).toBe(true);
  });

  it('deja fuera lo que cae antes o después', () => {
    expect(isWithinRange(day, new Date(2026, 6, 16), null)).toBe(false);
    expect(isWithinRange(day, null, new Date(2026, 6, 14))).toBe(false);
  });

  it('sin rango no marca nada', () => {
    expect(isWithinRange(day, null, null)).toBe(false);
  });
});
