import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import { FieldValue } from 'firebase-admin/firestore';
import { db, storage } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { defineString } from 'firebase-functions/params';

const DRIVE_CLIENT_ID = defineString('DRIVE_CLIENT_ID');
const DRIVE_CLIENT_SECRET = defineString('DRIVE_CLIENT_SECRET');
const DRIVE_REFRESH_TOKEN = defineString('DRIVE_REFRESH_TOKEN');
const DRIVE_PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

const DOCUMENT_LABELS: Record<string, string> = {
  ine: 'INE',
  curp: 'CURP',
  rfc: 'RFC',
  comprobante_domicilio: 'Comprobante_Domicilio',
  comprobante_estudios: 'Comprobante_Estudios',
};

async function getDriveClient() {
  const oAuth2 = new google.auth.OAuth2(
    DRIVE_CLIENT_ID.value(),
    DRIVE_CLIENT_SECRET.value(),
    'https://developers.google.com/oauthplayground'
  );
  oAuth2.setCredentials({ refresh_token: DRIVE_REFRESH_TOKEN.value() });
  return google.drive({ version: 'v3', auth: oAuth2 });
}

export const syncToGoogleDrive = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const drive = await getDriveClient();

    // 1. Create or reuse candidate folder
    let folderId: string;
    let folderUrl: string;

    const existingFolder = candidate.driveFolder as { folderId?: string } | undefined;
    if (existingFolder?.folderId) {
      folderId = existingFolder.folderId;
      folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    } else {
      const folderName = `${candidate.lastName}_${candidate.firstName}_${candidateId.substring(0, 6)}`;
      const folderRes = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [DRIVE_PARENT_FOLDER_ID.value()],
        },
        fields: 'id, webViewLink',
      });
      folderId = folderRes.data.id!;
      folderUrl = folderRes.data.webViewLink!;
    }

    // 2. Upload each document to the folder
    const docs = candidate.documents as Record<string, {
      status: string;
      storagePath?: string;
      fileName?: string;
    }>;

    for (const [type, doc] of Object.entries(docs)) {
      if (!doc.storagePath || doc.status === 'pending') continue;

      try {
        const bucket = storage.bucket();
        const file = bucket.file(doc.storagePath);
        const [fileBuffer] = await file.download();
        const [metadata] = await file.getMetadata();

        const driveFileName = `${DOCUMENT_LABELS[type] ?? type}_${doc.fileName ?? 'documento'}`;

        // Check if file already exists in folder
        const existing = await drive.files.list({
          q: `name='${driveFileName}' and '${folderId}' in parents and trashed=false`,
          fields: 'files(id)',
        });

        if (existing.data.files && existing.data.files.length > 0) {
          // Update existing
          await drive.files.update({
            fileId: existing.data.files[0].id!,
            media: {
              mimeType: metadata.contentType ?? 'application/octet-stream',
              body: require('stream').Readable.from(fileBuffer),
            },
          });
        } else {
          // Upload new
          await drive.files.create({
            requestBody: {
              name: driveFileName,
              parents: [folderId],
            },
            media: {
              mimeType: metadata.contentType ?? 'application/octet-stream',
              body: require('stream').Readable.from(fileBuffer),
            },
            fields: 'id',
          });
        }
      } catch (err) {
        console.error(`Error uploading ${type} to Drive:`, err);
      }
    }

    // 3. Update Firestore with Drive folder reference
    await db.collection('candidates').doc(candidateId).update({
      driveFolder: {
        folderId,
        folderUrl,
        createdAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, folderId, folderUrl };
  }
);
