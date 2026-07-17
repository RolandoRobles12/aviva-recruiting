import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createCandidateDriveFolder } from './driveService';
import { syncValidDocumentsToDriveFolder } from './driveSync';

const DRIVE_SERVICE_ACCOUNT = defineSecret('DRIVE_SERVICE_ACCOUNT');

export const createDriveFolderManual = onCall(
  // 300s: syncing a full expediente (download from Storage + upload to Drive,
  // one file at a time, with retries) can far exceed the old 30s timeout —
  // which killed the sync halfway and left folders with only some documents.
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300, secrets: [DRIVE_SERVICE_ACCOUNT] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) {
      throw new HttpsError('invalid-argument', 'Se requiere candidateId.');
    }

    const docRef = db.collection('candidates').doc(candidateId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new HttpsError('not-found', 'Candidato no encontrado.');
    }

    const candidate = doc.data()!;
    const firstName = candidate.firstName as string;
    const lastName = candidate.lastName as string;
    const viterbitCandidateId = (candidate.viterbitCandidateId ?? candidate.viterbitCandidatureId) as string | undefined;

    if (!viterbitCandidateId) {
      throw new HttpsError('failed-precondition', 'El candidato no tiene viterbitCandidateId.');
    }

    const serviceAccount = JSON.parse(DRIVE_SERVICE_ACCOUNT.value());
    let folderId: string;
    try {
      folderId = await createCandidateDriveFolder(firstName, lastName, viterbitCandidateId, serviceAccount);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[createDriveFolderManual] Drive error:', msg);
      throw new HttpsError('internal', `Drive: ${msg}`);
    }

    await docRef.update({
      driveFolderId: folderId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Sync all valid documents + signed PDFs to the new folder.
    // Use Admin SDK storage paths — works regardless of bucket ACL / UBA settings.
    const documents = (candidate.documents ?? {}) as Record<string, { status?: string; storagePath?: string }>;
    const extraFiles: import('./driveSync').ExtraFile[] = [
      { name: 'Contrato Firmado.pdf',     storagePath: `candidates/${candidateId}/contrato_firmado.pdf` },
      { name: 'Carta Oferta Firmada.pdf', storagePath: `candidates/${candidateId}/carta_oferta_firmada.pdf` },
    ];
    let uploaded: string[] = [];
    let failed: string[] = [];
    let skipped: string[] = [];
    try {
      const syncResult = await syncValidDocumentsToDriveFolder(folderId, documents, serviceAccount, extraFiles);
      uploaded = syncResult.uploaded;
      failed = syncResult.failed.map((f) => f.name);
      skipped = syncResult.skipped;
      await docRef.update({
        driveSyncStatus: {
          syncedAt: FieldValue.serverTimestamp(),
          uploaded,
          failed,
          skipped,
        },
      });
    } catch (err) {
      console.error('[createDriveFolderManual] Document sync error:', err);
    }

    return {
      success: true,
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      uploaded,
      failed,
      skipped,
    };
  },
);
