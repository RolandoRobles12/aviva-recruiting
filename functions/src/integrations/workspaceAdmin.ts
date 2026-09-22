// Callables behind Configuración → Drive y Sheets. Same permission as the rest
// of Configuración (config_settings), since these decide where candidates'
// personal data is written.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../utils/admin';
import { userHasPermission } from '../utils/permissions';
import { DRIVE_SERVICE_ACCOUNT } from '../utils/secrets';
import { getDriveClient } from './driveService';
import { getSheetsClient, mappingFor, readHeaders, resolveTabTitle } from './sheetsService';
import { FIELD_DEFS, LEGACY_LAYOUT, normalizeHeader, type FieldKey } from './sheetsRow';
import {
  clearWorkspaceSettingsCache,
  getWorkspaceSettings,
  normalizeWorkspaceSettings,
  workspaceSettingsProblems,
  WORKSPACE_SETTINGS_DOC,
  type DriveDestination,
  type SheetDestination,
} from './workspaceSettings';

/** Same defaults as the client's config_settings permission. */
const SETTINGS_DEFAULTS = { reclutador: false, lider: true, nomina: false, legal: false };

async function requireSettingsManager(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'No autenticado');
  const allowed = await userHasPermission(uid, 'config_settings', SETTINGS_DEFAULTS);
  if (!allowed) {
    throw new HttpsError('permission-denied', 'No tienes permiso para configurar Drive y Sheets.');
  }
}

function serviceAccount(): { json: object; email: string } {
  const json = JSON.parse(DRIVE_SERVICE_ACCOUNT.value()) as { client_email?: string };
  return { json, email: json.client_email ?? '' };
}

/**
 * The settings in force (seeding them from the legacy destinations the first
 * time), plus the service account e-mail the folders and sheets must be shared
 * with, and the field catalogue for the manual column mapping.
 */
export const getWorkspaceIntegrationSettings = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    await requireSettingsManager(request.auth?.uid);
    clearWorkspaceSettingsCache();
    const settings = await getWorkspaceSettings();
    return {
      settings,
      serviceAccountEmail: serviceAccount().email,
      fields: FIELD_DEFS.map(({ key, label }) => ({ key, label })),
    };
  }
);

export interface DriveCheck {
  id: string;
  label: string;
  ok: boolean;
  folderName?: string;
  message: string;
}

export interface SheetCheck {
  id: string;
  label: string;
  ok: boolean;
  spreadsheetTitle?: string;
  tabTitle?: string;
  columnMode: SheetDestination['columnMode'];
  headers: string[];
  /** encabezados: field → header it lands under. */
  matched: { key: FieldKey; label: string; headers: string[] }[];
  unmatched: { key: FieldKey; label: string }[];
  missingRequired: FieldKey[];
  unmappedHeaders: string[];
  /** posicion: columns whose header does not look like the field written there. */
  positionMismatches: { column: number; header: string; expected: string }[];
  message: string;
}

