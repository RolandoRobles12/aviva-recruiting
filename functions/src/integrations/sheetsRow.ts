// The onboarding row, as data: which values we send and how they land in a
// spreadsheet. Kept free of any Google/Firestore import so it can be tested.
//
// Two ways to place the values:
//  - by header ('encabezados'): read the tab's first row and put every value
//    under the column whose title matches it. Inserting, moving or renaming
//    unrelated columns no longer shifts anything, and columns we have no data
//    for are left untouched (null), so the sheet's own formulas and manual
//    columns survive.
//  - by position ('posicion'): the original fixed 61-column layout. Kept so the
//    existing sheets keep working until their headers are checked.
//
// The corporate e-mail password is deliberately not part of the row: it reaches
// the new hire by e-mail from another tool, and a spreadsheet is no place for it.

export type FieldKey =
  | 'expediente'
  | 'etapa_actual'
  | 'candidate_reference'
  | 'nombre'
  | 'email_personal'
  | 'telefono'
  | 'departamento'
  | 'puesto'
  | 'ciudad'
  | 'internal_id'
  | 'reclutadora'
  | 'fecha_carta_oferta'
  | 'fecha_ingreso'
  | 'hiring_manager'
  | 'contrato_enviado'
  | 'contrato_firmado'
  | 'asistencia_induccion'
  | 'ticket_jira'
  | 'correo_corporativo'
  | 'direccion'
  | 'fecha_nacimiento'
  | 'genero'
  | 'estado_civil'
  | 'hijos'
  | 'infonavit'
  | 'fonacot'
  | 'talla'
  | 'beneficiario'
  | 'beneficiario_correo'
  | 'beneficiario_telefono'
  | 'beneficiario_parentesco'
  | 'contacto1_nombre'
  | 'contacto1_telefono'
  | 'contacto1_correo'
  | 'contacto1_parentesco'
  | 'contacto2_nombre'
  | 'contacto2_telefono'
  | 'contacto2_correo'
  | 'contacto2_parentesco'
  | 'pld_entidad_financiera'
  | 'pld_compania'
  | 'sobre_ti'
  | 'fecha_onboarding'
  | 'fecha_ejecucion'
  | 'nss'
  | 'rfc'
  | 'curp'
  | 'cp'
  | 'banco'
  | 'cuenta'
  | 'clabe';

