import { getStorage } from 'firebase-admin/storage';
import { DOCUMENT_LABELS } from '../utils/documentTypes';
import { uploadFileToDriveFolder } from './driveService';

function mimeTypeFromPath(storagePath: string): string {
  const ext = storagePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Downloads every valid document from Firebase Storage and uploads it to the
 * candidate's Drive folder. Errors on individual files are logged and skipped
 * so a single bad file doesn't abort the entire sync.
 */
export async function syncValidDocumentsToDriveFolder(
  folderId: string,
  documents: Record<string, { status?: string; storagePath?: string }>,
  serviceAccountJson: object,
): Promise<void> {
  const bucket = getStorage().bucket();

  for (const [docType, doc] of Object.entries(documents)) {
    if (doc.status !== 'valid' || !doc.storagePath) continue;

    try {
      const [buffer] = await bucket.file(doc.storagePath).download();
      const mimeType = mimeTypeFromPath(doc.storagePath);
      const ext = doc.storagePath.split('.').pop()?.toLowerCase() ?? 'pdf';
      const label = DOCUMENT_LABELS[docType] ?? docType;
      const fileName = `${label}.${ext}`;

      await uploadFileToDriveFolder(folderId, fileName, mimeType, buffer, serviceAccountJson);
      console.log(`[driveSync] Uploaded ${fileName} → ${folderId}`);
    } catch (err) {
      console.error(`[driveSync] Failed to upload ${docType}:`, err);
    }
  }
}
