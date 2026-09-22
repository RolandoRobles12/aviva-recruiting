// Sending a candidate to Google Workspace: one folder per configured Drive
// destination (with the expediente synced into it) and one row per configured
// spreadsheet. Shared by the contract signature and by the manual buttons in the
// candidate panel, which used to repeat this flow each on their own.

import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { createCandidateDriveFolder } from './driveService';
import { syncValidDocumentsToDriveFolder, type ExtraFile } from './driveSync';
import { appendCandidateRow, type SheetAppendResult } from './sheetsService';
import { getWorkspaceSettings, primaryDrive } from './workspaceSettings';
import { fetchJobSheetInfo } from '../viterbit/jobSheetInfo';
import { getRecruiterName } from '../utils/recruiters';

export interface DriveDestinationResult {
  id: string;
  label: string;
  primary: boolean;
  folderId?: string;
  uploaded: string[];
  failed: string[];
  skipped: string[];
  error?: string;
}

export interface DriveSyncOutcome {
  /** Folder in the primary destination; '' when it could not be created. */
  primaryFolderId: string;
  results: DriveDestinationResult[];
}

/** Signed PDFs that live in Storage next to the uploaded documents. */
export function signedPdfFiles(candidateId: string, contractPath?: string): ExtraFile[] {
  return [
    { name: 'Contrato Firmado.pdf', storagePath: contractPath ?? `candidates/${candidateId}/contrato_firmado.pdf` },
    { name: 'Carta Oferta Firmada.pdf', storagePath: `candidates/${candidateId}/carta_oferta_firmada.pdf` },
  ];
}

/**
 * Creates (or finds) the candidate's folder in every enabled Drive destination
 * and syncs the expediente into each. Destinations are independent: one
 * failing never stops the others.
 *
 * Persists `driveFolders` (destination → folder), `driveFolderId` (the primary
 * one, which the app links to and the sheets write as "Expediente") and the
 * per-destination sync status.
 */
export async function syncCandidateDrives(
  candidateRef: DocumentReference,
  candidate: Record<string, unknown>,
  serviceAccount: object,
  extraFiles: ExtraFile[]
): Promise<DriveSyncOutcome> {
  const settings = await getWorkspaceSettings();
  const viterbitCandidateId = (candidate.viterbitCandidateId ?? candidate.viterbitCandidatureId) as
    | string
    | undefined;
  if (!viterbitCandidateId) throw new Error('El candidato no tiene viterbitCandidateId.');

  const documents = (candidate.documents ?? {}) as Record<string, { status?: string; storagePath?: string }>;
  const primary = primaryDrive(settings);
  const results: DriveDestinationResult[] = [];
  const folders: Record<string, string> = {
    ...((candidate.driveFolders as Record<string, string> | undefined) ?? {}),
  };

  for (const dest of settings.drives.filter((d) => d.enabled)) {
    const result: DriveDestinationResult = {
      id: dest.id,
      label: dest.label,
      primary: dest.id === primary?.id,
      uploaded: [],
      failed: [],
      skipped: [],
    };
    try {
      const folderId = await createCandidateDriveFolder(
        dest.folderId,
        candidate.firstName as string,
        candidate.lastName as string,
        viterbitCandidateId,
        serviceAccount
      );
      result.folderId = folderId;
      folders[dest.id] = folderId;
      const sync = await syncValidDocumentsToDriveFolder(folderId, documents, serviceAccount, extraFiles);
      result.uploaded = sync.uploaded;
      result.failed = sync.failed.map((f) => f.name);
      result.skipped = sync.skipped;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.error(`[workspaceSync] Drive "${dest.label}" failed:`, err);
    }
    results.push(result);
  }

  const primaryResult = results.find((r) => r.primary);
  const primaryFolderId = primaryResult?.folderId ?? '';

  await candidateRef.update({
    driveFolders: folders,
    ...(primaryFolderId ? { driveFolderId: primaryFolderId } : {}),
    // Kept in its original shape (primary destination) for existing readers.
    ...(primaryResult && !primaryResult.error
      ? {
          driveSyncStatus: {
            syncedAt: FieldValue.serverTimestamp(),
            uploaded: primaryResult.uploaded,
            failed: primaryResult.failed,
            skipped: primaryResult.skipped,
          },
        }
      : {}),
    driveSyncByDestination: Object.fromEntries(
      results.map((r) => [
        r.id,
        {
          label: r.label,
          folderId: r.folderId ?? null,
          uploaded: r.uploaded,
          failed: r.failed,
          skipped: r.skipped,
          error: r.error ?? null,
        },
      ])
    ),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { primaryFolderId, results };
}

/**
 * Appends the candidate's onboarding row to every enabled spreadsheet and
 * records the outcome on the candidate. Throws (after recording) when any
 * destination failed.
 */
export async function appendCandidateToSheets(
  candidateRef: DocumentReference,
  candidate: Record<string, unknown>,
  serviceAccount: object,
  viterbitApiKey: string
): Promise<SheetAppendResult[]> {
  const settings = await getWorkspaceSettings();
  const { externalId, recruiterName: viterbitRecruiter } = await fetchJobSheetInfo(
    candidate.viterbitJobId as string | undefined,
    viterbitApiKey
  );
  const recruiterName =
    viterbitRecruiter || (await getRecruiterName(candidate.createdBy as string).catch(() => ''));

  const primary = primaryDrive(settings);
  const folders = (candidate.driveFolders as Record<string, string> | undefined) ?? {};
  const folderId = (primary && folders[primary.id]) || (candidate.driveFolderId as string) || '';

  const record = (results: SheetAppendResult[]) =>
    candidateRef.update({
      sheetsSyncStatus: {
        syncedAt: FieldValue.serverTimestamp(),
        results: results.map((r) => ({ ...r, message: r.message ?? null })),
      },
    });

  try {
    const results = await appendCandidateRow(
      { ...candidate, id: candidateRef.id },
      { folderId, recruiterName, jobExternalId: externalId },
      settings.sheets,
      serviceAccount
    );
    await record(results);
    return results;
  } catch (err) {
    const results = (err as { results?: SheetAppendResult[] }).results;
    if (results) await record(results).catch(() => undefined);
    throw err;
  }
}
