import { google } from 'googleapis';

const SPREADSHEET_ID = '1LiuRz3AgJriRjCBnSCUcF7HGvzWIyx3v9FEesBLXgmA';

// Second spreadsheet: mirrors the master's first 54 columns (no NSS→CLABE
// block); its trailing "Enviar correo / Confirmación / Status" columns are
// managed by that sheet's own automation, so we never write them.
const SECONDARY_SPREADSHEET_ID = '1P50cy7O0Lzfm3E_FX19nV0nfB0WVkLWYQycttrWvaW8';
const SECONDARY_SHEET_GID = 1726630616;
const SECONDARY_COLUMN_COUNT = 54;

let secondarySheetTitle: string | null = null;

/** Resolve a tab's title from its gid (the URL only gives us the gid). */
async function resolveSecondarySheetTitle(
  sheets: ReturnType<typeof google.sheets>,
): Promise<string> {
  if (secondarySheetTitle) return secondarySheetTitle;
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SECONDARY_SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const match = meta.data.sheets?.find((s) => s.properties?.sheetId === SECONDARY_SHEET_GID);
  if (!match?.properties?.title) {
    throw new Error(`No tab with gid ${SECONDARY_SHEET_GID} in spreadsheet ${SECONDARY_SPREADSHEET_ID}`);
  }
  secondarySheetTitle = match.properties.title;
  return secondarySheetTitle;
}

