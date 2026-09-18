import { describe, expect, it } from 'vitest';

import {
  EMPTY_SNAPSHOT,
  buildViterbitUpdates,
  splitFullName,
  type ViterbitSnapshot,
} from '../functions/src/viterbit/syncCandidate';

const snapshot = (overrides: Partial<ViterbitSnapshot> = {}): ViterbitSnapshot => ({
  ...EMPTY_SNAPSHOT,
  ...overrides,
});

describe('splitFullName', () => {
  it('keeps the first token as the name and the rest as surnames', () => {
    expect(splitFullName('Juan Carlos Pérez López')).toEqual({
      firstName: 'Juan',
      lastName: 'Carlos Pérez López',
    });
  });

  it('tolerates extra whitespace and a single-word name', () => {
    expect(splitFullName('  Ana   Ruiz ')).toEqual({ firstName: 'Ana', lastName: 'Ruiz' });
    expect(splitFullName('Ana')).toEqual({ firstName: 'Ana', lastName: '' });
  });
});

describe('buildViterbitUpdates', () => {
  const stored = {
    firstName: 'Ana',
    lastName: 'Ruiz',
    email: 'ana@example.com',
    phone: '5551234567',
    position: 'Promotor/a Aviva tu Negocio',
    viterbitSalary: '$12,000 MXN',
    viterbitStartDate: '15 de julio de 2026',
    viterbitBuro: 'https://viterbit/buro.pdf',
  };

  it('writes nothing when Viterbit matches what is already stored', () => {
    const updates = buildViterbitUpdates(
      stored,
      snapshot({
        fullName: 'Ana Ruiz',
        email: 'ana@example.com',
        phone: '5551234567',
        position: 'Promotor/a Aviva tu Negocio',
        salary: '$12,000 MXN',
        startDate: '15 de julio de 2026',
        buro: 'https://viterbit/buro.pdf',
      }),
    );

    expect(updates).toEqual({});
  });

  it('picks up an edited salary and start date', () => {
    const updates = buildViterbitUpdates(
      stored,
      snapshot({
        salary: '$14,500 MXN',
        startDate: '1 de agosto de 2026',
        startDateIso: '2026-08-01',
      }),
    );

    expect(updates).toEqual({
      viterbitSalary: '$14,500 MXN',
      viterbitStartDate: '1 de agosto de 2026',
      viterbitStartDateIso: '2026-08-01',
    });
  });

  it('never clears a stored value when Viterbit returns nothing', () => {
    // A rate-limited job read or a candidature without hired_info comes back
    // empty; treating that as "the field was cleared" would wipe real data.
    expect(buildViterbitUpdates(stored, snapshot())).toEqual({});
  });

  it('rewrites the name when Viterbit spells it differently', () => {
    const updates = buildViterbitUpdates(stored, snapshot({ fullName: 'Ana Sofía Ruiz Márquez' }));

    expect(updates).toEqual({ firstName: 'Ana', lastName: 'Sofía Ruiz Márquez' });
  });

  it('leaves a hand-corrected first/last split alone while the full name matches', () => {
    const corrected = { firstName: 'Ana Sofía', lastName: 'Ruiz Márquez' };

    expect(buildViterbitUpdates(corrected, snapshot({ fullName: 'Ana Sofía Ruiz Márquez' }))).toEqual({});
    expect(buildViterbitUpdates(corrected, snapshot({ fullName: '  ana sofía   ruiz márquez ' }))).toEqual({});
  });

  it('treats the email case-insensitively but stores a real change', () => {
    expect(buildViterbitUpdates(stored, snapshot({ email: 'ANA@example.com' }))).toEqual({});
    expect(buildViterbitUpdates(stored, snapshot({ email: 'ana.ruiz@example.com' }))).toEqual({
      email: 'ana.ruiz@example.com',
    });
  });

  it('keeps profile and viterbitDepartmentProfile in step', () => {
    const updates = buildViterbitUpdates(
      stored,
      snapshot({ departmentProfile: 'Gerente de Sucursal (Kiosk Manager)' }),
    );

    expect(updates).toEqual({
      viterbitDepartmentProfile: 'Gerente de Sucursal (Kiosk Manager)',
      profile: 'Gerente de Sucursal (Kiosk Manager)',
    });
  });

  it('ignores a whitespace-only difference', () => {
    expect(buildViterbitUpdates(stored, snapshot({ salary: ' $12,000 MXN ' }))).toEqual({});
  });
});
