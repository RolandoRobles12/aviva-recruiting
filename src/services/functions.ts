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

export const backfillPerformanceChecks = httpsCallable<
  Record<string, never>,
  { created: number; skipped: number; unparseable: string[]; message: string }
>(functions, 'backfillPerformanceChecks');

export const recalculatePerformanceStatuses = httpsCallable<
  Record<string, never>,
  {
    evaluados: number;
    promotorExitoso: number;
    bajoDesempeno: number;
    sinCambio: number;
    omitidos: number;
    sinDatos: string[];
    errores: string[];
    message: string;
  }
>(functions, 'recalculatePerformanceStatuses');

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

// ─── Psychometric administration ──────────────────────────────────────────────

export const seedPsychometricBank = httpsCallable<
  { mode?: 'append' | 'replace'; applyConfig?: boolean },
  { added: number; skipped: number; total: number; configApplied: boolean }
>(functions, 'seedPsychometricBank');

export interface PsychometricScaleAnalysis {
  scale: string;
  itemsInBank: number;
  itemsAnalyzed: number;
  n: number;
  mean: number | null;
  sd: number | null;
  alpha: number | null;
  minPairwiseN: number | null;
  notes: string[];
}

export interface PsychometricItemAnalysis {
  id: string;
  text: string;
  type: 'likert' | 'attention' | 'sjt';
  scale?: string;
  reverseScored?: boolean;
  n: number;
  mean: number | null;
  sd: number | null;
  itemTotalCorrelation: number | null;
  optionDistribution?: { text: string; score: number; share: number }[];
  passRate?: number;
  issues: string[];
}

export interface PsychometricBankWarning {
  level: 'error' | 'warning';
  scope: string;
  message: string;
}

export interface PsychometricNormSummary {
  key: string;
  n: number;
  mean: number | null;
  sd: number | null;
  status: 'sin_datos' | 'provisional' | 'estable';
}

export const analyzePsychometricBank = httpsCallable<
  Record<string, never>,
  {
    analysis: {
      sessionsAnalyzed: number;
      sessionsExcluded: number;
      scales: PsychometricScaleAnalysis[];
      items: PsychometricItemAnalysis[];
      generatedAtIso: string;
    };
    warnings: PsychometricBankWarning[];
    norms: PsychometricNormSummary[];
    thresholds: { provisional: number; stable: number };
    sessionsRead: number;
    truncated: boolean;
  }
>(functions, 'analyzePsychometricBank');

export const resetPsychometricNorms = httpsCallable<Record<string, never>, { ok: boolean }>(
  functions,
  'resetPsychometricNorms'
);
