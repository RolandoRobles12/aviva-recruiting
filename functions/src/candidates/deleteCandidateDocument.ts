import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, storage } from '../utils/admin';
import { userHasPermission } from '../utils/permissions';
import { ALL_DOCUMENT_TYPES } from '../utils/documentTypes';

/**
 * Deletes a candidate's uploaded document (Storage file + OCR result) and
 * resets it to 'pending' so the candidate can upload it again. Restricted to
 * admins by default — these are sensitive personal documents (CURP,
 * identificación, comprobante de domicilio…) and the action can't be undone
 * from the UI, so it's audited in a document_deletions subcollection.
 *
 * The frontend's upload widget reopens for any status other than 'valid', so
 * resetting to 'pending' alone unblocks re-upload; onCandidateUpdated already
 * watches documents.*.status for changes and recalculates completion/status.
 */
export const deleteCandidateDocument = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const allowed = await userHasPermission(request.auth.uid, 'process_delete_document', {
      reclutador: false,
      lider: false,
      nomina: false,
      legal: false,
    });
    if (!allowed) {
      throw new HttpsError('permission-denied', 'Solo un administrador puede eliminar un documento cargado.');
    }

    const { candidateId, documentType } = request.data as { candidateId: string; documentType: string };
    if (!candidateId || !documentType) {
      throw new HttpsError('invalid-argument', 'candidateId y documentType son requeridos.');
    }
    if (!ALL_DOCUMENT_TYPES.includes(documentType)) {
      throw new HttpsError('invalid-argument', 'Tipo de documento no válido.');
    }

    const snap = await db.collection('candidates').doc(candidateId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Candidato no encontrado.');
    const candidate = snap.data()!;

    const docs = (candidate.documents ?? {}) as Record<
      string,
      { status?: string; fileName?: string; storagePath?: string }
    >;
    const current = docs[documentType];
    if (!current || !current.storagePath) {
      throw new HttpsError('failed-precondition', 'Este documento no tiene un archivo cargado.');
    }

    // Best-effort: remove the file from Storage. A missing object (already
    // deleted, legacy record) shouldn't block resetting the Firestore state.
    try {
      await storage.bucket().file(current.storagePath).delete();
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 404) {
        console.error(`[deleteCandidateDocument] Storage delete failed for ${current.storagePath}:`, err);
      }
    }

    await snap.ref.collection('document_deletions').add({
      documentType,
      deletedBy: request.auth.uid,
      deletedAt: FieldValue.serverTimestamp(),
      priorStatus: current.status ?? null,
      priorFileName: current.fileName ?? null,
      priorStoragePath: current.storagePath,
    });

    await snap.ref.update({
      [`documents.${documentType}`]: { id: documentType, type: documentType, status: 'pending' },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  },
);
