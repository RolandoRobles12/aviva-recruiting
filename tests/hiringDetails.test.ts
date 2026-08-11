import { describe, expect, it } from 'vitest';
import {
  HIRING_DETAIL_KEYS,
  formatMissingHiringDetails,
  getMissingHiringDetails,
  isHiringDetailKnown,
} from '../functions/src/utils/hiringDetails';
import {
  mergeScreeningFields,
  readCustomField,
  readScreeningFields,
} from '../functions/src/utils/viterbitFields';

const complete = {
  viterbitSalary: '$15,000 MXN',
  viterbitStartDate: '15 de julio de 2026',
  viterbitBuro: 'Aprobado',
  viterbitPsicometriaIntegridad: '82',
};

describe('isHiringDetailKnown', () => {
  it('accepts any non-empty value', () => {
    expect(isHiringDetailKnown('Aprobado')).toBe(true);
    expect(isHiringDetailKnown('0')).toBe(true);
    expect(isHiringDetailKnown('No aplica')).toBe(true);
    expect(isHiringDetailKnown('Rechazado')).toBe(true);
  });

  it('rejects empty, blank and non-string values', () => {
    expect(isHiringDetailKnown('')).toBe(false);
    expect(isHiringDetailKnown('   ')).toBe(false);
    expect(isHiringDetailKnown(undefined)).toBe(false);
    expect(isHiringDetailKnown(null)).toBe(false);
    expect(isHiringDetailKnown(82)).toBe(false);
  });

  it('treats Viterbit "no result yet" markers as unknown', () => {
    for (const pending of ['Pendiente', 'pendiente', ' En proceso ', 'Sin resultado', '-']) {
      expect(isHiringDetailKnown(pending)).toBe(false);
    }
  });
});

describe('getMissingHiringDetails', () => {
  it('returns nothing when every detail is known', () => {
    expect(getMissingHiringDetails(complete)).toEqual([]);
  });

  it('holds the offer when buró is unknown', () => {
    expect(getMissingHiringDetails({ ...complete, viterbitBuro: '' })).toEqual(['buró']);
    expect(getMissingHiringDetails({ ...complete, viterbitBuro: 'Pendiente' })).toEqual(['buró']);
  });

  it('holds the offer when the integrity psychometrics result is unknown', () => {
    expect(getMissingHiringDetails({ ...complete, viterbitPsicometriaIntegridad: undefined }))
      .toEqual(['psicometría de integridad']);
  });

  it('still holds the offer on the pre-existing salary / start date rules', () => {
    expect(getMissingHiringDetails({ ...complete, viterbitSalary: '', viterbitStartDate: '' }))
      .toEqual(['salario', 'fecha de inicio']);
  });

  it('lists every missing detail in display order', () => {
    expect(getMissingHiringDetails({})).toEqual([
      'salario',
      'fecha de inicio',
      'buró',
      'psicometría de integridad',
    ]);
    expect(HIRING_DETAIL_KEYS).toHaveLength(4);
  });
});

describe('formatMissingHiringDetails', () => {
  it('joins the labels the way the recruiter reads them', () => {
    expect(formatMissingHiringDetails([])).toBe('');
    expect(formatMissingHiringDetails(['buró'])).toBe('buró');
    expect(formatMissingHiringDetails(['buró', 'salario'])).toBe('buró y salario');
    expect(formatMissingHiringDetails(['salario', 'buró', 'psicometría de integridad']))
      .toBe('salario, buró y psicometría de integridad');
  });
});

describe('readCustomField', () => {
  it('reads the array shape Viterbit returns for candidates', () => {
    const raw = [
      { field_id: 'contrasena_correo_corporativo', value: 'x' },
      { field_id: 'buro', name: 'Buró', value: 'Aprobado' },
    ];
    expect(readCustomField(raw, ['buro'])).toBe('Aprobado');
    expect(readCustomField(raw, ['psicometria_integridad'])).toBe('');
  });

  it('reads the record shape, with and without a value wrapper', () => {
    expect(readCustomField({ buro: { value: 'Aprobado' } }, ['buro'])).toBe('Aprobado');
    expect(readCustomField({ buro: 'Rechazado' }, ['buro'])).toBe('Rechazado');
  });

  it('matches keys case-insensitively across aliases', () => {
    expect(readCustomField({ Buro_Credito: 'Aprobado' }, ['buro', 'buro_credito'])).toBe('Aprobado');
  });

  it('never mistakes a field name for its value', () => {
    expect(readCustomField([{ field_id: 'buro', name: 'Buró' }], ['buro'])).toBe('');
  });

  it('is safe on missing or non-object payloads', () => {
    expect(readCustomField(undefined, ['buro'])).toBe('');
    expect(readCustomField('buro', ['buro'])).toBe('');
  });
});

describe('readScreeningFields', () => {
  it('extracts both screening results from custom_field_values', () => {
    expect(readScreeningFields({
      custom_field_values: {
        buro: { value: 'Aprobado' },
        psicometria_integridad: { value: 'Apto' },
      },
    })).toEqual({ buro: 'Aprobado', psicometriaIntegridad: 'Apto' });
  });

  it('falls back to top-level fields', () => {
    expect(readScreeningFields({ buro: 'Aprobado', psicometria_integridad: 'Apto' }))
      .toEqual({ buro: 'Aprobado', psicometriaIntegridad: 'Apto' });
  });

  it('returns empty strings when nothing is filled in', () => {
    expect(readScreeningFields({})).toEqual({ buro: '', psicometriaIntegridad: '' });
  });
});

describe('mergeScreeningFields', () => {
  it('takes each field from the first source that has it', () => {
    const candidature = { buro: 'Aprobado', psicometriaIntegridad: '' };
    const candidate = { buro: 'Rechazado', psicometriaIntegridad: 'Apto' };
    expect(mergeScreeningFields(candidature, candidate))
      .toEqual({ buro: 'Aprobado', psicometriaIntegridad: 'Apto' });
  });

  it('ignores null sources and blank values', () => {
    expect(mergeScreeningFields(null, { buro: '   ' }, { buro: 'Aprobado' }))
      .toEqual({ buro: 'Aprobado', psicometriaIntegridad: '' });
  });
});
