import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin';
import { DOCUMENT_TYPES_REQUIRED } from './documentTypes';

/**
 * Backfills missing document entries on existing candidate records.
 * Only adds document types that are not already present — never overwrites.
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
      const existing = (data.documents ?? {}) as Record<string, unknown>;

      const missing = DOCUMENT_TYPES_REQUIRED.filter((type) => !(type in existing));
      if (missing.length === 0) continue;

      const patch: Record<string, unknown> = {};
      for (const type of missing) {
        patch[`documents.${type}`] = { id: type, type, status: 'pending' };
      }

      await doc.ref.update(patch);
      updated++;
    }

    return { updated, message: `${updated} candidato(s) actualizados con documentos faltantes.` };
  }
);
