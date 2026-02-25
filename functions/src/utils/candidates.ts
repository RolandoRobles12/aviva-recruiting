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
  const uploaded = DOCUMENT_TYPES.filter((t) => docs[t]?.status !== 'pending').length;
  const completionPercentage = Math.round((uploaded / DOCUMENT_TYPES.length) * 100);

  const currentStatus = candidate.status as string;
  const newStatus =
    completionPercentage === 100
      ? 'under_review'
      : currentStatus === 'invited'
      ? 'in_progress'
      : currentStatus;

  await db.collection('candidates').doc(candidateId).update({
    completionPercentage,
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
