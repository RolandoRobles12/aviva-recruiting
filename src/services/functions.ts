import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { SendInvitationPayload, SendReminderPayload, CreateCandidatePayload } from '../types';

// ─── Cloud Function Callers ────────────────────────────────────────────────────

export const sendInvitationEmail = httpsCallable<SendInvitationPayload, { success: boolean }>(
  functions,
  'sendInvitationEmail'
);

export const sendReminderEmail = httpsCallable<SendReminderPayload, { success: boolean }>(
  functions,
  'sendReminderEmail'
);

export const createCandidateAndInvite = httpsCallable<
  CreateCandidatePayload & { recruiterUid: string },
  { success: boolean; candidateId: string }
>(functions, 'createCandidateAndInvite');

export interface ProvisionResult {
  success: boolean;
  hubspotCreated: boolean;
  slackPrimaryInvited: boolean;
  slackGuestInvited: boolean;
  corporateEmail?: string;
  hubspotError?: string;
  slackError?: string;
}

export const provisionAccountsManual = httpsCallable<
  { candidateId: string; corporateEmail?: string; skipSlack?: boolean },
  ProvisionResult
>(functions, 'provisionAccountsManual');

export const sendOfferEmail = httpsCallable<
  { candidateId: string },
  { success: boolean }
>(functions, 'sendOfferEmail');

export const reissueOffer = httpsCallable<
  { candidateId: string; reason?: string },
  { success: boolean }
>(functions, 'reissueOffer');

export const sendContractEmail = httpsCallable<
  { candidateId: string },
  { success: boolean }
>(functions, 'sendContractEmail');

export const backfillCandidateDocuments = httpsCallable<
  Record<string, never>,
  { updated: number; message: string }
>(functions, 'backfillCandidateDocuments');

export const refreshCandidateViterbit = httpsCallable<
  { candidateId: string },
  { success: boolean; salary: string | null; startDate: string | null; position: string | null }
>(functions, 'refreshCandidateViterbit');

export const createDriveFolderManual = httpsCallable<
  { candidateId: string },
  {
    success: boolean;
    folderId: string;
    folderUrl: string;
    uploaded: string[];
    failed: string[];
    skipped: string[];
  }
>(functions, 'createDriveFolderManual');

export const appendSheetsRowManual = httpsCallable<
  { candidateId: string },
  { success: boolean }
>(functions, 'appendSheetsRowManual');
