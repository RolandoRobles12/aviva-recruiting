// Where candidate data goes in Google Workspace: which Drive folders receive the
// expediente and which spreadsheets receive the onboarding row.
//
// This used to be three constants in driveService.ts / sheetsService.ts, so
// pointing at a new folder, a new spreadsheet or a new tab meant a code change
// and a deploy. It now lives in settings/google_workspace, edited from
// Configuración → Drive y Sheets, and it is a *list* on both sides: the same
// expediente can be mirrored into several Drives and the same row appended to
// several spreadsheets.
//
// The pure parts (normalization, URL parsing) are kept free of Firestore so
// they can be tested directly; the reads live at the bottom.

import { FIELD_DEFS, type FieldKey } from './sheetsRow';

export type SheetColumnMode = 'encabezados' | 'posicion';

export interface DriveDestination {
  /** Stable key, used to remember the folder created for each candidate. */
  id: string;
  label: string;
  /** Parent folder in which one folder per candidate is created. */
  folderId: string;
  enabled: boolean;
  /**
   * The folder linked from the app and written into the sheets' "Expediente"
   * column. Exactly one enabled destination is primary.
   */
  primary: boolean;
}

export interface SheetDestination {
  id: string;
  label: string;
  spreadsheetId: string;
  /**
   * Tab id (the #gid= of the URL). Preferred over the title: it survives the
   * tab being renamed. Null when only the title is known.
   */
  sheetGid: number | null;
  /** Tab title, used when there is no gid or it can no longer be found. */
  sheetTitle: string;
  /**
   * 'encabezados' writes each value under the column whose header matches it,
   * so inserting or moving columns never shifts the data. 'posicion' is the
   * original fixed 61-column layout, kept for sheets not yet checked.
   */
  columnMode: SheetColumnMode;
  /** 'posicion' only: write at most this many columns (the rest belong to the sheet). */
  maxColumns: number | null;
  /**
   * 'encabezados' only: field → header text, for columns whose title none of
   * the built-in aliases recognise. Set from "Probar conexión".
   */
  headerMap: Partial<Record<FieldKey, string>>;
  enabled: boolean;
}

export interface WorkspaceSettings {
  drives: DriveDestination[];
  sheets: SheetDestination[];
}

export const WORKSPACE_SETTINGS_DOC = 'settings/google_workspace';

/**
 * What the integration wrote to before it was configurable. Only used to seed
 * settings/google_workspace the first time it is read, so the first deploy
 * keeps writing exactly where it did; from then on Firestore is the source.
 * Both sheets stay in 'posicion' mode until an admin runs "Probar conexión"
 * and switches them — nobody has checked their headers against the mapping yet.
 */
export const LEGACY_WORKSPACE_SETTINGS: WorkspaceSettings = {
  drives: [
    {
      id: 'expedientes',
      label: 'Expedientes',
      folderId: '1wVBfz7_Mx10bOcmpnkVTaeQBFRNVLwkp',
      enabled: true,
      primary: true,
    },
  ],
  sheets: [
    {
      id: 'master',
      label: 'Base automatizada MASTER',
      spreadsheetId: '1LiuRz3AgJriRjCBnSCUcF7HGvzWIyx3v9FEesBLXgmA',
      sheetGid: null,
      sheetTitle: 'MASTER_ROLANDO',
      columnMode: 'posicion',
      maxColumns: null,
      headerMap: {},
      enabled: true,
    },
    {
      id: 'secundaria',
      label: 'Base secundaria',
      spreadsheetId: '1P50cy7O0Lzfm3E_FX19nV0nfB0WVkLWYQycttrWvaW8',
      sheetGid: 1726630616,
      sheetTitle: 'BD 09-03-2026',
      columnMode: 'posicion',
      // Its trailing "Enviar correo / Confirmación / Status" columns are run by
      // that sheet's own automation.
      maxColumns: 54,
      headerMap: {},
      enabled: true,
    },
  ],
};

// ─── Parsing ──────────────────────────────────────────────────────────────────

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** Folder id from a pasted Drive URL or a bare id; '' when it is neither. */
export function parseDriveFolderId(input: string): string {
  const value = (input ?? '').trim();
  const fromUrl = value.match(/\/folders\/([A-Za-z0-9_-]+)/) ?? value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  const id = fromUrl ? fromUrl[1] : value;
  return DRIVE_ID.test(id) ? id : '';
}

/** Spreadsheet id and tab gid from a pasted Sheets URL or a bare id. */
export function parseSpreadsheetInput(input: string): { spreadsheetId: string; sheetGid: number | null } {
  const value = (input ?? '').trim();
  const idMatch = value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const spreadsheetId = idMatch ? idMatch[1] : DRIVE_ID.test(value) ? value : '';
  const gidMatch = value.match(/[#&?]gid=(\d+)/);
  return { spreadsheetId, sheetGid: gidMatch ? Number(gidMatch[1]) : null };
}

// ─── Normalization ────────────────────────────────────────────────────────────

const VALID_FIELDS: FieldKey[] = FIELD_DEFS.map((d) => d.key);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/** Makes ids unique by suffixing repeats, so two destinations never share one. */
function uniqueIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let id = item.id;
    let n = 2;
    while (seen.has(id)) id = `${item.id}_${n++}`;
    seen.add(id);
    return { ...item, id };
  });
}

/**
 * Coerces a stored (or client-sent) document into a valid WorkspaceSettings.
 * Entries without a usable id are dropped instead of guessed, and exactly one
 * enabled Drive ends up primary: the one marked, else the first enabled.
 */
