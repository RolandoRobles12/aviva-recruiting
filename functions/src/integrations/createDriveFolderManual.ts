import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../utils/admin';
import { DRIVE_SERVICE_ACCOUNT } from '../utils/secrets';
import { requireCandidateAccess } from '../utils/permissions';
import { signedPdfFiles, syncCandidateDrives } from './workspaceSync';

/**
 * "Crear carpeta en Drive" / "Resincronizar documentos" in the candidate panel:
 * the same Drive step the contract signature runs, against every Drive
 * destination configured in Configuración → Drive y Sheets.
 */
export const createDriveFolderManual = onCall(
  // 300s: syncing a full expediente (download from Storage + upload to Drive,
  // one file at a time, with retries) can far exceed the old 30s timeout —
  // which killed the sync halfway and left folders with only some documents.
  // Several destinations multiply that, hence 540s.
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
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

    const candidate = doc.data() as Record<string, unknown>;
    if (!(candidate.viterbitCandidateId ?? candidate.viterbitCandidatureId)) {
      throw new HttpsError('failed-precondition', 'El candidato no tiene viterbitCandidateId.');
    }

    const serviceAccount = JSON.parse(DRIVE_SERVICE_ACCOUNT.value());
    let outcome;
    try {
      outcome = await syncCandidateDrives(docRef, candidate, serviceAccount, signedPdfFiles(candidateId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[createDriveFolderManual] Drive error:', msg);
      throw new HttpsError('internal', `Drive: ${msg}`);
    }

    const primary = outcome.results.find((r) => r.primary);
    if (!outcome.primaryFolderId) {
      const reason = primary?.error ?? 'No hay un Drive principal activo en Configuración → Drive y Sheets.';
      throw new HttpsError('internal', `Drive: ${reason}`);
    }

    // Problems in the other destinations are reported, not thrown: the primary
    // folder exists and the panel can link to it.
    const otherErrors = outcome.results
      .filter((r) => !r.primary && r.error)
      .map((r) => `${r.label}: ${r.error}`);

    return {
      success: true,
      folderId: outcome.primaryFolderId,
      folderUrl: `https://drive.google.com/drive/folders/${outcome.primaryFolderId}`,
      uploaded: primary?.uploaded ?? [],
      failed: [
        ...(primary?.failed ?? []),
        ...outcome.results.filter((r) => !r.primary).flatMap((r) => r.failed.map((name) => `${r.label}: ${name}`)),
      ],
      skipped: primary?.skipped ?? [],
      destinations: outcome.results,
      otherErrors,
    };
  },
);
