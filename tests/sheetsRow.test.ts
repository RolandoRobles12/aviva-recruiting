import { describe, expect, it } from 'vitest';
import {
  FIELD_DEFS,
  LEGACY_LAYOUT,
  buildCandidateFields,
  columnLetter,
  mapHeaders,
  normalizeHeader,
  referenceColumn,
  rowByHeaders,
  rowByPosition,
} from '../functions/src/integrations/sheetsRow';
import { legacyRow } from './fixtures/legacySheetsRow';

const NOW = new Date('2026-09-22T15:04:05.000Z');

/** A candidate with every source of data filled, OCR and overrides included. */
function candidate(): Record<string, unknown> {
  return {
    id: 'c1',
    firstName: 'María José',
    lastName: 'Pérez López',
    email: 'mj@example.com',
    phone: '5512345678',
    viterbitReference: 'REF-123',
    viterbitCompany: 'Ventas',
    profile: 'Promotor de crédito',
    offerSignedAt: new Date('2026-09-01T10:00:00Z'),
    viterbitStartDate: '2026-09-15',
    viterbitHiringManager: 'Ana Gómez',
    activatedAt: new Date('2026-09-16T12:30:00Z'),
    jiraTicketKey: 'ONB-42',
    corporateEmail: 'mj.perez@aviva.mx',
    viterbitContrasena: 'S3creta!',
    formAnswers: {
      estadoCivil: 'casado',
      tieneHijos: true,
      tieneInfonavit: false,
      tieneFonacot: true,
      tallaPlayera: 'M',
      beneficiarioNombre: 'Luis Pérez',
      beneficiarioParentesco: 'esposo',
      contacto1Nombre: 'Rosa López',
      contacto1Telefono: '5599999999',
      contacto1Parentesco: 'padre_madre',
      trabajoEntidadFinanciera: true,
      nombreEntidadFinanciera: 'Banco X',
      sobreTi: 'Me gusta vender',
    },
    dataOverrides: { rfc: 'PELM900101ABC' },
    documents: {
      ine: { status: 'valid', ocrResult: { extractedData: { domicilio: 'Calle 1', sexo: 'M', curp: 'CURPINE' } } },
      curp: { status: 'valid', ocrResult: { extractedData: { curp: 'CURPDOC' } } },
      nss: { status: 'valid', ocrResult: { extractedData: { nss: '12345678901' } } },
      caratula_bancaria: {
        status: 'valid',
        ocrResult: { extractedData: { clabe: '012345678901234567', banco: 'BBVA', numero_cuenta: '1234567890' } },
      },
      comprobante_domicilio: { status: 'pending', ocrResult: { extractedData: { cp: '01000' } } },
      acta_nacimiento: { status: 'valid', ocrResult: { extractedData: { fecha_nacimiento: '1990-01-01' } } },
    },
  };
}

const CTX = { folderId: 'FOLDER123', recruiterName: 'Reclutadora Uno', jobExternalId: 'Promotor CDMX', now: NOW };

