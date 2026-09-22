import { describe, expect, it } from 'vitest';
import {
  LEGACY_WORKSPACE_SETTINGS,
  normalizeWorkspaceSettings,
  parseDriveFolderId,
  parseSpreadsheetInput,
  primaryDrive,
} from '../functions/src/integrations/workspaceSettings';

const FOLDER = '1wVBfz7_Mx10bOcmpnkVTaeQBFRNVLwkp';
const SHEET = '1P50cy7O0Lzfm3E_FX19nV0nfB0WVkLWYQycttrWvaW8';

describe('URL parsing', () => {
  it('takes a folder id from a URL or as is', () => {
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`)).toBe(FOLDER);
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/1/folders/${FOLDER}`)).toBe(FOLDER);
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${FOLDER}`)).toBe(FOLDER);
    expect(parseDriveFolderId(`  ${FOLDER} `)).toBe(FOLDER);
    expect(parseDriveFolderId('no es un id')).toBe('');
  });

  it('takes the spreadsheet id and the tab gid from a URL', () => {
    expect(parseSpreadsheetInput(`https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=1726630616`)).toEqual({
      spreadsheetId: SHEET,
      sheetGid: 1726630616,
    });
    expect(parseSpreadsheetInput(`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=0#gid=0`)).toEqual({
      spreadsheetId: SHEET,
      sheetGid: 0,
    });
    expect(parseSpreadsheetInput(SHEET)).toEqual({ spreadsheetId: SHEET, sheetGid: null });
    expect(parseSpreadsheetInput('https://example.com')).toEqual({ spreadsheetId: '', sheetGid: null });
  });
});

describe('normalizeWorkspaceSettings', () => {
  it('keeps the legacy settings exactly as they are', () => {
    expect(normalizeWorkspaceSettings(LEGACY_WORKSPACE_SETTINGS)).toEqual(LEGACY_WORKSPACE_SETTINGS);
  });

  it('supports several Drives and several spreadsheets', () => {
    const settings = normalizeWorkspaceSettings({
      drives: [
        { label: 'Expedientes', folderId: FOLDER },
        { label: 'Nómina', folderId: `https://drive.google.com/drive/folders/${FOLDER}X`, primary: true },
      ],
      sheets: [
        { label: 'MASTER', spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=5` },
        { label: 'Nómina', spreadsheetId: SHEET, sheetTitle: 'Altas', columnMode: 'posicion', maxColumns: 54 },
      ],
    });
    expect(settings.drives.map((d) => [d.id, d.folderId, d.primary])).toEqual([
      ['expedientes', FOLDER, false],
      ['nomina', `${FOLDER}X`, true],
    ]);
    expect(settings.sheets.map((s) => [s.id, s.sheetGid, s.sheetTitle, s.columnMode, s.maxColumns])).toEqual([
      ['master', 5, '', 'encabezados', null],
      ['nomina', null, 'Altas', 'posicion', 54],
    ]);
  });

  it('always leaves exactly one enabled primary Drive', () => {
    const none = normalizeWorkspaceSettings({
      drives: [
        { id: 'a', folderId: FOLDER, enabled: false },
        { id: 'b', folderId: FOLDER },
        { id: 'c', folderId: FOLDER },
      ],
    });
    expect(primaryDrive(none)?.id).toBe('b');
    expect(none.drives.filter((d) => d.primary)).toHaveLength(1);

    const disabledPrimary = normalizeWorkspaceSettings({
      drives: [
        { id: 'a', folderId: FOLDER, primary: true, enabled: false },
        { id: 'b', folderId: FOLDER },
      ],
    });
    expect(primaryDrive(disabledPrimary)?.id).toBe('b');
  });

  it('drops destinations it cannot use instead of guessing', () => {
    const settings = normalizeWorkspaceSettings({
      drives: [{ folderId: '' }, { folderId: 'x' }],
      sheets: [{ spreadsheetId: SHEET }, { spreadsheetId: 'nope', sheetTitle: 'A' }],
    });
    expect(settings.drives).toEqual([]);
    // No gid and no title: there is no way to find the tab.
    expect(settings.sheets).toEqual([]);
  });

  it('gives repeated ids a suffix', () => {
    const settings = normalizeWorkspaceSettings({
      sheets: [
        { label: 'Base', spreadsheetId: SHEET, sheetTitle: 'A' },
        { label: 'Base', spreadsheetId: SHEET, sheetTitle: 'B' },
      ],
    });
    expect(settings.sheets.map((s) => s.id)).toEqual(['base', 'base_2']);
  });

  it('keeps only known fields in the manual column mapping', () => {
    const settings = normalizeWorkspaceSettings({
      sheets: [
        {
          spreadsheetId: SHEET,
          sheetTitle: 'A',
          headerMap: { email_personal: ' Mail ', contrasena: 'Contraseña', nombre: '' },
        },
      ],
    });
    expect(settings.sheets[0].headerMap).toEqual({ email_personal: 'Mail' });
  });
});

describe('workspaceSettingsProblems', () => {
  it('names every entry that would be dropped, and nothing else', async () => {
    const { workspaceSettingsProblems } = await import('../functions/src/integrations/workspaceSettings');
    expect(
      workspaceSettingsProblems({
        drives: [{ label: 'Bueno', folderId: FOLDER }, { label: 'Malo', folderId: 'x' }],
        sheets: [
          { label: 'Sin pestaña', spreadsheetId: SHEET },
          { label: 'Con gid', spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=3` },
          { label: 'Con nombre', spreadsheetId: SHEET, sheetTitle: 'Altas' },
          { label: 'Sin hoja', spreadsheetId: '' },
        ],
      })
    ).toEqual([
      'Malo: pega el enlace de la carpeta de Drive o su ID.',
      'Sin pestaña: indica la pestaña (pega el enlace abierto en esa pestaña o escribe su nombre).',
      'Sin hoja: pega el enlace de la hoja de cálculo o su ID.',
    ]);
  });

  it('lets a pasted URL change the tab of an existing destination', () => {
    const settings = normalizeWorkspaceSettings({
      sheets: [{ spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=9`, sheetGid: 1 }],
    });
    expect(settings.sheets[0].sheetGid).toBe(9);
  });
});
