import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

export async function getCandidateById(id: string) {
  const snap = await db.collection('candidates').doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as Record<string, unknown> & { id: string };
}

export async function updateCandidateDocument(
  candidateId: string,
  documentType: string,
  updates: Record<string, unknown>
) {
  await db.collection('candidates').doc(candidateId).update({
    [`documents.${documentType}`]: updates,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateCandidateCompletion(candidateId: string) {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) return;

  const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];
  const docs = candidate.documents as Record<string, { status: string }>;
  const validCount = DOCUMENT_TYPES.filter((t) => docs[t]?.status === 'valid').length;
  const completionPercentage = Math.round((validCount / DOCUMENT_TYPES.length) * 100);

  const currentStatus = candidate.status as string;
  const allValid = validCount === DOCUMENT_TYPES.length;
  const hasAnyUpload = DOCUMENT_TYPES.some((t) => docs[t]?.status && docs[t].status !== 'pending');
  const newStatus =
    allValid
      ? 'under_review'
      : hasAnyUpload && currentStatus === 'invited'
      ? 'in_progress'
      : currentStatus;

  await db.collection('candidates').doc(candidateId).update({
    completionPercentage,
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
