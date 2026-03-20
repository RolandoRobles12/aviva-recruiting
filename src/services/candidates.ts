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
import type { Candidate, CandidateStatus, CreateCandidatePayload, DocumentType, FormAnswers } from '../types';
import { DOCUMENT_TYPES_REQUIRED } from '../types';
import { computeCompletion, getCandidateDocTypes } from '../utils/candidateCompletion';

const CANDIDATES_COLLECTION = 'candidates';

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildInitialDocuments() {
  // Only initialize required docs — conditional ones are added dynamically
  return Object.fromEntries(
    DOCUMENT_TYPES_REQUIRED.map((type) => [
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
  recruiterUid: string,
  formDays = 7
): Promise<Candidate> {
  const ref = doc(collection(db, CANDIDATES_COLLECTION));
  const token = generateToken();
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + formDays * 24 * 60 * 60 * 1000));

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
  // Completion recalculation is handled exclusively by the backend storage trigger
  // (onDocumentUploaded) after OCR validation. Calling it here from the client
  // would create a race condition that overwrites the authoritative backend result.
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

export async function updateCandidateFormAnswers(
  candidateId: string,
  formAnswers: FormAnswers
): Promise<void> {
  const updateData: Record<string, unknown> = {
    formAnswers,
    updatedAt: serverTimestamp(),
  };

  // Add conditional document slots based on answers
  if (formAnswers.tieneInfonavit) {
    updateData['documents.aviso_retencion'] = {
      id: 'aviso_retencion',
      type: 'aviso_retencion',
      status: 'pending',
    };
  }
  if (formAnswers.tieneFonacot) {
    updateData['documents.estado_cuenta_fonacot'] = {
      id: 'estado_cuenta_fonacot',
      type: 'estado_cuenta_fonacot',
      status: 'pending',
    };
  }

  await updateDoc(doc(db, CANDIDATES_COLLECTION, candidateId), updateData);
}

export async function markDocumentAsValid(
  candidateId: string,
  documentType: DocumentType,
  candidate: Candidate,
): Promise<void> {
  const candidateRef = doc(db, CANDIDATES_COLLECTION, candidateId);

  // Compute new completion percentage with this document now valid
  const simulatedCandidate: Candidate = {
    ...candidate,
    documents: {
      ...candidate.documents,
      [documentType]: { ...candidate.documents[documentType], status: 'valid' },
    },
  };
  const completionPercentage = computeCompletion(simulatedCandidate);

  // Determine if all required docs are now valid → transition to under_review
  const docTypes = getCandidateDocTypes(simulatedCandidate);
  const allValid = docTypes.every((t) => simulatedCandidate.documents[t]?.status === 'valid');
  const hasFormAnswers = candidate.formAnswers != null;
  const shouldTransitionToReview =
    allValid &&
    hasFormAnswers &&
    candidate.status !== 'under_review' &&
    candidate.status !== 'contract_sent' &&
    candidate.status !== 'approved' &&
    candidate.status !== 'rejected';

  await updateDoc(candidateRef, {
    [`documents.${documentType}.status`]: 'valid',
    completionPercentage,
    ...(shouldTransitionToReview ? { status: 'under_review' } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function extendFormToken(candidateId: string, formDays = 7): Promise<string> {
  const newToken = generateToken();
  const newExpiresAt = Timestamp.fromDate(new Date(Date.now() + formDays * 24 * 60 * 60 * 1000));
  await updateDoc(doc(db, CANDIDATES_COLLECTION, candidateId), {
    formToken: newToken,
    formExpiresAt: newExpiresAt,
    updatedAt: serverTimestamp(),
  });
  return newToken;
}
