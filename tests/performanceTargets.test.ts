import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DEAL_TARGETS_BY_PROFILE,
  DEFAULT_MONTHLY_TARGET,
  PROMOTION_ELIGIBLE_STATUSES,
  VERDICT_APPLIES_STATUSES,
  isValidDaysMark,
  performanceWindow,
  resolveMonthlyTarget,
} from '../functions/src/performance/targets';
import { parseStartDateString } from '../functions/src/utils/startDate';

describe('resolveMonthlyTarget', () => {
  it('matches a canonical profile exactly', () => {
    expect(resolveMonthlyTarget('Promotor/a Aviva tu Compra')).toEqual({
      target: 34,
      matchedProfile: 'Promotor/a Aviva tu Compra',
    });
  });

  it('resolves every configured profile to its own target', () => {
    for (const [profile, target] of Object.entries(DEAL_TARGETS_BY_PROFILE)) {
      expect(resolveMonthlyTarget(profile)).toEqual({ target, matchedProfile: profile });
    }
  });

  it('falls back to the job title when the profile is missing', () => {
    // The job title carries a store suffix, so an exact-key lookup misses it.
    expect(resolveMonthlyTarget('', 'Promotor/a Aviva tu Compra - Sucursal Centro')).toEqual({
      target: 34,
      matchedProfile: 'Promotor/a Aviva tu Compra',
    });
    expect(resolveMonthlyTarget(null, 'Promotor/a Aviva tu Casa - Kiosko 42')).toEqual({
      target: 17,
      matchedProfile: 'Promotor/a Aviva tu Casa',
    });
  });

  it('prefers the longest matching profile over its prefix', () => {
    // "… Compra CM" (17) must not be swallowed by "… Compra" (34).
    expect(resolveMonthlyTarget('', 'Promotor/a Aviva tu Compra CM - Sucursal Norte')).toEqual({
      target: 17,
      matchedProfile: 'Promotor/a Aviva tu Compra CM',
    });
    expect(resolveMonthlyTarget('Promotor/a Aviva tu Compra (Internalización) - Sucursal Sur')).toEqual({
      target: 34,
      matchedProfile: 'Promotor/a Aviva tu Compra (Internalización)',
    });
  });

  it('ignores accents, casing, the /a suffix and extra whitespace', () => {
    expect(resolveMonthlyTarget('promotor aviva tu compra (internalizacion)').target).toBe(34);
    expect(resolveMonthlyTarget('PROMOTOR/A  AVIVA  TU  NEGOCIO').target).toBe(17);
    expect(resolveMonthlyTarget('Promotor Aviva tu Compra - Sucursal X').target).toBe(34);
  });

  it('prefers the canonical profile over the job title', () => {
    expect(
      resolveMonthlyTarget('Promotor/a Aviva tu Compra CM', 'Promotor/a Aviva tu Compra - Sucursal Y'),
    ).toEqual({ target: 17, matchedProfile: 'Promotor/a Aviva tu Compra CM' });
  });

  it('reports the default as unmatched so the caller can log it', () => {
    expect(resolveMonthlyTarget('', '')).toEqual({
      target: DEFAULT_MONTHLY_TARGET,
      matchedProfile: null,
    });
    expect(resolveMonthlyTarget(undefined, 'Analista de Datos')).toEqual({
      target: DEFAULT_MONTHLY_TARGET,
      matchedProfile: null,
    });
  });
});

describe('performanceWindow', () => {
  const start = parseStartDateString('2026-07-15')!;

  it('closes the window at exactly daysMark after the start date', () => {
    const { fromMs, toMs } = performanceWindow(start, 30);
    expect(fromMs).toBe(start.getTime());
    expect(toMs - fromMs).toBe(30 * DAY_MS);
    expect(new Date(toMs).toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  it('uses a shorter window for the 15-day check', () => {
    const { toMs } = performanceWindow(start, 15);
    expect(new Date(toMs).toISOString()).toBe('2026-07-30T00:00:00.000Z');
  });

  it('is reproducible — the same window regardless of when it is computed', () => {
    expect(performanceWindow(start, 30)).toEqual(performanceWindow(start, 30));
  });

  it('matches the arithmetic signContract uses to schedule the checks', () => {
    const scheduled = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(performanceWindow(start, 30).toMs).toBe(scheduled.getTime());
  });

  it('accepts the legacy Spanish display date as the anchor', () => {
    const legacy = parseStartDateString('15 de julio de 2026')!;
    expect(performanceWindow(legacy, 30)).toEqual(performanceWindow(start, 30));
  });
});

describe('performanceWindow validation', () => {
  it('refuses an unparseable start date instead of producing a NaN bound', () => {
    expect(() => performanceWindow(new Date('no soy fecha'), 30)).toThrow(/invalid start date/);
  });

  it('refuses a missing or nonsensical daysMark', () => {
    const start = parseStartDateString('2026-07-15')!;
    expect(() => performanceWindow(start, undefined as unknown as number)).toThrow(/invalid daysMark/);
    expect(() => performanceWindow(start, NaN)).toThrow(/invalid daysMark/);
    expect(() => performanceWindow(start, 0)).toThrow(/invalid daysMark/);
    expect(() => performanceWindow(start, -30)).toThrow(/invalid daysMark/);
  });
});

describe('isValidDaysMark', () => {
  it('accepts only the scheduled day marks', () => {
    expect(isValidDaysMark(15)).toBe(true);
    expect(isValidDaysMark(30)).toBe(true);
    for (const bad of [undefined, null, 0, 7, '30', NaN, true]) {
      expect(isValidDaysMark(bad)).toBe(false);
    }
  });
});

describe('PROMOTION_ELIGIBLE_STATUSES', () => {
  it('lets a wrong Bajo Desempeño verdict be corrected', () => {
    expect(PROMOTION_ELIGIBLE_STATUSES).toContain('bajo_desempeno');
  });

  it('never promotes from a settled or in-flight status', () => {
    for (const excluded of ['promotor_exitoso', 'disqualified', 'contract_sent', 'offer_sent', 'offer_signed']) {
      expect(PROMOTION_ELIGIBLE_STATUSES).not.toContain(excluded);
    }
  });

  it('is the verdict set plus bajo_desempeno, nothing else', () => {
    expect([...PROMOTION_ELIGIBLE_STATUSES].sort()).toEqual(
      [...VERDICT_APPLIES_STATUSES, 'bajo_desempeno'].sort(),
    );
  });
});

describe('VERDICT_APPLIES_STATUSES', () => {
  it('never includes a settled outcome', () => {
    for (const settled of ['promotor_exitoso', 'bajo_desempeno', 'disqualified']) {
      expect(VERDICT_APPLIES_STATUSES).not.toContain(settled);
    }
  });

  it('never includes an in-flight offer or contract status', () => {
    for (const inFlight of ['offer_sent', 'offer_signed', 'contract_sent']) {
      expect(VERDICT_APPLIES_STATUSES).not.toContain(inFlight);
    }
  });

  it('covers the post-signature pipeline', () => {
    expect(VERDICT_APPLIES_STATUSES).toEqual([
      'contract_signed',
      'email_pending',
      'email_ready',
      'induction',
      'onboarding_iniciado',
    ]);
  });
});