async function checkDrive(drive: ReturnType<typeof getDriveClient>, dest: DriveDestination): Promise<DriveCheck> {
  try {
    const res = await drive.files.get({
      fileId: dest.folderId,
      fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)',
      supportsAllDrives: true,
    });
    const file = res.data;
    if (file.mimeType !== 'application/vnd.google-apps.folder') {
      return { id: dest.id, label: dest.label, ok: false, folderName: file.name ?? '', message: 'El ID no es de una carpeta.' };
    }
    if (file.trashed) {
      return { id: dest.id, label: dest.label, ok: false, folderName: file.name ?? '', message: 'La carpeta está en la papelera.' };
    }
    if (!file.capabilities?.canAddChildren) {
      return {
        id: dest.id,
        label: dest.label,
        ok: false,
        folderName: file.name ?? '',
        message: 'La cuenta de servicio puede ver la carpeta pero no crear carpetas dentro: compártela como Editor.',
      };
    }
    return { id: dest.id, label: dest.label, ok: true, folderName: file.name ?? '', message: 'Acceso correcto.' };
  } catch (err) {
    const code = (err as { code?: number }).code;
    return {
      id: dest.id,
      label: dest.label,
      ok: false,
      message:
        code === 404 || code === 403
          ? 'No se encontró o la cuenta de servicio no tiene acceso: comparte la carpeta con ella como Editor.'
          : `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const FIELD_LABEL = new Map(FIELD_DEFS.map((d) => [d.key, d.label]));

async function checkSheet(sheets: ReturnType<typeof getSheetsClient>, dest: SheetDestination): Promise<SheetCheck> {
  const base: SheetCheck = {
    id: dest.id,
    label: dest.label,
    ok: false,
    columnMode: dest.columnMode,
    headers: [],
    matched: [],
    unmatched: [],
    missingRequired: [],
    unmappedHeaders: [],
    positionMismatches: [],
    message: '',
  };
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: dest.spreadsheetId, fields: 'properties(title)' });
    base.spreadsheetTitle = meta.data.properties?.title ?? '';
    const title = await resolveTabTitle(sheets, dest);
    base.tabTitle = title;
    const headers = await readHeaders(sheets, dest.spreadsheetId, title);
    base.headers = headers;

    // The mapping is reported in both modes, so an admin can see whether a
    // sheet still on 'posicion' is ready to switch.
    const mapping = mappingFor(dest, headers);
    base.matched = (Object.entries(mapping.columnsByField) as [FieldKey, number[]][]).map(([key, columns]) => ({
      key,
      label: FIELD_LABEL.get(key) ?? key,
      headers: columns.map((i) => headers[i]),
    }));
    base.unmatched = mapping.unmatchedFields.map((key) => ({ key, label: FIELD_LABEL.get(key) ?? key }));
    base.missingRequired = mapping.missingRequired;
    base.unmappedHeaders = mapping.unmappedHeaders.map((h) => h.header);

    if (dest.columnMode === 'posicion') {
      const limit = dest.maxColumns ?? LEGACY_LAYOUT.length;
      LEGACY_LAYOUT.slice(0, limit).forEach((key, column) => {
        if (!key) return;
        const header = headers[column] ?? '';
        const def = FIELD_DEFS.find((d) => d.key === key)!;
        const expected = dest.headerMap[key] ? [dest.headerMap[key]!] : def.headers;
        if (!expected.map(normalizeHeader).includes(normalizeHeader(header))) {
          base.positionMismatches.push({ column, header, expected: def.label });
        }
      });
      base.ok = true;
      base.message =
        base.positionMismatches.length === 0
          ? 'Acceso correcto. Los encabezados coinciden con el orden fijo.'
          : `Acceso correcto, pero ${base.positionMismatches.length} columna(s) no parecen coincidir con el orden fijo: revísalas o cambia a "por encabezado".`;
    } else {
      base.ok = mapping.missingRequired.length === 0;
      base.message = base.ok
        ? `Acceso correcto. ${base.matched.length} de ${FIELD_DEFS.length} datos tienen columna.`
        : `Faltan columnas obligatorias (${mapping.missingRequired.map((k) => FIELD_LABEL.get(k)).join(', ')}): no se escribiría nada en esta hoja.`;
    }
    return base;
  } catch (err) {
    const code = (err as { code?: number }).code;
    base.message =
      code === 404 || code === 403
        ? 'No se encontró o la cuenta de servicio no tiene acceso: comparte la hoja con ella como Editor.'
        : `Error: ${err instanceof Error ? err.message : String(err)}`;
    return base;
  }
}

/**
 * Checks the settings being edited (not necessarily saved) against Google:
 * access to every folder and spreadsheet, the real tab name, and how the row
 * would map onto each sheet's headers. Read-only — it never writes.
 */
export const testWorkspaceConnection = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 120 },
  async (request) => {
    await requireSettingsManager(request.auth?.uid);
    const settings = normalizeWorkspaceSettings((request.data as { settings?: unknown })?.settings);
    const sa = serviceAccount();
    const drive = getDriveClient(sa.json);
    const sheets = getSheetsClient(sa.json);

    const [drives, sheetChecks] = await Promise.all([
      Promise.all(settings.drives.map((d) => checkDrive(drive, d))),
      Promise.all(settings.sheets.map((s) => checkSheet(sheets, s))),
    ]);
    return { serviceAccountEmail: sa.email, drives, sheets: sheetChecks };
  }
);

/**
 * Saves the settings after normalizing them here, so what is stored is exactly
 * what the sync will read. Invalid entries are refused with
 * a message rather than silently dropped.
 */
export const saveWorkspaceIntegrationSettings = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    await requireSettingsManager(request.auth?.uid);
    const raw = (request.data as { settings?: unknown })?.settings;
    const problems = workspaceSettingsProblems(raw);
    if (problems.length > 0) {
      throw new HttpsError('invalid-argument', problems.join(' '));
    }
    const settings = normalizeWorkspaceSettings(raw);
    await db.doc(WORKSPACE_SETTINGS_DOC).set({
      ...settings,
      updatedAtIso: new Date().toISOString(),
      updatedBy: request.auth?.uid ?? null,
    });
    clearWorkspaceSettingsCache();
    return { settings };
  }
);