export interface FieldDef {
  key: FieldKey;
  /** Shown in Configuración when a field has no column. */
  label: string;
  /** Header texts that mean this field. Compared with normalizeHeader. */
  headers: string[];
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'expediente', label: 'Expediente (carpeta de Drive)', headers: ['Expediente', 'Carpeta', 'Carpeta Drive'] },
  { key: 'etapa_actual', label: 'Etapa actual', headers: ['Etapa actual', 'Etapa'] },
  { key: 'candidate_reference', label: 'Referencia del candidato', headers: ['Candidate reference', 'Referencia', 'Referencia candidato'] },
  { key: 'nombre', label: 'Nombre', headers: ['Nombre', 'Nombre completo'] },
  { key: 'email_personal', label: 'Email personal', headers: ['Email personal', 'Correo personal', 'Email'] },
  { key: 'telefono', label: 'Teléfono', headers: ['Telefono', 'Celular'] },
  { key: 'departamento', label: 'Departamento', headers: ['Departamento'] },
  { key: 'puesto', label: 'Puesto', headers: ['Puesto'] },
  { key: 'ciudad', label: 'Ciudad', headers: ['Ciudad', 'Plaza'] },
  { key: 'internal_id', label: 'InternalID de la vacante', headers: ['InternalID', 'Internal ID'] },
  { key: 'reclutadora', label: 'Reclutadora', headers: ['Reclutadora', 'Reclutador'] },
  { key: 'fecha_carta_oferta', label: 'Fecha de carta oferta', headers: ['Fecha de carta oferta', 'Fecha carta oferta'] },
  { key: 'fecha_ingreso', label: 'Fecha de ingreso', headers: ['Fecha de ingreso', 'Fecha ingreso'] },
  { key: 'hiring_manager', label: 'Hiring Manager', headers: ['Hiring Manager'] },
  { key: 'contrato_enviado', label: 'Contrato enviado', headers: ['Contrato enviado'] },
  { key: 'contrato_firmado', label: 'Contrato firmado', headers: ['Contrato firmado'] },
  { key: 'asistencia_induccion', label: 'Asistencia a inducción', headers: ['Asistencia a induccion'] },
  { key: 'ticket_jira', label: 'Ticket Jira', headers: ['Ticket Jira', 'Jira'] },
  { key: 'correo_corporativo', label: 'Correo corporativo', headers: ['Correo corporativo'] },
  { key: 'direccion', label: 'Dirección', headers: ['Direccion', 'Domicilio'] },
  { key: 'fecha_nacimiento', label: 'Fecha de nacimiento', headers: ['Fecha de nacimiento'] },
  { key: 'genero', label: 'Género', headers: ['Genero', 'Sexo'] },
  { key: 'estado_civil', label: 'Estado civil', headers: ['Estado civil'] },
  { key: 'hijos', label: 'Hijos', headers: ['Hijos'] },
  { key: 'infonavit', label: 'Infonavit', headers: ['Infonavit'] },
  { key: 'fonacot', label: 'Fonacot', headers: ['Fonacot'] },
  { key: 'talla', label: 'Talla', headers: ['Talla', 'Talla playera'] },
  { key: 'beneficiario', label: 'Beneficiario', headers: ['Beneficiario'] },
  { key: 'beneficiario_correo', label: 'Correo del beneficiario', headers: ['Correo electronico beneficiario', 'Correo beneficiario'] },
  { key: 'beneficiario_telefono', label: 'Teléfono del beneficiario', headers: ['Telefono beneficiario'] },
  { key: 'beneficiario_parentesco', label: 'Parentesco del beneficiario', headers: ['Parentesco beneficiario'] },
  { key: 'contacto1_nombre', label: 'Contacto de emergencia 1', headers: ['Contacto de emergencia 1'] },
  { key: 'contacto1_telefono', label: 'Teléfono contacto 1', headers: ['Telefono contacto 1'] },
  { key: 'contacto1_correo', label: 'Correo contacto 1', headers: ['Correo electronico contacto 1', 'Correo contacto 1'] },
  { key: 'contacto1_parentesco', label: 'Parentesco contacto 1', headers: ['Parentesco contacto 1'] },
  { key: 'contacto2_nombre', label: 'Contacto de emergencia 2', headers: ['Contacto de emergencia 2'] },
  { key: 'contacto2_telefono', label: 'Teléfono contacto 2', headers: ['Telefono contacto 2'] },
  { key: 'contacto2_correo', label: 'Correo contacto 2', headers: ['Correo electronico contacto 2', 'Correo contacto 2'] },
  { key: 'contacto2_parentesco', label: 'Parentesco contacto 2', headers: ['Parentesco contacto 2'] },
  { key: 'pld_entidad_financiera', label: 'PLD: trabajó en entidad financiera', headers: ['PLD Trabajo en entidad financiera'] },
  { key: 'pld_compania', label: 'PLD: compañía', headers: ['PLD Compania'] },
  { key: 'sobre_ti', label: 'Cuéntanos un poco sobre ti', headers: ['Cuentanos un poco sobre ti'] },
  { key: 'fecha_onboarding', label: 'Fecha onboarding iniciado', headers: ['Fecha onboarding iniciado'] },
  { key: 'fecha_ejecucion', label: 'Fecha de ejecución', headers: ['Fecha ejecucion', 'Fecha de ejecucion'] },
  { key: 'nss', label: 'NSS', headers: ['NSS'] },
  { key: 'rfc', label: 'RFC', headers: ['RFC'] },
  { key: 'curp', label: 'CURP', headers: ['CURP'] },
  { key: 'cp', label: 'Código postal', headers: ['CP', 'Codigo postal'] },
  { key: 'banco', label: 'Banco', headers: ['Banco'] },
  { key: 'cuenta', label: 'Cuenta', headers: ['Cuenta', 'Numero de cuenta'] },
  { key: 'clabe', label: 'CLABE interbancaria', headers: ['CLABE interbancaria', 'CLABE'] },
];

