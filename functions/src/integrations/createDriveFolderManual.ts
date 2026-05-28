import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createCandidateDriveFolder } from './driveService';
import { syncValidDocumentsToDriveFolder } from './driveSync';

const DRIVE_SERVICE_ACCOUNT = defineSecret('DRIVE_SERVICE_ACCOUNT');

export const createDriveFolderManual = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, secrets: [DRIVE_SERVICE_ACCOUNT] },
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

    // Sync all valid documents + signed PDFs to the new folder
    const documents = (candidate.documents ?? {}) as Record<string, { status?: string; storagePath?: string }>;
    const extraFiles: import('./driveSync').ExtraFile[] = [];
    if (candidate.offerPdfUrl) extraFiles.push({ name: 'Carta Oferta Firmada.pdf', url: candidate.offerPdfUrl as string });
    if (candidate.contractPdfUrl) extraFiles.push({ name: 'Contrato Firmado.pdf', url: candidate.contractPdfUrl as string });
    try {
      await syncValidDocumentsToDriveFolder(folderId, documents, serviceAccount, extraFiles);
    } catch (err) {
      console.error('[createDriveFolderManual] Document sync error:', err);
    }

    return {
      success: true,
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    };
  },
);
