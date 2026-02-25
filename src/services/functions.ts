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

export const triggerOcrValidation = httpsCallable<
  { candidateId: string; documentType: string; storagePath: string },
  { success: boolean; result: unknown }
>(functions, 'triggerOcrValidation');

export const syncToGoogleDrive = httpsCallable<
  { candidateId: string },
  { success: boolean; folderId: string; folderUrl: string }
>(functions, 'syncToGoogleDrive');

export const syncToGoogleSheets = httpsCallable<
  { candidateId: string },
  { success: boolean; rowIndex: number }
>(functions, 'syncToGoogleSheets');

export const createCandidateAndInvite = httpsCallable<
  CreateCandidatePayload & { recruiterUid: string },
  { success: boolean; candidateId: string }
>(functions, 'createCandidateAndInvite');