/**
 * Without these a row cannot be traced back to a person, so a sheet whose
 * headers do not cover them is not written at all rather than half written.
 */
export const REQUIRED_FIELDS: FieldKey[] = ['nombre', 'email_personal'];

/**
 * The original fixed layout, column A onwards. null = a column we have no data
 * for (manual columns, the passwords): written as an empty cell in this mode.
 */
export const LEGACY_LAYOUT: (FieldKey | null)[] = [
  'expediente', 'etapa_actual', 'candidate_reference', 'nombre', 'email_personal',
  'telefono', 'departamento', 'puesto', 'ciudad', 'internal_id',
  'reclutadora', null /* Fuente */, 'fecha_carta_oferta', 'fecha_ingreso', 'hiring_manager',
  null /* Email Manager */, null /* Aprobador Asignado */, 'contrato_enviado', 'contrato_firmado', null /* Alta en Humand */,
  'asistencia_induccion', null /* Apertura de Tienda */, 'ticket_jira', 'correo_corporativo', null /* Contraseña */,
  'direccion', 'fecha_nacimiento', 'genero', 'estado_civil', 'hijos',
  'infonavit', 'fonacot', 'talla', 'beneficiario', 'beneficiario_correo',
  'beneficiario_telefono', 'beneficiario_parentesco', 'contacto1_nombre', 'contacto1_telefono', 'contacto1_correo',
  'contacto1_parentesco', 'contacto2_nombre', 'contacto2_telefono', 'contacto2_correo', 'contacto2_parentesco',
  'pld_entidad_financiera', 'pld_compania', 'sobre_ti', 'fecha_onboarding', 'fecha_ejecucion',
  'correo_corporativo' /* duplicado */, null /* Contraseña (dup) */, null /* Correo corporativo MANUAL */, null /* Contraseña MANUAL */, 'nss',
  'rfc', 'curp', 'cp', 'banco', 'cuenta',
  'clabe',
];

// ─── Building the values ──────────────────────────────────────────────────────

