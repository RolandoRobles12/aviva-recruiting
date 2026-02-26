import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { defineString } from 'firebase-functions/params';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const SHEETS_CLIENT_ID = defineString('SHEETS_CLIENT_ID');
const SHEETS_CLIENT_SECRET = defineString('SHEETS_CLIENT_SECRET');
const SHEETS_REFRESH_TOKEN = defineString('SHEETS_REFRESH_TOKEN');
const SHEETS_SPREADSHEET_ID = defineString('SHEETS_SPREADSHEET_ID');
const SHEETS_SHEET_NAME = defineString('SHEETS_SHEET_NAME');

const HEADERS = [
  'ID',
  'Nombre',
  'Apellidos',
  'Correo',
  'Teléfono',
  'Puesto',
  'Estado',
  '% Completado',
  'INE',
  'CURP',
  'RFC',
  'Comp. Domicilio',
  'Comp. Estudios',
  'Carpeta Drive',
  'Fecha Creación',
  'Última Actualización',
  'Recordatorios',
];

async function getSheetsClient() {
  const oAuth2 = new google.auth.OAuth2(
    SHEETS_CLIENT_ID.value(),
    SHEETS_CLIENT_SECRET.value(),
    'https://developers.google.com/oauthplayground'
  );
  oAuth2.setCredentials({ refresh_token: SHEETS_REFRESH_TOKEN.value() });
  return google.sheets({ version: 'v4', auth: oAuth2 });
}

const STATUS_LABELS: Record<string, string> = {
  invited: 'Invitado',
  in_progress: 'En progreso',
  under_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado',
};

const DOC_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  uploaded: 'Subido',
  valid: 'Válido',
  invalid: 'Inválido',
  review: 'En revisión',
};

export const syncToGoogleSheets = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const sheets = await getSheetsClient();
    const sheetName = SHEETS_SHEET_NAME.value();
    const spreadsheetId = SHEETS_SPREADSHEET_ID.value();

    // Ensure headers exist
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Q1`,
    });

    if (!headerRes.data.values || headerRes.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }

    const docs = candidate.documents as Record<string, { status: string }>;
    const driveFolder = candidate.driveFolder as { folderUrl?: string } | undefined;

    const createdAt = (candidate.createdAt as FirebaseFirestore.Timestamp)?.toDate?.();
    const updatedAt = (candidate.updatedAt as FirebaseFirestore.Timestamp)?.toDate?.();

    const rowData = [
      candidateId,
      candidate.firstName as string,
      candidate.lastName as string,
      candidate.email as string,
      (candidate.phone as string) ?? '',
      candidate.position as string,
      STATUS_LABELS[candidate.status as string] ?? candidate.status as string,
      `${candidate.completionPercentage}%`,
      DOC_STATUS_LABELS[docs.ine?.status] ?? 'Pendiente',
      DOC_STATUS_LABELS[docs.curp?.status] ?? 'Pendiente',
      DOC_STATUS_LABELS[docs.rfc?.status] ?? 'Pendiente',
      DOC_STATUS_LABELS[docs.comprobante_domicilio?.status] ?? 'Pendiente',
      DOC_STATUS_LABELS[docs.comprobante_estudios?.status] ?? 'Pendiente',
      driveFolder?.folderUrl ?? '',
      createdAt ? format(createdAt, "dd/MM/yyyy HH:mm", { locale: es }) : '',
      updatedAt ? format(updatedAt, "dd/MM/yyyy HH:mm", { locale: es }) : '',
      String(candidate.reminderCount ?? 0),
    ];

    // Check if candidate already has a row
    const existingRowIndex = candidate.sheetsRowIndex as number | undefined;

    let rowIndex: number;
    if (existingRowIndex != null && existingRowIndex > 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A${existingRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rowData] },
      });
      rowIndex = existingRowIndex;
    } else {
      // Append new row
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowData] },
      });

      // Parse row index from updatedRange
      const updatedRange = appendRes.data.updates?.updatedRange ?? '';
      const match = updatedRange.match(/!A(\d+)/);
      rowIndex = match ? parseInt(match[1]) : 0;

      // Save row index to Firestore
      await db.collection('candidates').doc(candidateId).update({
        sheetsRowIndex: rowIndex,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true, rowIndex };
  }
);
