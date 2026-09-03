import { describe, expect, it } from 'vitest';
import {
  averageDailyDeals,
  buildReportRows,
  countOutcomes,
  dealAverage,
  filterByDimensions,
  filterBySlice,
  formatIsoDate,
  funnelStages,
  groupOutcomes,
  monthlyCohorts,
  parseStartDate,
  plazaRotation,
  promotorOutcome,
  resolveVertical,
  rowsToCsv,
  sortReportRows,
  stuckPending,
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
  });

  it('reports the branch roles as Aviva Contigo, whatever Viterbit calls the profile', () => {
    expect(resolveVertical('Trainee Sucursal (Kiosk Trainee)')).toBe('Aviva Contigo');
    expect(resolveVertical('Gerente de Sucursal (Kiosk Manager)')).toBe('Aviva Contigo');
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

describe('plazaRotation', () => {
  const rows = buildReportRows([
    candidate({ id: 'a1', status: 'bajo_desempeno', plaza: 'MEX0001' }),
    candidate({ id: 'a2', status: 'promotor_exitoso', plaza: 'MEX0001' }),
    candidate({ id: 'a3', status: 'induction', plaza: 'MEX0001' }),
    candidate({ id: 'b1', status: 'bajo_desempeno', plaza: 'MEX0002' }),
    candidate({ id: 'b2', status: 'induction', plaza: 'MEX0002' }),
    candidate({ id: 'c1', status: 'promotor_exitoso', plaza: 'MEX0003' }),
  ]);

  it('keeps only the plazas that hired more than once, worst first', () => {
    const { plazas } = plazaRotation(rows);
    expect(plazas.map((p) => [p.key, p.counts.total])).toEqual([['MEX0001', 3], ['MEX0002', 2]]);
  });

  it('reports how many plazas rotated out of all the plazas with hires', () => {
    expect(plazaRotation(rows)).toMatchObject({ conRotacion: 2, totalPlazas: 3 });
  });

  it('never invents a plaza out of the candidates that have none', () => {
    const sinPlaza = buildReportRows([
      candidate({ id: '1', status: 'induction' }),
      candidate({ id: '2', status: 'induction' }),
    ]);
    expect(plazaRotation(sinPlaza)).toMatchObject({ plazas: [], conRotacion: 0, totalPlazas: 0 });
  });
});

describe('pendingIssue', () => {
  const now = new Date(2026, 8, 2); // 2 de septiembre de 2026

  const issueOf = (fields: Partial<Candidate>) =>
    buildReportRows([candidate({ status: 'onboarding_iniciado', hubspotOwnerId: '96665933', ...fields })], now)[0]
      .pendingIssue;

  it('leaves a promoter alone while their 30 days are still running', () => {
    // Ingresó el 6 de agosto: su corte cae el 5 de septiembre.
    expect(issueOf({ viterbitStartDateIso: '2026-08-06' })).toBeNull();
  });

  it('waits out the grace period, since the check only runs once a day', () => {
    expect(issueOf({ viterbitStartDateIso: '2026-08-02' })).toBeNull();
    expect(issueOf({ viterbitStartDateIso: '2026-07-31' })).toBe('sin_conteo');
  });

  it('names the dead end that is holding the verdict', () => {
    expect(issueOf({ viterbitStartDateIso: '2026-06-01', hubspotOwnerId: undefined })).toBe('sin_correo');
    expect(issueOf({ viterbitStartDateIso: '2026-06-01' })).toBe('sin_conteo');
    expect(issueOf({})).toBe('sin_fecha');
  });

  it('believes what the check recorded over what the fields suggest', () => {
    // Tiene correo corporativo, pero HubSpot no lo reconoce como owner: el corte
    // ya lo intentó y lo dejó anotado. Volver a correrlo no lo resuelve.
    expect(issueOf({
      viterbitStartDateIso: '2026-06-01',
      corporateEmail: 'karina.collazo@avivacredito.com',
      performanceBlockedReason: 'sin_owner',
    })).toBe('sin_owner');
    expect(issueOf({ viterbitStartDateIso: '2026-06-01', performanceBlockedReason: 'sin_correo' }))
      .toBe('sin_correo');
  });

  it('reads a legacy mark by whether the corporate email ever existed', () => {
    expect(issueOf({
      viterbitStartDateIso: '2026-06-01',
      corporateEmail: 'karina.collazo@avivacredito.com',
      performanceBlockedReason: 'sin_hubspot',
    })).toBe('sin_owner');
    expect(issueOf({ viterbitStartDateIso: '2026-06-01', performanceBlockedReason: 'sin_hubspot' }))
      .toBe('sin_correo');
  });

  it('separates a verdict that never landed from a count that never happened', () => {
    // Sus solicitudes sí se contaron; lo que falló fue aplicar la etapa.
    expect(issueOf({ viterbitStartDateIso: '2026-06-01', performance30DayDeals: 12 }))
      .toBe('veredicto_no_aplicado');
    expect(issueOf({ viterbitStartDateIso: '2026-06-01', promotorMovePending: true }))
      .toBe('veredicto_no_aplicado');
  });

  it('does not blame HubSpot when the daily check can still recover the owner id', () => {
    // El corte diario resuelve el hubspotOwnerId desde el correo corporativo,
    // así que lo que falta aquí es el conteo, no las cuentas.
    expect(issueOf({
      viterbitStartDateIso: '2026-06-01',
      hubspotOwnerId: undefined,
      corporateEmail: 'karina.collazo@avivacredito.com',
    })).toBe('sin_conteo');
  });

  it('reads the legacy Spanish start date, so a missing ISO field is not "sin fecha"', () => {
    // Ingresó el 21 de julio y solo quedó el texto en español: está vencida,
    // pero el motivo es el conteo que nunca corrió, no la fecha.
    expect(issueOf({
      viterbitStartDate: '21 de julio de 2026',
      hubspotOwnerId: undefined,
      corporateEmail: 'karina.collazo@avivacredito.com',
    })).toBe('sin_conteo');
  });

  it('never flags a promoter whose verdict already landed', () => {
    expect(issueOf({ status: 'promotor_exitoso', viterbitStartDateIso: '2026-01-01' })).toBeNull();
    expect(issueOf({ status: 'bajo_desempeno', viterbitStartDateIso: '2026-01-01' })).toBeNull();
    expect(issueOf({ status: 'disqualified', contractSignedAt: {} as never })).toBeNull();
  });
});

describe('stuckPending', () => {
  const now = new Date(2026, 8, 2);

  it('counts the stuck promoters by dead end, biggest first', () => {
    const rows = buildReportRows([
      candidate({ id: '1', status: 'induction', viterbitStartDateIso: '2026-06-01' }),
      candidate({ id: '2', status: 'induction', viterbitStartDateIso: '2026-06-02' }),
      candidate({ id: '3', status: 'induction', viterbitStartDateIso: '2026-06-03', hubspotOwnerId: '1' }),
      candidate({ id: '4', status: 'induction', viterbitStartDateIso: '2026-08-30', hubspotOwnerId: '1' }),
      // Ya vencido pero con correo corporativo: el corte puede recuperar su owner id.
      candidate({ id: '5', status: 'induction', viterbitStartDateIso: '2026-06-04', corporateEmail: 'x@avivacredito.com' }),
    ], now);

    expect(stuckPending(rows)).toEqual({
      total: 4,
      byIssue: [{ issue: 'sin_conteo', total: 2 }, { issue: 'sin_correo', total: 2 }],
    });
  });

  it('reports nothing when every pending promoter is still inside their window', () => {
    const rows = buildReportRows([candidate({ status: 'induction', viterbitStartDateIso: '2026-08-30' })], now);
    expect(stuckPending(rows)).toEqual({ total: 0, byIssue: [] });
  });
});

describe('filters', () => {
  const rows = buildReportRows([
    candidate({ id: 'a', status: 'promotor_exitoso', plaza: 'MEX0001', plazaCity: 'Mérida', profile: 'Promotor/a Aviva tu Casa', viterbitStartDateIso: '2026-01-10' }),
    candidate({ id: 'b', status: 'bajo_desempeno', plaza: 'MEX0002', plazaCity: 'Puebla', profile: 'Promotor/a Aviva tu Compra', viterbitStartDateIso: '2026-08-10' }),
    candidate({ id: 'c', status: 'induction', plaza: 'MEX0002', plazaCity: 'Puebla', profile: 'Promotor/a Aviva tu Compra' }),
  ]);

  it('matches the search term against name, plaza and city', () => {
    expect(filterByDimensions(rows, { search: 'mérida' }).map((r) => r.id)).toEqual(['a']);
    expect(filterByDimensions(rows, { search: 'MEX0002' }).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('narrows by vertical and plaza', () => {
    expect(filterByDimensions(rows, { vertical: 'Aviva tu Casa' }).map((r) => r.id)).toEqual(['a']);
    expect(filterByDimensions(rows, { plaza: 'MEX0001' }).map((r) => r.id)).toEqual(['a']);
  });

  it('slices by outcome and by hiring window', () => {
    expect(filterBySlice(rows, { outcome: 'si' }).map((r) => r.id)).toEqual(['a']);
    expect(filterBySlice(rows, { from: '2026-06-01' }).map((r) => r.id)).toEqual(['b']);
    expect(filterBySlice(rows, { to: '2026-06-01' }).map((r) => r.id)).toEqual(['a']);
    expect(filterBySlice(rows, { outcome: 'all' }).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps rotation historical: the date range and the outcome filter never reach it', () => {
    // Only one MEX0002 hire falls inside the window, but the plaza still shows
    // both — that is the whole point of a historical rotation number.
    const scoped = filterByDimensions(rows, { plaza: 'MEX0002' });
    expect(filterBySlice(scoped, { from: '2026-06-01', outcome: 'no' }).map((r) => r.id)).toEqual(['b']);
    expect(plazaRotation(scoped).plazas[0].counts.total).toBe(2);
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

describe('sortReportRows', () => {
  const rows = buildReportRows([
    candidate({ id: 'b', status: 'bajo_desempeno', plaza: 'MEX0002', viterbitStartDateIso: '2026-03-01', performance30DayDeals: 60 }),
    candidate({ id: 'a', status: 'promotor_exitoso', plaza: 'MEX0001', viterbitStartDateIso: '2026-05-01', performance30DayDeals: 30 }),
    candidate({ id: 'c', status: 'induction', viterbitStartDateIso: '2026-01-01' }),
  ]);

  it('orders by date, deals and outcome, biggest first', () => {
    expect(sortReportRows(rows, 'startDate', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReportRows(rows, 'dealAverage', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortReportRows(rows, 'outcome', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('reverses on ascending, but keeps the rows with no value at the bottom', () => {
    // 'c' no tiene plaza ni promedio: es un dato faltante, no el valor más chico.
    expect(sortReportRows(rows, 'dealAverage', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReportRows(rows, 'plaza', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReportRows(rows, 'plaza', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts names the way Spanish reads them', () => {
    const named = buildReportRows([
      candidate({ id: '1', status: 'induction', firstName: 'Óscar', lastName: 'Núñez' }),
      candidate({ id: '2', status: 'induction', firstName: 'Ana', lastName: 'Ñandú' }),
      candidate({ id: '3', status: 'induction', firstName: 'Zoe', lastName: 'Ávila' }),
    ]);
    expect(sortReportRows(named, 'name', 'asc').map((r) => r.name)).toEqual([
      'Ana Ñandú', 'Óscar Núñez', 'Zoe Ávila',
    ]);
  });

  it('leaves the original array untouched', () => {
    const original = [...rows];
    sortReportRows(rows, 'name', 'asc');
    expect(rows).toEqual(original);
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
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '"2026-07-15","Ana ""La Jefa""","MEX0147 Oxkutzcab BA","Oxkutzcab","Aviva tu Compra","1.50","Sí"',
    );
  });

  it('carries the dead end of a stuck promoter, so it can be chased from Excel', () => {
    const rows = buildReportRows(
      [candidate({ status: 'induction', viterbitStartDateIso: '2026-06-01' })],
      new Date(2026, 8, 2),
    );
    expect(rowsToCsv(rows).split('\r\n')[1])
      .toContain('"Pendiente — sin cuentas corporativas provisionadas"');
  });
});