function fmtDate(ts: unknown): string {
  if (!ts) return '';
  const d = (ts as { toDate?: () => Date }).toDate?.() ?? (ts instanceof Date ? ts : new Date(String(ts)));
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

function fmtDateTime(ts: unknown): string {
  if (!ts) return '';
  const d = (ts as { toDate?: () => Date }).toDate?.() ?? (ts instanceof Date ? ts : new Date(String(ts)));
  return isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function estadoCivilLabel(v: unknown): string {
  const map: Record<string, string> = {
    soltero: 'SOLTERO/A',
    casado: 'CASADO/A',
    union_libre: 'UNIÓN LIBRE',
  };
  return map[String(v ?? '')] ?? '';
}

function parentescoLabel(v: unknown): string {
  const map: Record<string, string> = {
    padre_madre: 'PADRE / MADRE',
    hermano: 'HERMANO(A)',
    esposo: 'ESPOSO(A)',
    hijo: 'HIJO(A)',
  };
  return map[String(v ?? '')] ?? '';
}

function yesno(v: unknown): string {
  if (v === true) return 'SI';
  if (v === false) return 'NO';
  return '';
}

function getOcrField(docs: Record<string, unknown>, docType: string, field: string): string {
  const doc = docs[docType] as Record<string, unknown> | undefined;
  if (!doc || doc.status !== 'valid') return '';
  const extracted = ((doc.ocrResult as Record<string, unknown> | undefined)?.extractedData as Record<string, string>) ?? {};
  return extracted[field] ?? '';
}

function sexoToGenero(sexo: string): string {
  if (sexo === 'H') return 'MASCULINO';
  if (sexo === 'M') return 'FEMENINO';
  return sexo;
}

function mergedField(ov: Record<string, string>, docs: Record<string, unknown>, key: string): string {
  if (ov[key]) return ov[key];
  switch (key) {
    case 'curp':           return getOcrField(docs, 'curp', 'curp') || getOcrField(docs, 'ine', 'curp');
    case 'rfc':            return getOcrField(docs, 'constancia_fiscal', 'rfc');
    case 'nss':            return getOcrField(docs, 'nss', 'nss');
    case 'clabe':          return getOcrField(docs, 'caratula_bancaria', 'clabe');
    case 'banco':          return getOcrField(docs, 'caratula_bancaria', 'banco');
    case 'numero_cuenta':  return getOcrField(docs, 'caratula_bancaria', 'numero_cuenta');
    case 'domicilio':      return getOcrField(docs, 'ine', 'domicilio');
    case 'cp':             return getOcrField(docs, 'comprobante_domicilio', 'cp');
    case 'fecha_nacimiento': return getOcrField(docs, 'acta_nacimiento', 'fecha_nacimiento');
    case 'genero':         return sexoToGenero(getOcrField(docs, 'ine', 'sexo'));
    default:               return '';
  }
}

export interface RowContext {
  /** Candidate folder in the primary Drive destination ('' when there is none). */
  folderId: string;
  recruiterName: string;
  jobExternalId: string | undefined;
  /** Injected so tests are deterministic. */
  now?: Date;
}

/** Every value of the onboarding row, keyed by field. */
export function buildCandidateFields(
  candidate: Record<string, unknown>,
  ctx: RowContext
): Record<FieldKey, string> {
  const a = (candidate.formAnswers ?? {}) as Record<string, unknown>;
  const ov = (candidate.dataOverrides ?? {}) as Record<string, string>;
  const docs = (candidate.documents ?? {}) as Record<string, unknown>;
  const city = ctx.jobExternalId ? ctx.jobExternalId.trim().split(/\s+/).pop() ?? '' : '';

  return {
    expediente: ctx.folderId ? `https://drive.google.com/drive/folders/${ctx.folderId}` : '',
    etapa_actual: 'Onboarding Iniciado',
    candidate_reference:
      (candidate.viterbitReference as string) ?? (candidate.viterbitCandidatureId as string) ?? '',
    nombre: `${candidate.firstName} ${candidate.lastName}`.toUpperCase(),
    email_personal: (candidate.email as string) ?? '',
    telefono: (candidate.phone as string) ?? '',
    departamento: (candidate.viterbitCompany as string) ?? '',
    puesto: (candidate.profile as string) || (candidate.position as string) || '',
    ciudad: city,
    internal_id: ctx.jobExternalId ?? '',
    reclutadora: ctx.recruiterName,
    fecha_carta_oferta: fmtDate(candidate.offerSignedAt),
    fecha_ingreso: (candidate.viterbitStartDate as string) ?? '',
    hiring_manager: (candidate.viterbitHiringManager as string) ?? '',
    contrato_enviado: 'TRUE',
    contrato_firmado: 'TRUE',
    asistencia_induccion: candidate.activatedAt ? 'TRUE' : '',
    ticket_jira: (candidate.jiraTicketKey as string) ?? '',
    correo_corporativo: (candidate.corporateEmail as string) ?? '',
    direccion: mergedField(ov, docs, 'domicilio'),
    fecha_nacimiento: mergedField(ov, docs, 'fecha_nacimiento'),
    genero: mergedField(ov, docs, 'genero'),
    estado_civil: estadoCivilLabel(a.estadoCivil),
    hijos: yesno(a.tieneHijos),
    infonavit: yesno(a.tieneInfonavit),
    fonacot: yesno(a.tieneFonacot),
    talla: (a.tallaPlayera as string) ?? '',
    beneficiario: (a.beneficiarioNombre as string) ?? '',
    beneficiario_correo: (a.beneficiarioCorreo as string) || 'No aplica',
    beneficiario_telefono: (a.beneficiarioTelefono as string) || 'No aplica',
    beneficiario_parentesco: parentescoLabel(a.beneficiarioParentesco),
    contacto1_nombre: (a.contacto1Nombre as string) ?? '',
    contacto1_telefono: (a.contacto1Telefono as string) || 'No aplica',
    contacto1_correo: (a.contacto1Correo as string) || 'No aplica',
    contacto1_parentesco: parentescoLabel(a.contacto1Parentesco),
    contacto2_nombre: (a.contacto2Nombre as string) ?? '',
    contacto2_telefono: (a.contacto2Telefono as string) || 'No aplica',
    contacto2_correo: (a.contacto2Correo as string) || 'No aplica',
    contacto2_parentesco: parentescoLabel(a.contacto2Parentesco),
    pld_entidad_financiera: yesno(a.trabajoEntidadFinanciera),
    pld_compania: (a.nombreEntidadFinanciera as string) ?? '',
    sobre_ti: (a.sobreTi as string) ?? '',
    fecha_onboarding: fmtDateTime(candidate.activatedAt),
    fecha_ejecucion: fmtDateTime(ctx.now ?? new Date()),
    nss: mergedField(ov, docs, 'nss'),
    rfc: mergedField(ov, docs, 'rfc'),
    curp: mergedField(ov, docs, 'curp'),
    cp: mergedField(ov, docs, 'cp'),
    banco: mergedField(ov, docs, 'banco'),
    cuenta: mergedField(ov, docs, 'numero_cuenta'),
    clabe: mergedField(ov, docs, 'clabe'),
  };
}

// ─── Placing the values ───────────────────────────────────────────────────────

/** Case, accents, punctuation and spacing do not count when matching headers. */
export function normalizeHeader(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The original layout, cut at maxColumns when the rest belongs to the sheet. */
export function rowByPosition(fields: Record<FieldKey, string>, maxColumns: number | null): string[] {
  const row = LEGACY_LAYOUT.map((key) => (key ? fields[key] : ''));
  return maxColumns && maxColumns > 0 ? row.slice(0, maxColumns) : row;
}

export interface HeaderMapping {
  /** Column index of every field that found one (a field may fill several). */
  columnsByField: Partial<Record<FieldKey, number[]>>;
  /** Fields with no column in this sheet. */
  unmatchedFields: FieldKey[];
  /** Required fields with no column: the sheet cannot be written. */
  missingRequired: FieldKey[];
  /** Non-empty headers no field maps to — left untouched on every write. */
  unmappedHeaders: { index: number; header: string }[];
}

/**
 * Matches the tab's header row against the fields. `overrides` (field → header
 * text, set from Configuración) wins over the built-in aliases, for sheets
 * whose titles we cannot anticipate. Duplicate headers ("Correo corporativo"
 * twice) all receive the value.
 */
export function mapHeaders(
  headers: string[],
  overrides: Partial<Record<FieldKey, string>> = {}
): HeaderMapping {
  const normalized = headers.map(normalizeHeader);
  const columnsByField: Partial<Record<FieldKey, number[]>> = {};
  const used = new Set<number>();

  for (const def of FIELD_DEFS) {
    const override = overrides[def.key];
    const wanted = new Set(
      (override ? [override] : def.headers).map(normalizeHeader).filter(Boolean)
    );
    const columns: number[] = [];
    normalized.forEach((header, index) => {
      if (header && wanted.has(header)) columns.push(index);
    });
    if (columns.length > 0) {
      columnsByField[def.key] = columns;
      columns.forEach((index) => used.add(index));
    }
  }

  const unmatchedFields = FIELD_DEFS.map((d) => d.key).filter((key) => !columnsByField[key]);
  return {
    columnsByField,
    unmatchedFields,
    missingRequired: REQUIRED_FIELDS.filter((key) => !columnsByField[key]),
    unmappedHeaders: headers
      .map((header, index) => ({ index, header: String(header ?? '').trim() }))
      .filter(({ index, header }) => header && !used.has(index)),
  };
}

/**
 * The row for a header-mapped sheet: values under their columns, null
 * everywhere else so Sheets leaves those cells alone. Trailing nulls are
 * dropped.
 */
export function rowByHeaders(fields: Record<FieldKey, string>, mapping: HeaderMapping): (string | null)[] {
  const row: (string | null)[] = [];
  for (const [key, columns] of Object.entries(mapping.columnsByField) as [FieldKey, number[]][]) {
    for (const index of columns) {
      while (row.length <= index) row.push(null);
      row[index] = fields[key];
    }
  }
  return row;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Column holding the candidate reference, for de-duplication; null if unknown. */
export function referenceColumn(mode: 'encabezados' | 'posicion', mapping: HeaderMapping | null): number | null {
  if (mode === 'posicion') return LEGACY_LAYOUT.indexOf('candidate_reference');
  return mapping?.columnsByField.candidate_reference?.[0] ?? null;
}
