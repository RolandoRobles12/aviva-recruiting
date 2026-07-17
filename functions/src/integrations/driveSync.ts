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

export interface DriveSyncResult {
  /** File names successfully uploaded to the Drive folder. */
  uploaded: string[];
  /** Files that failed after all retry attempts. */
  failed: { name: string; error: string }[];
  /** Extra files whose Storage object doesn't exist yet (e.g. unsigned contract). */
  skipped: string[];
}

const UPLOAD_ATTEMPTS = 3;

/**
 * Downloads every valid document from Firebase Storage and uploads it to the
 * candidate's Drive folder. Optionally uploads additional files (e.g. signed
 * offer PDF, signed contract PDF).
 *
 * Each file is retried with backoff — Drive rate limits (403) and transient
 * 5xx errors are the usual culprits behind half-empty folders. Failures are
 * collected in the returned summary instead of aborting the whole sync, so
 * callers can persist/report exactly which documents are missing.
 */
export async function syncValidDocumentsToDriveFolder(
  folderId: string,
  documents: Record<string, { status?: string; storagePath?: string }>,
  serviceAccountJson: object,
  extraFiles?: ExtraFile[],
): Promise<DriveSyncResult> {
  const bucket = getStorage().bucket();
  const result: DriveSyncResult = { uploaded: [], failed: [], skipped: [] };

  const syncOne = async (
    fileName: string,
    mimeType: string,
    download: () => Promise<Buffer>,
  ): Promise<void> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
      try {
        const buffer = await download();
        await uploadFileToDriveFolder(folderId, fileName, mimeType, buffer, serviceAccountJson);
        result.uploaded.push(fileName);
        console.log(`[driveSync] Uploaded ${fileName} → ${folderId}`);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < UPLOAD_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    result.failed.push({ name: fileName, error: String(lastErr) });
    console.error(`[driveSync] Failed to upload ${fileName} after ${UPLOAD_ATTEMPTS} attempts:`, lastErr);
  };

  for (const [docType, doc] of Object.entries(documents)) {
    if (doc.status !== 'valid' || !doc.storagePath) continue;

    const storagePath = doc.storagePath;
    const ext = storagePath.split('.').pop()?.toLowerCase() ?? 'pdf';
    const label = DOCUMENT_LABELS[docType] ?? docType;
    await syncOne(`${label}.${ext}`, mimeTypeFromPath(storagePath), async () => {
      const [buffer] = await bucket.file(storagePath).download();
      return buffer;
    });
  }

  for (const extra of extraFiles ?? []) {
    if (extra.storagePath) {
      // Extra files (signed contract/offer) legitimately may not exist yet —
      // skip quietly instead of counting them as failures.
      const [exists] = await bucket
        .file(extra.storagePath)
        .exists()
        .catch(() => [true] as [boolean]);
      if (!exists) {
        result.skipped.push(extra.name);
        console.log(`[driveSync] Extra file ${extra.name} not in Storage — skipping`);
        continue;
      }
      const storagePath = extra.storagePath;
      await syncOne(extra.name, 'application/pdf', async () => {
        // Admin SDK download — works regardless of bucket ACL settings
        const [buffer] = await bucket.file(storagePath).download();
        return buffer;
      });
    } else if (extra.url) {
      const url = extra.url;
      await syncOne(extra.name, 'application/pdf', async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
        return Buffer.from(await res.arrayBuffer());
      });
    } else {
      console.warn(`[driveSync] ExtraFile "${extra.name}" has neither storagePath nor url — skipping`);
      result.skipped.push(extra.name);
    }
  }

  console.log(
    `[driveSync] Sync summary for ${folderId}: ${result.uploaded.length} uploaded, ` +
      `${result.failed.length} failed, ${result.skipped.length} skipped`,
  );
  return result;
}
