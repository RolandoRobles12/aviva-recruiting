// Admin-only callables behind the "Banco de preguntas" and "Análisis del
// instrumento" tabs. All three mirror the psychometric_manage_bank permission
// defaults, since each one can change or expose how candidates are scored.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { userHasPermission } from '../utils/permissions';
import { DEFAULT_QUESTION_BANK, DEFAULT_TEST_CONFIG } from './defaultBank';
import { getNorms, getOrSeedConfig, getQuestionBank } from './bankStore';
import { normalizeBank } from './normalize';
import { auditBank } from './sampling';
import { analyzeBank, type AnalysisSession } from './itemAnalysis';
import { distributionFrom } from './norms';
import {
  NORM_MIN_N_PROVISIONAL,
  NORM_MIN_N_STABLE,
  type PsychometricAnswer,
  type PsychometricNormKey,
  type PsychometricQuestion,
  type PsychometricValidityVerdict,
} from './types';

/** Same defaults as the client's psychometric_manage_bank permission. */
const MANAGE_BANK_DEFAULTS = {
  reclutador: false,
  lider: false,
  nomina: false,
  legal: false,
};

async function requireBankManager(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'No autenticado');
  const allowed = await userHasPermission(uid, 'psychometric_manage_bank', MANAGE_BANK_DEFAULTS);
  if (!allowed) {
    throw new HttpsError('permission-denied', 'No tienes permiso para administrar el banco de preguntas.');
  }
}

// ─── Seeding the curated bank ─────────────────────────────────────────────────

export interface SeedBankResult {
  added: number;
  skipped: number;
  total: number;
  configApplied: boolean;
}

/**
 * Writes the curated starter bank into Firestore.
 *
 * Default mode is 'append': items whose id already exists are left untouched, so
 * running it on a bank somebody has been editing adds what is missing (for
 * instance the integridad items and the attention checks) without discarding
 * their work. 'replace' is explicit and destructive.
 */
export const seedPsychometricBank = onCall({ region: 'us-central1' }, async (request) => {
  await requireBankManager(request.auth?.uid);

  const { mode = 'append', applyConfig = false } = (request.data ?? {}) as {
    mode?: 'append' | 'replace';
    applyConfig?: boolean;
  };

  const existing = mode === 'replace' ? [] : await getQuestionBank();
  const existingIds = new Set(existing.map((question) => question.id));

  const toAdd = DEFAULT_QUESTION_BANK.filter((question) => !existingIds.has(question.id));
  const merged: PsychometricQuestion[] = [...existing, ...toAdd].map((question, index) => ({
    ...question,
    order: index,
  }));

  await db.collection('settings').doc('psychometric_questions').set({
    questions: merged,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (applyConfig) {
    await db.collection('settings').doc('psychometric_config').set(DEFAULT_TEST_CONFIG);
  }

  const result: SeedBankResult = {
    added: toAdd.length,
    skipped: DEFAULT_QUESTION_BANK.length - toAdd.length,
    total: merged.length,
    configApplied: applyConfig,
  };
  return result;
});

// ─── Instrument analysis ──────────────────────────────────────────────────────

/** Cap on how many sessions one analysis run reads. */
const MAX_SESSIONS_ANALYZED = 1000;

export interface NormSummary {
  key: PsychometricNormKey;
  n: number;
  mean: number | null;
  sd: number | null;
  status: 'sin_datos' | 'provisional' | 'estable';
}

/**
 * Item and scale statistics over the sessions collected so far, plus the static
 * bank audit and the state of the local norm sample. This is what tells the admin
 * which items to retire and whether the bands are still absolute or already
 * norm-referenced.
 */
export const analyzePsychometricBank = onCall({ region: 'us-central1' }, async (request) => {
  await requireBankManager(request.auth?.uid);

  const [bank, config, norms] = await Promise.all([getQuestionBank(), getOrSeedConfig(), getNorms()]);

  const snapshot = await db
    .collection('psychometric_sessions')
    .where('status', '==', 'completed')
    .limit(MAX_SESSIONS_ANALYZED)
    .get();

  const sessions: AnalysisSession[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    const result = data.result as { validity?: { verdict?: PsychometricValidityVerdict } } | undefined;
    // Sessions applied by this version snapshot their own items; for older ones
    // the ids in questionOrder still identify what was administered.
    const applied = normalizeBank(data.appliedQuestions);
    return {
      questionIds:
        applied.length > 0
          ? applied.map((question) => question.id)
          : Array.isArray(data.questionOrder)
            ? (data.questionOrder as string[])
            : [],
      answers: Array.isArray(data.answers) ? (data.answers as PsychometricAnswer[]) : [],
      optionOrders: (data.optionOrders as Record<string, number[]>) ?? {},
      validityVerdict: result?.validity?.verdict,
    };
  });

  const normSummaries: NormSummary[] = Object.entries(norms.scales).map(([key, stat]) => {
    const dist = distributionFrom(stat);
    const n = stat?.n ?? 0;
    return {
      key: key as PsychometricNormKey,
      n,
      mean: dist ? Math.round(dist.mean * 10) / 10 : null,
      sd: dist ? Math.round(dist.sd * 10) / 10 : null,
      status:
        n >= NORM_MIN_N_STABLE ? 'estable' : n >= NORM_MIN_N_PROVISIONAL ? 'provisional' : 'sin_datos',
    };
  });

  return {
    analysis: analyzeBank(bank, sessions),
    warnings: auditBank(bank, config),
    norms: normSummaries,
    thresholds: { provisional: NORM_MIN_N_PROVISIONAL, stable: NORM_MIN_N_STABLE },
    sessionsRead: snapshot.size,
    truncated: snapshot.size >= MAX_SESSIONS_ANALYZED,
  };
});

// ─── Norm maintenance ─────────────────────────────────────────────────────────

/**
 * Clears the local norm sample. Needed after a pilot: scores collected while the
 * bank was still changing describe a different instrument, and leaving them in
 * would silently distort every percentile that follows.
 */
export const resetPsychometricNorms = onCall({ region: 'us-central1' }, async (request) => {
  await requireBankManager(request.auth?.uid);
  await db.collection('settings').doc('psychometric_norms').set({
    scales: {},
    updatedAtIso: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
