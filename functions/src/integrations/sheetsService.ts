// Appending the onboarding row to every configured spreadsheet.
//
// Destinations come from settings/google_workspace (see workspaceSettings.ts);
// what goes in the row and how it is placed lives in sheetsRow.ts. This file is
// only the Google Sheets side: finding the tab, reading its headers, checking
// the candidate is not already there, and appending.

import { google, type sheets_v4 } from 'googleapis';
import type { SheetDestination } from './workspaceSettings';
import {
  buildCandidateFields,
  columnLetter,
  mapHeaders,
  referenceColumn,
  rowByHeaders,
  rowByPosition,
  type FieldKey,
  type HeaderMapping,
  type RowContext,
} from './sheetsRow';

type SheetsClient = sheets_v4.Sheets;

export function getSheetsClient(serviceAccountJson: object): SheetsClient {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** A1 range prefix for a tab, quoting the title the way Sheets expects. */
function tabRange(title: string, range: string): string {
  return `'${title.replace(/'/g, "''")}'!${range}`;
}

const titleCache = new Map<string, string>();

/**
 * The tab's current title. Looked up by gid when there is one, because the gid
 * survives renames; the stored title is the fallback.
 */
export async function resolveTabTitle(sheets: SheetsClient, dest: SheetDestination): Promise<string> {
  if (dest.sheetGid === null) {
    if (!dest.sheetTitle) throw new Error('No hay pestaña configurada (ni gid ni nombre).');
    return dest.sheetTitle;
  }
  const key = `${dest.spreadsheetId}#${dest.sheetGid}`;
  const cached = titleCache.get(key);
  if (cached) return cached;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: dest.spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const match = meta.data.sheets?.find((s) => s.properties?.sheetId === dest.sheetGid);
  const title = match?.properties?.title;
  if (title) {
    titleCache.set(key, title);
    return title;
  }
  if (dest.sheetTitle) {
    console.warn(`[sheetsService] ${dest.label}: no tab with gid ${dest.sheetGid}, using "${dest.sheetTitle}"`);
    return dest.sheetTitle;
  }
  throw new Error(`No existe una pestaña con gid ${dest.sheetGid} en la hoja.`);
}

export async function readHeaders(sheets: SheetsClient, spreadsheetId: string, title: string): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabRange(title, '1:1'),
  });
  return ((res.data.values?.[0] ?? []) as unknown[]).map((v) => String(v ?? ''));
}

/** Whether the candidate reference already appears in the given column. */
async function referenceExists(
  sheets: SheetsClient,
  spreadsheetId: string,
  title: string,
  column: number,
  reference: string
): Promise<boolean> {
  const letter = columnLetter(column);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabRange(title, `${letter}2:${letter}`),
  });
  const wanted = reference.trim();
  return (res.data.values ?? []).some((row) => String(row?.[0] ?? '').trim() === wanted);
}

export type SheetAppendStatus = 'agregada' | 'ya_existia' | 'omitida' | 'error';

export interface SheetAppendResult {
  id: string;
  label: string;
  status: SheetAppendStatus;
  message?: string;
}

/** Header mapping for a destination, honouring its per-field overrides. */
export function mappingFor(dest: SheetDestination, headers: string[]): HeaderMapping {
  return mapHeaders(headers, dest.headerMap);
}

async function appendToDestination(
  sheets: SheetsClient,
  dest: SheetDestination,
  fields: Record<FieldKey, string>
): Promise<SheetAppendResult> {
  const base = { id: dest.id, label: dest.label };
  const title = await resolveTabTitle(sheets, dest);

  let row: (string | null)[];
  let mapping: HeaderMapping | null = null;
  if (dest.columnMode === 'encabezados') {
    mapping = mappingFor(dest, await readHeaders(sheets, dest.spreadsheetId, title));
    if (mapping.missingRequired.length > 0) {
      // Writing without a name or e-mail column would leave an untraceable
      // row; better to fail loudly and let the admin fix the mapping.
      return {
        ...base,
        status: 'error',
        message: `Faltan columnas obligatorias: ${mapping.missingRequired.join(', ')}. Revísalo en Configuración → Drive y Sheets.`,
      };
    }
    row = rowByHeaders(fields, mapping);
  } else {
    row = rowByPosition(fields, dest.maxColumns);
  }

  // A retry, a manual "Agregar a Sheets" or a re-signed contract used to add
  // the same person again.
  const refColumn = referenceColumn(dest.columnMode, mapping);
  const reference = fields.candidate_reference;
  if (refColumn !== null && reference) {
    if (await referenceExists(sheets, dest.spreadsheetId, title, refColumn, reference)) {
      return { ...base, status: 'ya_existia', message: `La referencia ${reference} ya está en la hoja.` };
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: dest.spreadsheetId,
    range: tabRange(title, 'A1'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    // null cells are skipped by the API, so unmapped columns keep whatever the
    // sheet puts there.
    requestBody: { values: [row as unknown[]] },
  });
  return { ...base, status: 'agregada' };
}

/**
 * Appends the candidate's row to every enabled spreadsheet. Each destination is
 * attempted independently; the per-destination outcome is returned, and the
 * call throws at the end when any of them failed, so callers that only log
 * errors keep doing so.
 */
export async function appendCandidateRow(
  candidate: Record<string, unknown>,
  ctx: RowContext,
  destinations: SheetDestination[],
  serviceAccountJson: object
): Promise<SheetAppendResult[]> {
  const fields = buildCandidateFields(candidate, ctx);
  const sheets = getSheetsClient(serviceAccountJson);
  const results: SheetAppendResult[] = [];

  for (const dest of destinations) {
    if (!dest.enabled) {
      results.push({ id: dest.id, label: dest.label, status: 'omitida', message: 'Destino desactivado.' });
      continue;
    }
    try {
      const result = await appendToDestination(sheets, dest, fields);
      results.push(result);
      console.log(`[sheetsService] ${dest.label}: ${result.status} (${candidate.email})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sheetsService] ${dest.label}: append failed for ${candidate.email}:`, err);
      results.push({ id: dest.id, label: dest.label, status: 'error', message });
    }
  }

  const failed = results.filter((r) => r.status === 'error');
  if (failed.length > 0) {
    const error = new Error(
      `Sheets incompleto — ${failed.map((r) => `${r.label}: ${r.message}`).join('; ')}`
    ) as Error & { results?: SheetAppendResult[] };
    error.results = results;
    throw error;
  }
  return results;
}
