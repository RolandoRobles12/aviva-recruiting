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

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface ExtraFile {
  name: string;
  url: string;
}

/**
 * Downloads every valid document from Firebase Storage and uploads it to the
 * candidate's Drive folder. Optionally uploads additional files from public URLs
 * (e.g. signed offer PDF, signed contract PDF). Errors on individual files are
 * logged and skipped so a single bad file doesn't abort the entire sync.
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
      const buffer = await fetchBuffer(extra.url);
      await uploadFileToDriveFolder(folderId, extra.name, 'application/pdf', buffer, serviceAccountJson);
      console.log(`[driveSync] Uploaded extra file ${extra.name} → ${folderId}`);
    } catch (err) {
      console.error(`[driveSync] Failed to upload extra file ${extra.name}:`, err);
    }
  }
}
