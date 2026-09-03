import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  detectDateRangePreset,
  resolveDateRange,
} from '../src/utils/dateRanges';

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
