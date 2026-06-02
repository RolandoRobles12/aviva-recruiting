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

export interface ExtraFile {
  name: string;
  /** Firebase Storage path — preferred, downloaded via Admin SDK (bypasses ACL). */
  storagePath?: string;
  /** Public URL fallback — only used when storagePath is absent. */
  url?: string;
}

/**
 * Downloads every valid document from Firebase Storage and uploads it to the
 * candidate's Drive folder. Optionally uploads additional files (e.g. signed
 * offer PDF, signed contract PDF). Errors on individual files are logged and
 * skipped so a single bad file doesn't abort the entire sync.
 */
export async function syncValidDocumentsToDriveFolder(
  folderId: string,
  documents: Record<string, { status?: string; storagePath?: string }>,
  serviceAccountJson: object,
  extraFiles?: ExtraFile[],
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

  for (const extra of extraFiles ?? []) {
    try {
      let buffer: Buffer;
      if (extra.storagePath) {
        // Admin SDK download — works regardless of bucket ACL settings
        [buffer] = await bucket.file(extra.storagePath).download();
      } else if (extra.url) {
        const res = await fetch(extra.url);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${extra.url}`);
        buffer = Buffer.from(await res.arrayBuffer());
      } else {
        console.warn(`[driveSync] ExtraFile "${extra.name}" has neither storagePath nor url — skipping`);
        continue;
      }
      await uploadFileToDriveFolder(folderId, extra.name, 'application/pdf', buffer, serviceAccountJson);
      console.log(`[driveSync] Uploaded extra file ${extra.name} → ${folderId}`);
    } catch (err) {
      console.error(`[driveSync] Failed to upload extra file ${extra.name}:`, err);
    }
  }
}
