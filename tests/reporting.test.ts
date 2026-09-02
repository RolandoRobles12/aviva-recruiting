import { describe, expect, it } from 'vitest';
import {
  averageDailyDeals,
  buildReportRows,
  countOutcomes,
  dealAverage,
  formatIsoDate,
  funnelStages,
  groupOutcomes,
  monthlyCohorts,
  parseStartDate,
  promotorOutcome,
  resolveVertical,
  rowsToCsv,
  SIN_DATO,
  SIN_VERTICAL,
} from '../src/utils/reporting';
import type { Candidate } from '../src/types';

const candidate = (fields: Partial<Candidate>): Candidate =>
  ({ id: 'c1', firstName: 'Ana', lastName: 'López', status: 'contract_signed', ...fields } as Candidate);

describe('resolveVertical', () => {
  it('keeps Aviva tu Compra CM as its own vertical', () => {
    expect(resolveVertical('Promotor/a Aviva tu Compra CM')).toBe('Aviva tu Compra CM');
  });

  it('maps the Compra variants to Aviva tu Compra', () => {
    for (const profile of [
      'Promotor/a Aviva tu Compra',
      'Promotor/a Aviva tu Compra (Comodín)',
      'Promotor/a Aviva tu Compra (Temporal)',
      'Promotor/a Aviva tu Compra (Internalización)',
    ]) {
      expect(resolveVertical(profile)).toBe('Aviva tu Compra');
    }
  });

  it('maps Negocio, Casa and the branch roles', () => {
    expect(resolveVertical('Promotor/a Aviva tu Negocio')).toBe('Aviva tu Negocio');
    expect(resolveVertical('Promotor/a Aviva tu Casa')).toBe('Aviva tu Casa');
    expect(resolveVertical('Trainee Sucursal (Kiosk Trainee)')).toBe('Sucursal');
    expect(resolveVertical('Gerente de Sucursal (Kiosk Manager)')).toBe('Sucursal');
  });

  it('falls back to the job title when the profile is missing', () => {
    expect(resolveVertical('', 'Promotor Aviva tu Casa - Sucursal Centro')).toBe('Aviva tu Casa');
  });

  it('reports an unmapped profile under its own name', () => {
    expect(resolveVertical('Promotor/a Aviva tu Moto')).toBe('Promotor/a Aviva tu Moto');
    expect(resolveVertical(null, null)).toBe(SIN_VERTICAL);
  });
});

describe('dealAverage', () => {
  it('divides the 30-day count by its window', () => {
    expect(dealAverage(candidate({ performance30DayDeals: 45 }))).toEqual({ deals: 45, days: 30, average: 1.5 });
  });

  it('uses the 15-day window when there is no 30-day count yet', () => {
    expect(dealAverage(candidate({ performance15DayDeals: 15 }))).toEqual({ deals: 15, days: 15, average: 1 });
  });

  it('prefers the 30-day count when both exist', () => {
    const result = dealAverage(candidate({ performance15DayDeals: 30, performance30DayDeals: 30 }));
    expect(result?.days).toBe(30);
  });

  it('counts a measured zero instead of treating it as no measurement', () => {
    expect(dealAverage(candidate({ performance30DayDeals: 0 }))?.average).toBe(0);
    expect(dealAverage(candidate({}))).toBeNull();
  });
});

describe('promotorOutcome', () => {
  it('mirrors the status the performance check wrote', () => {
    expect(promotorOutcome(candidate({ status: 'promotor_exitoso' }))).toBe('si');
    expect(promotorOutcome(candidate({ status: 'bajo_desempeno' }))).toBe('no');
    expect(promotorOutcome(candidate({ status: 'disqualified' }))).toBe('baja');
    expect(promotorOutcome(candidate({ status: 'induction' }))).toBe('pendiente');
  });
});

describe('parseStartDate', () => {
  it('parses the ISO field', () => {
    expect(formatIsoDate(parseStartDate(candidate({ viterbitStartDateIso: '2026-07-15' })))).toBe('2026-07-15');
  });

  it('parses the legacy Spanish display text', () => {
    expect(formatIsoDate(parseStartDate(candidate({ viterbitStartDate: '15 de julio de 2026' })))).toBe('2026-07-15');
  });

  it('returns null when neither field is parseable', () => {
    expect(parseStartDate(candidate({ viterbitStartDate: 'pendiente' }))).toBeNull();
    expect(parseStartDate(candidate({}))).toBeNull();
  });
});

