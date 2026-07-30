import { useState } from 'react';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL ?? '';

export type TestSection = 'personalidad' | 'escenarios';

export type TestQuestion =
  | { id: string; type: 'likert' | 'attention'; text: string; section: TestSection }
  | { id: string; type: 'sjt'; text: string; section: TestSection; options: string[] };

export interface TestSessionData {
  candidateName: string;
  timeLimitMinutes: number;
  startedAtIso?: string;
  /** Server time when the session was fetched — see clockOffsetMs below. */
  serverNowIso?: string;
  questions: TestQuestion[];
  /** Answers already stored for this session, when resuming. */
  savedAnswers?: { questionId: string; value: number }[];
}

/**
 * Difference between the device clock and the server's, in ms. The deadline is
 * server-assigned, so a phone whose clock runs a few minutes fast would
 * otherwise see the timer already expired — and auto-submit an empty test —
 * while the server still considers the session open.
 */
export function clockOffsetMs(data: TestSessionData | null): number {
  if (!data?.serverNowIso) return 0;
  const serverNow = new Date(data.serverNowIso).getTime();
  if (!Number.isFinite(serverNow)) return 0;
  return serverNow - Date.now();
}

export interface TestPreview {
  candidateName: string;
  timeLimitMinutes: number;
  totalQuestions: number;
  alreadyStarted: boolean;
}

/**
 * Loading the session marks it "in_progress" and starts the server-side timer
 * (see functions/src/psychometricTest/getTest.ts), so `start()` is called only
 * once the candidate clicks past the instructions screen — never on mount.
 * `peek()` is the read-only variant used to fill in that screen.
 */
export function usePsychometricTestSession(token: string | undefined) {
  const [data, setData] = useState<TestSessionData | null>(null);
  const [preview, setPreview] = useState<TestPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peek = async () => {
    if (!token) {
      setError('Token inválido.');
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(
        `${API_BASE}/getPsychometricTest?token=${encodeURIComponent(token)}&peek=1`
      );
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        setError(json.error === 'already_completed' ? 'Esta prueba ya fue enviada.' : json.error);
        return;
      }
      setPreview(json.preview as TestPreview);
    } catch {
      setError('Error al cargar la prueba.');
    } finally {
      setLoading(false);
    }
  };

  const start = async () => {
    if (!token) {
      setError('Token inválido.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/getPsychometricTest?token=${encodeURIComponent(token)}`);
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        throw new Error(json.error ?? 'No se pudo cargar la prueba.');
      }
      setData(json.session as TestSessionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar la prueba.');
    } finally {
      setLoading(false);
    }
  };

  return { data, preview, loading, error, peek, start };
}

export interface AnswerPayload {
  questionId: string;
  value: number;
  responseMs?: number;
}

/**
 * Stores the answers so far. Fire-and-forget by design: the candidate should not
 * be interrupted because an autosave failed, and the final submit re-sends
 * everything it holds anyway.
 */
export async function savePsychometricProgress(
  token: string,
  answers: AnswerPayload[]
): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/savePsychometricProgress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, answers }),
    });
    const json = await resp.json();
    return resp.ok && json.ok === true;
  } catch {
    return false;
  }
}

export async function submitPsychometricTest(
  token: string,
  answers: AnswerPayload[]
): Promise<{ ok: boolean; error?: string; alreadyCompleted?: boolean }> {
  try {
    const resp = await fetch(`${API_BASE}/submitPsychometricTest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, answers }),
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) {
      // A 409 means the server already holds this submission — from the
      // candidate's point of view the test is done, not failed.
      if (resp.status === 409) return { ok: true, alreadyCompleted: true };
      return { ok: false, error: json.error ?? 'Error al enviar tus respuestas.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.' };
  }
}