function getSheetsClient(serviceAccountJson: object) {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

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

/**
 * Appends one candidate row to the Base automatizada MASTER spreadsheet and
 * to the secondary spreadsheet (same layout, first 54 columns only).
 * Call this after contract signing + Drive folder creation.
 * Each append is attempted independently; throws at the end if any failed.
 */
export async function appendCandidateRow(
  candidate: Record<string, unknown>,
  folderId: string,
  recruiterName: string,
  jobExternalId: string | undefined,
  serviceAccountJson: object,
): Promise<void> {
  const a   = (candidate.formAnswers  ?? {}) as Record<string, unknown>;
  const ov  = (candidate.dataOverrides ?? {}) as Record<string, string>;
  const docs = (candidate.documents   ?? {}) as Record<string, unknown>;
  const city = jobExternalId ? jobExternalId.trim().split(/\s+/).pop() ?? '' : '';

  // 61 columns — order must match the spreadsheet header exactly
  const row: string[] = [
    /* 01 Expediente */                          `https://drive.google.com/drive/folders/${folderId}`,
    /* 02 Etapa actual */                        'Onboarding Iniciado',
    /* 03 Candidate reference */                 (candidate.viterbitReference as string) ?? (candidate.viterbitCandidatureId as string) ?? '',
    /* 04 Nombre */                              `${candidate.firstName} ${candidate.lastName}`.toUpperCase(),
    /* 05 Email personal */                      (candidate.email as string) ?? '',
    /* 06 Telefono */                            (candidate.phone as string) ?? '',
    /* 07 Departamento */                        (candidate.viterbitCompany as string) ?? '',
    /* 08 Puesto */                              (candidate.profile as string) || (candidate.position as string) || '',
    /* 09 Ciudad */                              city,
    /* 10 InternalID */                          jobExternalId ?? '',
    /* 11 Reclutadora */                         recruiterName,
    /* 12 Fuente */                              '',
    /* 13 Fecha de carta oferta */               fmtDate(candidate.offerSignedAt),
    /* 14 Fecha de ingreso */                    (candidate.viterbitStartDate as string) ?? '',
    /* 15 Hiring Manager */                      (candidate.viterbitHiringManager as string) ?? '',
    /* 16 Email Manager */                       '',
    /* 17 Aprobador Asignado */                  '',
    /* 18 Contrato enviado */                    'TRUE',
    /* 19 Contrato Firmado */                    'TRUE',
    /* 20 Alta en Humand */                      '',
    /* 21 Asistencia a inducción */              candidate.activatedAt ? 'TRUE' : '',
    /* 22 Apertura de Tienda */                  '',
    /* 23 Ticket Jira */                         (candidate.jiraTicketKey as string) ?? '',
    /* 24 Correo corporativo */                  (candidate.corporateEmail as string) ?? '',
    /* 25 Contraseña */                          (candidate.viterbitContrasena as string) ?? '',
    /* 26 Dirección */                           mergedField(ov, docs, 'domicilio'),
    /* 27 Fecha de nacimiento */                 mergedField(ov, docs, 'fecha_nacimiento'),
    /* 28 Género */                              mergedField(ov, docs, 'genero'),
    /* 29 Estado civil */                        estadoCivilLabel(a.estadoCivil),
    /* 30 Hijos */                               yesno(a.tieneHijos),
    /* 31 Infonavit */                           yesno(a.tieneInfonavit),
    /* 32 Fonacot */                             yesno(a.tieneFonacot),
    /* 33 Talla */                               (a.tallaPlayera as string) ?? '',
    /* 34 Beneficiario */                        (a.beneficiarioNombre as string) ?? '',
    /* 35 Correo electrónico beneficiario */     (a.beneficiarioCorreo as string) || 'No aplica',
    /* 36 Teléfono beneficiario */               (a.beneficiarioTelefono as string) || 'No aplica',
    /* 37 Parentesco beneficiario */             parentescoLabel(a.beneficiarioParentesco),
    /* 38 Contacto de emergencia 1 */            (a.contacto1Nombre as string) ?? '',
    /* 39 Teléfono contacto 1 */                 (a.contacto1Telefono as string) || 'No aplica',
    /* 40 Correo electrónico contacto 1 */       (a.contacto1Correo as string) || 'No aplica',
    /* 41 Parentesco contacto 1 */               parentescoLabel(a.contacto1Parentesco),
    /* 42 Contacto de emergencia 2 */            (a.contacto2Nombre as string) ?? '',
    /* 43 Teléfono contacto 2 */                 (a.contacto2Telefono as string) || 'No aplica',
    /* 44 Correo electrónico contacto 2 */       (a.contacto2Correo as string) || 'No aplica',
    /* 45 Parentesco contacto 2 */               parentescoLabel(a.contacto2Parentesco),
    /* 46 PLD Trabajo en entidad financiera */   yesno(a.trabajoEntidadFinanciera),
    /* 47 PLD Compañía */                        (a.nombreEntidadFinanciera as string) ?? '',
    /* 48 Cuéntanos un poco sobre ti */          (a.sobreTi as string) ?? '',
    /* 49 Fecha onboarding iniciado */           fmtDateTime(candidate.activatedAt),
    /* 50 Fecha ejecución */                     fmtDateTime(new Date()),
    /* 51 Correo corporativo (dup) */            (candidate.corporateEmail as string) ?? '',
    /* 52 Contraseña (dup) */                    (candidate.viterbitContrasena as string) ?? '',
    /* 53 Correo corporativo MANUAL */           '',
    /* 54 Contraseña MANUAL */                   '',
    /* 55 NSS */                                 mergedField(ov, docs, 'nss'),
    /* 56 RFC */                                 mergedField(ov, docs, 'rfc'),
    /* 57 CURP */                                mergedField(ov, docs, 'curp'),
    /* 58 CP */                                  mergedField(ov, docs, 'cp'),
    /* 59 BANCO */                               mergedField(ov, docs, 'banco'),
    /* 60 CUENTA */                              mergedField(ov, docs, 'numero_cuenta'),
    /* 61 CLABE INTERBANCARIA */                 mergedField(ov, docs, 'clabe'),
  ];

  const sheets = getSheetsClient(serviceAccountJson);
  const errors: string[] = [];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'MASTER_ROLANDO!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    console.log(`[sheetsService] MASTER row appended for ${candidate.email}`);
  } catch (err) {
    console.error(`[sheetsService] MASTER append failed for ${candidate.email}:`, err);
    errors.push(`MASTER: ${err}`);
  }

  try {
    const title = await resolveSecondarySheetTitle(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SECONDARY_SPREADSHEET_ID,
      range: `'${title}'!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row.slice(0, SECONDARY_COLUMN_COUNT)] },
    });
    console.log(`[sheetsService] Secondary row appended for ${candidate.email}`);
  } catch (err) {
    console.error(`[sheetsService] Secondary append failed for ${candidate.email}:`, err);
    errors.push(`Secundario: ${err}`);
  }

  if (errors.length) {
    throw new Error(`Sheets append incompleto — ${errors.join('; ')}`);
  }
}
