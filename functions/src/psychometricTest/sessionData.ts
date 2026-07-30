// Pure helpers over a session document: deadlines, the frozen question list and
// request-payload shape checks. Kept free of any Firestore import so the logic
// can be tested without credentials.

import { normalizeBank } from './normalize';
import type { PsychometricAnswer, PsychometricQuestion, PsychometricTestConfig } from './types';

/** Grace period so a slow network doesn't fail a candidate who submitted in time. */
export const SUBMIT_GRACE_MS = 60_000;

/** A raw session document, as stored. */
export type SessionData = Record<string, unknown>;

function toDate(value: unknown): Date | undefined {
  const candidate = value as { toDate?: () => Date } | undefined;
  return typeof candidate?.toDate === 'function' ? candidate.toDate() : undefined;
}

export function startedAtOf(session: SessionData): Date | undefined {
  return toDate(session.startedAt);
}

export function expiresAtOf(session: SessionData): Date | undefined {
  return toDate(session.expiresAt);
}

export function timeLimitOf(session: SessionData, config: PsychometricTestConfig): number {
  const stored = session.timeLimitMinutes;
  return typeof stored === 'number' && stored > 0 ? stored : config.timeLimitMinutes;
}

/** When the candidate's time is up. Undefined until the session has started. */
export function deadlineOf(session: SessionData, config: PsychometricTestConfig): Date | undefined {
  const startedAt = startedAtOf(session);
  if (!startedAt) return undefined;
  return new Date(startedAt.getTime() + timeLimitOf(session, config) * 60 * 1000);
}

/**
 * The questions this session was built from. Sessions started by this version
 * carry a full snapshot, so later edits to the bank cannot change how an
 * in-flight test is scored. Older sessions only stored ids, so those fall back
 * to resolving against the bank as it stands now.
 */
export function appliedQuestionsOf(session: SessionData, bank: PsychometricQuestion[]): PsychometricQuestion[] {
  const snapshot = normalizeBank(session.appliedQuestions);
  if (snapshot.length > 0) {
    const order = Array.isArray(session.questionOrder) ? (session.questionOrder as string[]) : [];
    if (order.length === 0) return snapshot;
    const byId = new Map(snapshot.map((q) => [q.id, q]));
    return order.map((id) => byId.get(id)).filter((q): q is PsychometricQuestion => !!q);
  }

  const order = Array.isArray(session.questionOrder) ? (session.questionOrder as string[]) : [];
  const byId = new Map(bank.map((q) => [q.id, q]));
  return order.map((id) => byId.get(id)).filter((q): q is PsychometricQuestion => !!q);
}

export function progressAnswersOf(session: SessionData): PsychometricAnswer[] {
  const raw = session.progressAnswers;
  return Array.isArray(raw) ? (raw as PsychometricAnswer[]) : [];
}

export function optionOrdersOf(session: SessionData): Record<string, number[]> {
  const raw = session.optionOrders;
  return raw && typeof raw === 'object' ? (raw as Record<string, number[]>) : {};
}

/** Upper bound on a request body, before any per-item validation. */
export const MAX_PAYLOAD_ANSWERS = 500;
const MAX_TOKEN_LENGTH = 128;

export interface ParsedAnswerPayload {
  token: string;
  answers: PsychometricAnswer[];
}

/**
 * Shape-checks a public POST body. Per-item validation (value ranges, unknown
 * question ids) happens later against the session's own question list — this
 * only rejects bodies that are not answer payloads at all.
 */
export function parseAnswerPayload(body: unknown): ParsedAnswerPayload | null {
  if (!body || typeof body !== 'object') return null;
  const { token, answers } = body as { token?: unknown; answers?: unknown };
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  if (!Array.isArray(answers)) return null;

  return {
    token,
    answers: answers.slice(0, MAX_PAYLOAD_ANSWERS).filter((a): a is PsychometricAnswer => {
      if (!a || typeof a !== 'object') return false;
      const { questionId, value } = a as { questionId?: unknown; value?: unknown };
      return typeof questionId === 'string' && questionId.length > 0 && typeof value === 'number';
    }),
  };
}

/** Merges a resumed session's saved answers with a fresh payload; payload wins. */
export function mergeAnswers(
  saved: PsychometricAnswer[],
  incoming: PsychometricAnswer[]
): PsychometricAnswer[] {
  const merged = new Map<string, PsychometricAnswer>();
  for (const answer of saved) {
    if (answer && typeof answer.questionId === 'string') merged.set(answer.questionId, answer);
  }
  for (const answer of incoming) {
    if (answer && typeof answer.questionId === 'string') merged.set(answer.questionId, answer);
  }
  return [...merged.values()];
}
