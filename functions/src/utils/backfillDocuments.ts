import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { DOCUMENT_TYPES_REQUIRED, ALL_DOCUMENT_TYPES } from './documentTypes';

/**
 * Backfills missing document entries on existing candidate records.
 * - Adds document types from DOCUMENT_TYPES_REQUIRED that are missing.
 * - Removes obsolete document types (not in ALL_DOCUMENT_TYPES) that are still pending.
 */
export const backfillCandidateDocuments = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const snapshot = await db.collection('candidates').get();
    let updated = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const existing = (data.documents ?? {}) as Record<string, { status?: string }>;

      const missing = DOCUMENT_TYPES_REQUIRED.filter((type) => !(type in existing));

      // Remove obsolete types that are still pending (safe to delete — no file uploaded)
      const obsolete = Object.entries(existing)
        .filter(([type, d]) => !ALL_DOCUMENT_TYPES.includes(type) && d.status === 'pending')
        .map(([type]) => type);

      if (missing.length === 0 && obsolete.length === 0) continue;

      const patch: Record<string, unknown> = {};
      for (const type of missing) {
        patch[`documents.${type}`] = { id: type, type, status: 'pending' };
      }
      for (const type of obsolete) {
        patch[`documents.${type}`] = FieldValue.delete();
      }

      await doc.ref.update(patch);
      updated++;
    }

    return { updated, message: `${updated} candidato(s) actualizados con documentos faltantes.` };
  }
);
