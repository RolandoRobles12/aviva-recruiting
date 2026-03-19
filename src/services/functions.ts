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
  hubspotError?: string;
  slackError?: string;
}

export const provisionAccountsManual = httpsCallable<
  { candidateId: string; corporateEmail: string },
  ProvisionResult
>(functions, 'provisionAccountsManual');

export const sendOfferEmail = httpsCallable<
  { candidateId: string },
  { success: boolean }
>(functions, 'sendOfferEmail');
