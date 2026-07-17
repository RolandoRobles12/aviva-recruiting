import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PsychometricSession } from '../types';

const SESSIONS_COLLECTION = 'psychometric_sessions';

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CreateSessionPayload {
  candidateName: string;
  candidateEmail: string;
}

/** Link expires (must be started) after this many days if unopened. */
const LINK_VALID_DAYS = 7;

export async function createPsychometricSession(
  payload: CreateSessionPayload,
  createdBy: string,
  timeLimitMinutes = 30
): Promise<PsychometricSession> {
  const ref = doc(collection(db, SESSIONS_COLLECTION));
  const token = generateToken();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + LINK_VALID_DAYS * 24 * 60 * 60 * 1000));

  const session: Omit<PsychometricSession, 'id'> = {
    candidateName: payload.candidateName,
    candidateEmail: payload.candidateEmail,
    token,
    status: 'pending',
    createdAt: serverTimestamp() as Timestamp,
    createdBy,
    expiresAt,
    timeLimitMinutes,
  };

  await setDoc(ref, session);
  return { id: ref.id, ...session };
}

export async function getPsychometricSessionById(id: string): Promise<PsychometricSession | null> {
  const snap = await getDoc(doc(db, SESSIONS_COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as PsychometricSession;
}

export async function getAllPsychometricSessions(): Promise<PsychometricSession[]> {
  const q = query(collection(db, SESSIONS_COLLECTION), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PsychometricSession));
}
