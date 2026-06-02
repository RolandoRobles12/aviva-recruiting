import { db } from './admin';

/**
 * Look up a recruiter's email by their Firebase UID.
 * Returns undefined if the UID is not a valid recruiter (e.g. 'viterbit_webhook').
 */
export async function getRecruiterEmail(uid: string): Promise<string | undefined> {
  if (!uid || uid === 'viterbit_webhook') return undefined;

  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      return (snap.data() as { email?: string }).email;
    }
  } catch {
    // Fall back to default sender
  }
  return undefined;
}

/** Look up a recruiter's display name by their Firebase UID. */
export async function getRecruiterName(uid: string): Promise<string> {
  if (!uid || uid === 'viterbit_webhook') return '';
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      return (snap.data() as { displayName?: string }).displayName ?? '';
    }
  } catch { /* ignore */ }
  return '';
}