describe('rowByPosition', () => {
  it('writes exactly what the previous code wrote, except the password columns', () => {
    const before = legacyRow(candidate(), CTX.folderId, CTX.recruiterName, CTX.jobExternalId, NOW);
    const after = rowByPosition(buildCandidateFields(candidate(), CTX), null);

    expect(after).toHaveLength(61);
    const PASSWORD_COLUMNS = [24, 51]; // "Contraseña" and its duplicate
    after.forEach((value, index) => {
      if (PASSWORD_COLUMNS.includes(index)) {
        expect(before[index], 'the old code did write the password here').toBe('S3creta!');
        expect(value).toBe('');
      } else {
        expect(value, `column ${columnLetter(index)}`).toBe(before[index]);
      }
    });
  });

  it('matches the old code for a candidate with almost nothing filled in', () => {
    const bare = { firstName: 'A', lastName: 'B' };
    const before = legacyRow(bare, '', '', undefined, NOW);
    const after = rowByPosition(buildCandidateFields(bare, { folderId: '', recruiterName: '', jobExternalId: undefined, now: NOW }), null);
    // The only intended difference: no folder → empty "Expediente" instead of a
    // link to https://drive.google.com/drive/folders/ with no id.
    expect(before[0]).toBe('https://drive.google.com/drive/folders/');
    expect(after[0]).toBe('');
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it('cuts the row where the sheet takes over', () => {
    expect(rowByPosition(buildCandidateFields(candidate(), CTX), 54)).toHaveLength(54);
  });
});

describe('mapHeaders / rowByHeaders', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeHeader('  Teléfono  contacto-1 ')).toBe('telefono contacto 1');
    const mapping = mapHeaders(['NOMBRE', 'Email  Personal:', 'TELÉFONO']);
    expect(mapping.columnsByField.nombre).toEqual([0]);
    expect(mapping.columnsByField.email_personal).toEqual([1]);
    expect(mapping.columnsByField.telefono).toEqual([2]);
  });

  it('places values under their headers regardless of column order', () => {
    const fields = buildCandidateFields(candidate(), CTX);
    const headers = ['Notas', 'CURP', 'Nombre', '', 'Email personal', 'Status'];
    const row = rowByHeaders(fields, mapHeaders(headers));
    expect(row).toEqual([null, 'CURPDOC', 'MARÍA JOSÉ PÉREZ LÓPEZ', null, 'mj@example.com']);
  });

  it('fills every column of a duplicated header', () => {
    const mapping = mapHeaders(['Nombre', 'Email personal', 'Correo corporativo', 'Correo corporativo', 'Correo corporativo MANUAL']);
    expect(mapping.columnsByField.correo_corporativo).toEqual([2, 3]);
    const row = rowByHeaders(buildCandidateFields(candidate(), CTX), mapping);
    expect(row[2]).toBe('mj.perez@aviva.mx');
    expect(row[3]).toBe('mj.perez@aviva.mx');
    expect(row[4]).toBeUndefined();
  });

  it('never writes the password, even if the sheet has a column for it', () => {
    const headers = ['Nombre', 'Email personal', 'Contraseña', 'Contraseña MANUAL'];
    const mapping = mapHeaders(headers);
    expect(mapping.unmappedHeaders.map((h) => h.header)).toEqual(['Contraseña', 'Contraseña MANUAL']);
    expect(rowByHeaders(buildCandidateFields(candidate(), CTX), mapping)).not.toContain('S3creta!');
  });

  it('reports the required fields a sheet is missing', () => {
    const mapping = mapHeaders(['Nombre', 'CURP']);
    expect(mapping.missingRequired).toEqual(['email_personal']);
  });

  it('lets an override point a field at an unexpected header', () => {
    const mapping = mapHeaders(['Nombre', 'Mail del candidato'], { email_personal: 'mail del candidato' });
    expect(mapping.columnsByField.email_personal).toEqual([1]);
    expect(mapping.missingRequired).toEqual([]);
  });

  it('recognises every header the fixed layout was written for', () => {
    // Header names as documented next to each column of the old layout.
    const legacyHeaders = [
      'Expediente', 'Etapa actual', 'Candidate reference', 'Nombre', 'Email personal', 'Telefono', 'Departamento',
      'Puesto', 'Ciudad', 'InternalID', 'Reclutadora', 'Fuente', 'Fecha de carta oferta', 'Fecha de ingreso',
      'Hiring Manager', 'Email Manager', 'Aprobador Asignado', 'Contrato enviado', 'Contrato Firmado',
      'Alta en Humand', 'Asistencia a inducción', 'Apertura de Tienda', 'Ticket Jira', 'Correo corporativo',
      'Contraseña', 'Dirección', 'Fecha de nacimiento', 'Género', 'Estado civil', 'Hijos', 'Infonavit', 'Fonacot',
      'Talla', 'Beneficiario', 'Correo electrónico beneficiario', 'Teléfono beneficiario', 'Parentesco beneficiario',
      'Contacto de emergencia 1', 'Teléfono contacto 1', 'Correo electrónico contacto 1', 'Parentesco contacto 1',
      'Contacto de emergencia 2', 'Teléfono contacto 2', 'Correo electrónico contacto 2', 'Parentesco contacto 2',
      'PLD Trabajo en entidad financiera', 'PLD Compañía', 'Cuéntanos un poco sobre ti', 'Fecha onboarding iniciado',
      'Fecha ejecución', 'Correo corporativo', 'Contraseña', 'Correo corporativo MANUAL', 'Contraseña MANUAL', 'NSS',
      'RFC', 'CURP', 'CP', 'BANCO', 'CUENTA', 'CLABE INTERBANCARIA',
    ];
    expect(legacyHeaders).toHaveLength(LEGACY_LAYOUT.length);
    const mapping = mapHeaders(legacyHeaders);
    expect(mapping.unmatchedFields).toEqual([]);

    // And by header, the row lands where the fixed layout put it.
    const fields = buildCandidateFields(candidate(), CTX);
    const byHeaders = rowByHeaders(fields, mapping);
    const byPosition = rowByPosition(fields, null);
    LEGACY_LAYOUT.forEach((key, index) => {
      if (key) expect(byHeaders[index], legacyHeaders[index]).toBe(byPosition[index]);
      else expect(byHeaders[index] ?? null, legacyHeaders[index]).toBeNull();
    });
  });

  it('never lets one header mean two fields', () => {
    const owner = new Map<string, string>();
    for (const def of FIELD_DEFS) {
      for (const header of def.headers.map(normalizeHeader)) {
        expect(owner.get(header), `"${header}"`).toBeUndefined();
        owner.set(header, def.key);
      }
    }
  });
});

describe('helpers', () => {
  it('converts column indexes to letters', () => {
    expect([0, 2, 25, 26, 52, 60].map(columnLetter)).toEqual(['A', 'C', 'Z', 'AA', 'BA', 'BI']);
  });

  it('finds the reference column in both modes', () => {
    expect(referenceColumn('posicion', null)).toBe(2);
    expect(referenceColumn('encabezados', mapHeaders(['Nombre', 'x', 'Candidate reference']))).toBe(2);
    expect(referenceColumn('encabezados', mapHeaders(['Nombre']))).toBeNull();
  });
});
