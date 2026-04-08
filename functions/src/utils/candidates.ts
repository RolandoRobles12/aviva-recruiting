import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { DOCUMENT_TYPES_REQUIRED } from './documentTypes';

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
  // Use field-level dot notation to merge into the subdocument instead of
  // replacing it entirely. This preserves existing fields like fileName,
  // downloadUrl, storagePath, and uploadedAt set by the frontend.
  const fieldUpdates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const [key, value] of Object.entries(updates)) {
    fieldUpdates[`documents.${documentType}.${key}`] = value;
  }
  await db.collection('candidates').doc(candidateId).update(fieldUpdates);
}

export async function updateCandidateCompletion(candidateId: string) {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) return;

  // Determine which doc types are required for this candidate
  const requiredTypes = [...DOCUMENT_TYPES_REQUIRED];
  const formAnswers = candidate.formAnswers as Record<string, unknown> | undefined;
  if (formAnswers?.tieneInfonavit) requiredTypes.push('aviso_retencion');
  if (formAnswers?.tieneFonacot) requiredTypes.push('estado_cuenta_fonacot');

  const docs = candidate.documents as Record<string, { status: string }>;
  const validCount = requiredTypes.filter((t) => docs[t]?.status === 'valid').length;

  // Count form answers as 1 item toward completion
  const hasFormAnswers = formAnswers != null;
  const totalItems = requiredTypes.length + 1; // +1 for form answers
  const completedItems = validCount + (hasFormAnswers ? 1 : 0);

  const completionPercentage = Math.round((completedItems / totalItems) * 100);

  const currentStatus = candidate.status as string;

  // Statuses that are past the document review phase — never revert these.
  const TERMINAL_STATUSES = [
    'contract_sent', 'contract_signed',
    'email_pending', 'email_ready', 'induction',
  ];

  const allValid = validCount === requiredTypes.length;
  const hasAnyUpload = requiredTypes.some((t) => docs[t]?.status && docs[t].status !== 'pending');
  const newStatus =
    allValid && hasFormAnswers && !TERMINAL_STATUSES.includes(currentStatus)
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
