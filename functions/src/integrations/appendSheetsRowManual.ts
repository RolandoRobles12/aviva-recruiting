import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../utils/admin';
import { DRIVE_SERVICE_ACCOUNT, VITERBIT_API_KEY } from '../utils/secrets';
import { requireCandidateAccess } from '../utils/permissions';
import { appendCandidateToSheets } from './workspaceSync';
import type { SheetAppendResult } from './sheetsService';

/**
 * "Agregar a Sheets" in the candidate panel. Appends to every spreadsheet
 * configured in Configuración → Drive y Sheets; a sheet that already has the
 * candidate's reference is skipped instead of getting a duplicate row.
 */
export const appendSheetsRowManual = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 120 },
  async (request) => {
    await requireCandidateAccess(request.auth?.uid);

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) {
      throw new HttpsError('invalid-argument', 'Se requiere candidateId.');
    }

    const docRef = db.collection('candidates').doc(candidateId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new HttpsError('not-found', 'Candidato no encontrado.');
    }

    const serviceAccount = JSON.parse(DRIVE_SERVICE_ACCOUNT.value());
    let results: SheetAppendResult[];
    try {
      results = await appendCandidateToSheets(
        docRef,
        doc.data() as Record<string, unknown>,
        serviceAccount,
        VITERBIT_API_KEY.value(),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpsError('internal', msg);
    }

    return { success: true, results };
  },
);