export function normalizeWorkspaceSettings(raw: unknown): WorkspaceSettings {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const drives = uniqueIds(
    (Array.isArray(data.drives) ? data.drives : [])
      .map((entry, index): DriveDestination | null => {
        const d = (entry ?? {}) as Record<string, unknown>;
        const folderId = parseDriveFolderId(text(d.folderId));
        if (!folderId) return null;
        const label = text(d.label) || `Drive ${index + 1}`;
        return {
          id: text(d.id) || slug(label, `drive_${index + 1}`),
          label,
          folderId,
          enabled: d.enabled !== false,
          primary: d.primary === true,
        };
      })
      .filter((d): d is DriveDestination => d !== null)
  );

  let primaryIndex = drives.findIndex((d) => d.enabled && d.primary);
  if (primaryIndex < 0) primaryIndex = drives.findIndex((d) => d.enabled);
  drives.forEach((d, index) => {
    d.primary = index === primaryIndex;
  });

  const sheets = uniqueIds(
    (Array.isArray(data.sheets) ? data.sheets : [])
      .map((entry, index): SheetDestination | null => {
        const s = (entry ?? {}) as Record<string, unknown>;
        const parsed = parseSpreadsheetInput(text(s.spreadsheetId));
        if (!parsed.spreadsheetId) return null;
        // A gid in a freshly pasted URL wins over the stored one: pasting the
        // link of another tab is how an admin points at it.
        const gid =
          parsed.sheetGid ??
          (typeof s.sheetGid === 'number' && Number.isInteger(s.sheetGid) && s.sheetGid >= 0 ? s.sheetGid : null);
        const sheetTitle = text(s.sheetTitle);
        if (gid === null && !sheetTitle) return null; // no way to find the tab
        const label = text(s.label) || `Hoja ${index + 1}`;
        const maxColumns =
          typeof s.maxColumns === 'number' && Number.isInteger(s.maxColumns) && s.maxColumns > 0
            ? s.maxColumns
            : null;
        const rawMap = (s.headerMap && typeof s.headerMap === 'object' ? s.headerMap : {}) as Record<string, unknown>;
        const headerMap: Partial<Record<FieldKey, string>> = {};
        for (const key of VALID_FIELDS) {
          const header = text(rawMap[key]);
          if (header) headerMap[key] = header;
        }
        return {
          id: text(s.id) || slug(label, `hoja_${index + 1}`),
          label,
          spreadsheetId: parsed.spreadsheetId,
          sheetGid: gid,
          sheetTitle,
          columnMode: s.columnMode === 'posicion' ? 'posicion' : 'encabezados',
          maxColumns,
          headerMap,
          enabled: s.enabled !== false,
        };
      })
      .filter((s): s is SheetDestination => s !== null)
  );

  return { drives, sheets };
}

/**
 * What normalizeWorkspaceSettings would silently drop, in words, so a save can
 * refuse it instead of losing a destination the admin just typed.
 */
export function workspaceSettingsProblems(raw: unknown): string[] {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  (Array.isArray(data.drives) ? data.drives : []).forEach((entry, index) => {
    const d = (entry ?? {}) as Record<string, unknown>;
    const name = text(d.label) || `Drive ${index + 1}`;
    if (!parseDriveFolderId(text(d.folderId))) {
      problems.push(`${name}: pega el enlace de la carpeta de Drive o su ID.`);
    }
  });
  (Array.isArray(data.sheets) ? data.sheets : []).forEach((entry, index) => {
    const s = (entry ?? {}) as Record<string, unknown>;
    const name = text(s.label) || `Hoja ${index + 1}`;
    const parsed = parseSpreadsheetInput(text(s.spreadsheetId));
    if (!parsed.spreadsheetId) {
      problems.push(`${name}: pega el enlace de la hoja de cálculo o su ID.`);
      return;
    }
    const hasGid = parsed.sheetGid !== null || (typeof s.sheetGid === 'number' && s.sheetGid >= 0);
    if (!hasGid && !text(s.sheetTitle)) {
      problems.push(`${name}: indica la pestaña (pega el enlace abierto en esa pestaña o escribe su nombre).`);
    }
  });
  return problems;
}

export function primaryDrive(settings: WorkspaceSettings): DriveDestination | null {
  return settings.drives.find((d) => d.enabled && d.primary) ?? null;
}

// ─── Firestore ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
let cache: { settings: WorkspaceSettings; fetchedAt: number } | null = null;

export function clearWorkspaceSettingsCache(): void {
  cache = null;
}

/**
 * Reads settings/google_workspace, seeding it with the legacy destinations the
 * first time. Cached for a minute: every contract signature reads it, and an
 * admin change only has to show up on the next candidate, not the same second.
 */
export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.settings;

  // Imported here so the pure helpers above can be tested without credentials.
  const { db } = await import('../utils/admin');
  const ref = db.doc(WORKSPACE_SETTINGS_DOC);
  const snap = await ref.get();

  let settings: WorkspaceSettings;
  if (snap.exists) {
    settings = normalizeWorkspaceSettings(snap.data());
  } else {
    settings = LEGACY_WORKSPACE_SETTINGS;
    await ref.set({ ...settings, seededFromLegacy: true, updatedAtIso: new Date().toISOString() });
    console.log('[workspaceSettings] Seeded settings/google_workspace with the legacy destinations');
  }

  cache = { settings, fetchedAt: Date.now() };
  return settings;
}
