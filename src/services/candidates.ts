import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Candidate, CandidateStatus, CreateCandidatePayload, DocumentType } from '../types';
import { DOCUMENT_TYPES } from '../types';

const CANDIDATES_COLLECTION = 'candidates';

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildInitialDocuments() {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [
      type,
      {
        id: type,
        type,
        status: 'pending' as const,
      },
    ])
  ) as Candidate['documents'];
}

export async function createCandidate(
  payload: CreateCandidatePayload,
  recruiterUid: string
): Promise<Candidate> {
  const ref = doc(collection(db, CANDIDATES_COLLECTION));
  const token = generateToken();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)); // 7 days

  const candidate: Omit<Candidate, 'id'> = {
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    phone: payload.phone,
    position: payload.position,
    status: 'invited',
    formToken: token,
    formExpiresAt: expiresAt,
    createdAt: serverTimestamp() as Timestamp,
    updatedAt: serverTimestamp() as Timestamp,
    createdBy: recruiterUid,
    documents: buildInitialDocuments(),
    completionPercentage: 0,
    reminderCount: 0,
  };

  await setDoc(ref, candidate);
  return { id: ref.id, ...candidate };
}

export async function getCandidateById(id: string): Promise<Candidate | null> {
  const snap = await getDoc(doc(db, CANDIDATES_COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Candidate;
}

export async function getCandidateByToken(token: string): Promise<Candidate | null> {
  const q = query(
    collection(db, CANDIDATES_COLLECTION),
    where('formToken', '==', token)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() } as Candidate;
}

export async function getAllCandidates(): Promise<Candidate[]> {
  const q = query(
    collection(db, CANDIDATES_COLLECTION),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate));
}

export async function getCandidatesByStatus(status: CandidateStatus): Promise<Candidate[]> {
  const q = query(
    collection(db, CANDIDATES_COLLECTION),
    where('status', '==', status),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate));
}

export async function updateCandidateDocumentStatus(
  candidateId: string,
  documentType: DocumentType,
  updates: Partial<Candidate['documents'][DocumentType]>
): Promise<void> {
  const candidateRef = doc(db, CANDIDATES_COLLECTION, candidateId);
  await updateDoc(candidateRef, {
    [`documents.${documentType}`]: updates,
    updatedAt: serverTimestamp(),
  });
  await recalculateCompletion(candidateId);
}

export async function updateCandidateStatus(
  candidateId: string,
  status: CandidateStatus
): Promise<void> {
  await updateDoc(doc(db, CANDIDATES_COLLECTION, candidateId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function updateCandidateNotes(
  candidateId: string,
  notes: string
): Promise<void> {
  await updateDoc(doc(db, CANDIDATES_COLLECTION, candidateId), {
    notes,
    updatedAt: serverTimestamp(),
  });
}

export async function extendFormToken(candidateId: string): Promise<string> {
  const newToken = generateToken();
  const newExpiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  await updateDoc(doc(db, CANDIDATES_COLLECTION, candidateId), {
    formToken: newToken,
    formExpiresAt: newExpiresAt,
    updatedAt: serverTimestamp(),
  });
  return newToken;
}

async function recalculateCompletion(candidateId: string): Promise<void> {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) return;

  const totalDocs = DOCUMENT_TYPES.length;
  const uploadedDocs = DOCUMENT_TYPES.filter(
    (type) => candidate.documents[type]?.status !== 'pending'
  ).length;

  const completionPercentage = Math.round((uploadedDocs / totalDocs) * 100);
  const newStatus: CandidateStatus =
    completionPercentage === 100
      ? 'under_review'
      : candidate.status === 'invited'
      ? 'in_progress'
      : candidate.status;

  await updateDoc(doc(db, CANDIDATES_COLLECTION, candidateId), {
    completionPercentage,
    status: newStatus,
    updatedAt: serverTimestamp(),
  });
}
