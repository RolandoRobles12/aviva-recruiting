import { useState } from 'react';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL ?? '';

export type TestQuestion =
  | { id: string; type: 'likert'; text: string }
  | { id: string; type: 'sjt'; text: string; options: string[] };

export interface TestSessionData {
  candidateName: string;
  timeLimitMinutes: number;
  startedAtIso?: string;
  questions: TestQuestion[];
}

/**
 * Loading the session marks it "in_progress" and starts the server-side timer
 * (see functions/src/psychometricTest/getTest.ts), so `start()` is called only
 * once the candidate clicks past the instructions screen — never on mount.
 */
export function usePsychometricTestSession(token: string | undefined) {
  const [data, setData] = useState<TestSessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return { data, loading, error, start };
}

export async function submitPsychometricTest(
  token: string,
  answers: { questionId: string; value: number; responseMs?: number }[]
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch(`${API_BASE}/submitPsychometricTest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, answers }),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) {
    return { ok: false, error: json.error ?? 'Error al enviar tus respuestas.' };
  }
  return { ok: true };
}
