import { google } from 'googleapis';
import { Readable } from 'stream';

/** Escape a string for use inside single quotes in a Drive query. */
function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function getDriveClient(serviceAccount: object) {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Creates (or finds) the candidate's folder inside `parentFolderId` — one of
 * the Drive destinations configured in settings/google_workspace.
 * Name format: "FIRSTNAME LASTNAME_viterbitCandidatureId"
 * Returns the folder ID. Throws on error so the caller gets the real message.
 */
export async function createCandidateDriveFolder(
  parentFolderId: string,
  firstName: string,
  lastName: string,
  viterbitCandidateId: string,
  serviceAccountJson: object,
): Promise<string> {
  const folderName = `${firstName} ${lastName}`.toUpperCase().trim() + `_${viterbitCandidateId}`;
  const drive = getDriveClient(serviceAccountJson);

  // Check if folder already exists to avoid duplicates
  const existing = await drive.files.list({
    q: `name='${escapeDriveQuery(folderName)}' and '${escapeDriveQuery(parentFolderId)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    console.log(`[driveService] Folder already exists: ${folderName} (${existing.data.files[0].id})`);
    return existing.data.files[0].id!;
  }

  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  console.log(`[driveService] Folder created: ${folderName} (${res.data.id})`);
  return res.data.id!;
}

/**
 * Uploads a file buffer into a Drive folder. If a file with the same name
 * already exists in the folder, its content is replaced instead of creating a
 * duplicate — this makes retries and manual re-syncs idempotent.
 * Returns the file ID. Throws on error.
 */
export async function uploadFileToDriveFolder(
  folderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  serviceAccountJson: object,
): Promise<string> {
  const drive = getDriveClient(serviceAccountJson);

  const existing = await drive.files.list({
    q: `name='${escapeDriveQuery(fileName)}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existingId = existing.data.files?.[0]?.id;

  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      media: {
        mimeType,
        body: Readable.from(buffer),
      },
      supportsAllDrives: true,
    });
    return existingId;
  }

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  return res.data.id!;
}