describe('buildReportRows', () => {
  it('covers joined promoters and excludes candidates still in the pipeline', () => {
    const rows = buildReportRows([
      candidate({ id: 'joined', status: 'induction', viterbitStartDateIso: '2026-01-10' }),
      candidate({ id: 'offer', status: 'offer_sent', viterbitStartDateIso: '2026-01-11' }),
      candidate({ id: 'docs', status: 'in_progress' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['joined']);
  });

  it('keeps someone disqualified after signing, but not before', () => {
    const rows = buildReportRows([
      candidate({ id: 'left', status: 'disqualified', contractSignedAt: {} as never }),
      candidate({ id: 'dropped', status: 'disqualified' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['left']);
  });

  it('sorts by start date, most recent first', () => {
    const rows = buildReportRows([
      candidate({ id: 'old', status: 'induction', viterbitStartDateIso: '2025-03-01' }),
      candidate({ id: 'new', status: 'induction', viterbitStartDateIso: '2026-02-01' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('carries plaza and city through as stored', () => {
    const [row] = buildReportRows([
      candidate({
        status: 'promotor_exitoso',
        plaza: 'MEX0147 Oxkutzcab BA',
        plazaCity: 'Oxkutzcab',
        profile: 'Promotor/a Aviva tu Compra',
        performance30DayDeals: 45,
      }),
    ]);
    expect(row).toMatchObject({
      name: 'Ana López',
      plaza: 'MEX0147 Oxkutzcab BA',
      city: 'Oxkutzcab',
      vertical: 'Aviva tu Compra',
      outcome: 'si',
    });
  });
});

describe('countOutcomes', () => {
  const rows = buildReportRows([
    candidate({ id: '1', status: 'promotor_exitoso' }),
    candidate({ id: '2', status: 'promotor_exitoso' }),
    candidate({ id: '3', status: 'bajo_desempeno' }),
    candidate({ id: '4', status: 'induction' }),
    candidate({ id: '5', status: 'disqualified', contractSignedAt: {} as never }),
  ]);

  it('counts each outcome', () => {
    expect(countOutcomes(rows)).toMatchObject({ si: 2, no: 1, baja: 1, pendiente: 1, total: 5 });
  });

  it('leaves the unevaluated out of the success rate', () => {
    const counts = countOutcomes(rows);
    expect(counts.evaluados).toBe(3);
    expect(counts.tasaExito).toBeCloseTo(2 / 3);
  });

  it('reports no rate at all when nobody has been evaluated', () => {
    expect(countOutcomes(buildReportRows([candidate({ status: 'induction' })])).tasaExito).toBeNull();
  });
});

describe('groupOutcomes', () => {
  it('ranks by evidence, so a small perfect group does not outrank a large one', () => {
    const rows = buildReportRows([
      candidate({ id: 'a1', status: 'promotor_exitoso', plaza: 'Grande' }),
      candidate({ id: 'a2', status: 'bajo_desempeno', plaza: 'Grande' }),
      candidate({ id: 'a3', status: 'promotor_exitoso', plaza: 'Grande' }),
      candidate({ id: 'b1', status: 'promotor_exitoso', plaza: 'Chica' }),
    ]);
    const groups = groupOutcomes(rows, (r) => r.plaza);
    expect(groups.map((g) => g.key)).toEqual(['Grande', 'Chica']);
    expect(groups[0].counts.tasaExito).toBeCloseTo(2 / 3);
    expect(groups[1].counts.tasaExito).toBe(1);
  });

  it('buckets rows with no value under "Sin dato"', () => {
    const groups = groupOutcomes(buildReportRows([candidate({ status: 'induction' })]), (r) => r.plaza);
    expect(groups[0].key).toBe(SIN_DATO);
  });
});

describe('funnelStages', () => {
  it('narrows from ingresaron to evaluados to exitosos with each conversion', () => {
    const rows = buildReportRows([
      candidate({ id: '1', status: 'promotor_exitoso' }),
      candidate({ id: '2', status: 'bajo_desempeno' }),
      candidate({ id: '3', status: 'induction' }),
      candidate({ id: '4', status: 'induction' }),
    ]);
    expect(funnelStages(rows).map((s) => [s.key, s.value, s.conversion])).toEqual([
      ['ingresaron', 4, null],
      ['evaluados', 2, 0.5],
      ['exitosos', 1, 0.5],
    ]);
  });
});

describe('monthlyCohorts', () => {
  it('groups by month of hire, oldest first, keeping only the most recent months', () => {
    const rows = buildReportRows([
      candidate({ id: '1', status: 'promotor_exitoso', viterbitStartDateIso: '2026-01-05' }),
      candidate({ id: '2', status: 'bajo_desempeno', viterbitStartDateIso: '2026-01-20' }),
      candidate({ id: '3', status: 'induction', viterbitStartDateIso: '2026-02-02' }),
      candidate({ id: '4', status: 'induction' }),
    ]);
    const cohorts = monthlyCohorts(rows, 2);
    expect(cohorts.map((c) => [c.label, c.counts.total])).toEqual([['ene 26', 2], ['feb 26', 1]]);
    expect(cohorts[0].counts.tasaExito).toBe(0.5);
  });
});

describe('averageDailyDeals', () => {
  it('averages only the promoters with a measured window', () => {
    const rows = buildReportRows([
      candidate({ id: '1', status: 'induction', performance30DayDeals: 30 }),
      candidate({ id: '2', status: 'induction', performance30DayDeals: 60 }),
      candidate({ id: '3', status: 'induction' }),
    ]);
    expect(averageDailyDeals(rows)).toBeCloseTo(1.5);
    expect(averageDailyDeals(buildReportRows([candidate({ status: 'induction' })]))).toBeNull();
  });
});

describe('rowsToCsv', () => {
  it('writes a header plus one quoted row per promoter', () => {
    const rows = buildReportRows([
      candidate({
        status: 'promotor_exitoso',
        firstName: 'Ana "La',
        lastName: 'Jefa"',
        viterbitStartDateIso: '2026-07-15',
        plaza: 'MEX0147 Oxkutzcab BA',
        plazaCity: 'Oxkutzcab',
        profile: 'Promotor/a Aviva tu Compra',
        performance30DayDeals: 45,
      }),
    ]);
    const lines = rowsToCsv(rows).split('\r\n');
    expect(lines[0]).toContain('"Fecha de ingreso"');
    expect(lines[1]).toBe(
      '"2026-07-15","Ana ""La Jefa""","MEX0147 Oxkutzcab BA","Oxkutzcab","Aviva tu Compra","1.50","Sí"',
    );
  });
});
