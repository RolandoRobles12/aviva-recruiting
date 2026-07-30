// Firestore lookup for psychometric sessions. Everything that does not need the
// database lives in sessionData.ts.

import type { DocumentReference } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import type { SessionData } from './sessionData';

export const SESSIONS_COLLECTION = 'psychometric_sessions';

export interface FoundSession {
  ref: DocumentReference;
  data: SessionData;
}

export async function findSessionByToken(token: string): Promise<FoundSession | null> {
  const snap = await db.collection(SESSIONS_COLLECTION).where('token', '==', token).limit(1).get();
  if (snap.empty) return null;
  return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
}
