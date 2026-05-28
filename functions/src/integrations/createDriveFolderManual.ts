import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createCandidateDriveFolder } from './driveService';

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
    const viterbitCandidatureId = candidate.viterbitCandidatureId as string | undefined;

    if (!viterbitCandidatureId) {
      throw new HttpsError('failed-precondition', 'El candidato no tiene viterbitCandidatureId.');
    }

    const serviceAccount = JSON.parse(DRIVE_SERVICE_ACCOUNT.value());
    const folderId = await createCandidateDriveFolder(firstName, lastName, viterbitCandidatureId, serviceAccount);

    if (!folderId) {
      throw new HttpsError('internal', 'No se pudo crear la carpeta en Drive.');
    }

    await docRef.update({
      driveFolderId: folderId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    };
  },
);
