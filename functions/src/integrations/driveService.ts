import { google } from 'googleapis';

const EXPEDIENTES_FOLDER_ID = '1wVBfz7_Mx10bOcmpnkVTaeQBFRNVLwkp';

function getDriveClient(serviceAccount: object) {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Creates a candidate folder in Drive under the Expedientes folder.
 * Name format: "FIRSTNAME LASTNAME_viterbitCandidatureId"
 * Returns the created folder ID. Throws on error so the caller gets the real message.
 */
export async function createCandidateDriveFolder(
  firstName: string,
  lastName: string,
  viterbitCandidatureId: string,
  serviceAccountJson: object,
): Promise<string> {
  const folderName = `${firstName} ${lastName}`.toUpperCase().trim() + `_${viterbitCandidatureId}`;
  const drive = getDriveClient(serviceAccountJson);

  // Check if folder already exists to avoid duplicates
  const existing = await drive.files.list({
    q: `name='${folderName}' and '${EXPEDIENTES_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });

  if (existing.data.files && existing.data.files.length > 0) {
    console.log(`[driveService] Folder already exists: ${folderName} (${existing.data.files[0].id})`);
    return existing.data.files[0].id!;
  }

  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [EXPEDIENTES_FOLDER_ID],
    },
    fields: 'id',
  });

  console.log(`[driveService] Folder created: ${folderName} (${res.data.id})`);
  return res.data.id!;
}
