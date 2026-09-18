import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { SendInvitationPayload, SendReminderPayload, CreateCandidatePayload, DocumentType } from '../types';

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
  /** How the HubSpot role landed; 'not_configured' means the account got HubSpot's minimum access. */
  hubspotRoleStatus?: HubspotRoleStatus | null;
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

/** Admin-only: deletes an uploaded document (and its file) so the candidate can re-upload it. */
export const deleteCandidateDocument = httpsCallable<
  { candidateId: string; documentType: DocumentType },
  { success: boolean }
>(functions, 'deleteCandidateDocument');

export const sendContractEmail = httpsCallable<
  { candidateId: string },
  { success: boolean }
>(functions, 'sendContractEmail');

export const reissueContract = httpsCallable<
  { candidateId: string; reason?: string },
  { success: boolean }
>(functions, 'reissueContract');

// The maintenance callables walk every candidate — well past the SDK's 70s
// default, which would surface as a client-side "deadline-exceeded" while the
// function kept running server-side and the operator re-clicked the button.
// Set above each function's own timeoutSeconds so the server's error is what
// surfaces, instead of the client giving up on a run that is still going.
const MAINTENANCE_TIMEOUT = { timeout: 530_000 };

export const backfillCandidateDocuments = httpsCallable<
  Record<string, never>,
  { updated: number; message: string }
>(functions, 'backfillCandidateDocuments', MAINTENANCE_TIMEOUT);

/**
 * Runs the full performance cycle on demand — schedules missing checks and
 * evaluates everything already due, instead of waiting for the 09:00 job.
 */
export const runPerformanceChecksNow = httpsCallable<
  Record<string, never>,
  {
    scheduled: number;
    isoFilled: number;
    ownersRecovered: number;
    evaluated: number;
    skipped: Record<string, number>;
    failed: number;
    remaining: number;
    sinFechaDeIngreso: string[];
    message: string;
  }
>(functions, 'runPerformanceChecksNow', MAINTENANCE_TIMEOUT);

export interface PerformanceRecalcChange {
  candidateId: string;
  nombre: string;
  perfil: string;
  statusAnterior: string;
  statusNuevo: 'promotor_exitoso' | 'bajo_desempeno';
  dealsAntes: number | null;
  dealsDespues: number;
  meta: number;
}

export const recalculatePerformanceStatuses = httpsCallable<
  { dryRun?: boolean },
  {
    dryRun: boolean;
    evaluados: number;
    promotorExitoso: number;
    bajoDesempeno: number;
    sinCambio: number;
    conteoAjustado: number;
    omitidos: number;
    sinDatos: string[];
    errores: string[];
    cambios: PerformanceRecalcChange[];
    message: string;
  }
>(functions, 'recalculatePerformanceStatuses', MAINTENANCE_TIMEOUT);

export const backfillCandidatePlaza = httpsCallable<
  { force?: boolean },
  {
    updated: number;
    skipped: number;
    withoutJob: number;
    jobsFetched: number;
    failedJobs: string[];
    message: string;
  }
>(functions, 'backfillCandidatePlaza', MAINTENANCE_TIMEOUT);

export const refreshCandidateViterbit = httpsCallable<
  { candidateId: string },
  {
    success: boolean;
    /** Fields this sync wrote; empty means Viterbit had nothing new. */
    changed: string[];
    salary: string | null;
    startDate: string | null;
    position: string | null;
    buro: string | null;
    psicometriaIntegridad: string | null;
    /** True when this refresh completed the last missing hiring detail and the offer letter was sent automatically. */
    offerAutoSent: boolean;
    offerAutoSendError: string | null;
  }
>(functions, 'refreshCandidateViterbit');

/** Re-reads Viterbit for every candidate still in flight, in one pass. */
export const syncViterbitCandidatesNow = httpsCallable<
  Record<string, never>,
  {
    checked: number;
    updated: number;
    offersSent: number;
    errors: number;
    pending: number;
    message: string;
  }
>(functions, 'syncViterbitCandidatesNow', MAINTENANCE_TIMEOUT);

export interface HubspotRole {
  id: string;
  name: string;
}

/** Roles defined in the HubSpot portal, plus the one configured for new users. */
export const listHubspotRoles = httpsCallable<
  Record<string, never>,
  { roles: HubspotRole[]; roleId: string; primaryTeamId: string }
>(functions, 'listHubspotRoles');

export type HubspotRoleStatus =
  | 'assigned'
  | 'would_assign'
  | 'already_set'
  | 'not_configured'
  | 'user_not_found'
  | 'skipped_super_admin'
  | 'error';

export interface HubspotRoleSyncEntry {
  candidateId: string;
  name: string;
  email: string;
  status: HubspotRoleStatus;
  error?: string;
}

/** Applies the configured role to provisioned HubSpot accounts that have none. */
export const syncHubspotUserRoles = httpsCallable<
  { dryRun?: boolean },
  {
    dryRun: boolean;
    roleId: string;
    checked: number;
    assigned: number;
    alreadySet: number;
    notFound: number;
    errors: number;
    details: HubspotRoleSyncEntry[];
    message: string;
  }
>(functions, 'syncHubspotUserRoles', MAINTENANCE_TIMEOUT);

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
