import * as functions from 'firebase-functions/v1';
import { Timestamp, FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { db } from '../utils/admin';
import { handleAprobado, type ParsedViterbitEvent } from './webhookHandler';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');

// Runs every minute to pick up and process queued Aprobado events after their delay.
export const processPendingApprovals = functions
  .region('us-central1')
  .pubsub.schedule('every 1 minutes')
  .onRun(async () => {
    const now = Timestamp.now();

    const snap = await db
      .collection('pending_approvals')
      .where('processed', '==', false)
      .where('processAfter', '<=', now)
      .get();

    if (snap.empty) return;

    const apiKey = VITERBIT_API_KEY.value();

    await Promise.all(
      snap.docs.map(async (doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        const parsed = data.parsed as ParsedViterbitEvent;
        const logId = data.logId as string;
        const logRef = db.collection('viterbit_webhook_logs').doc(logId);

        // Mark as processed immediately to prevent concurrent runs picking it up
        await doc.ref.update({ processed: true, processingAt: FieldValue.serverTimestamp() });

        try {
          const result = await handleAprobado(parsed, apiKey, logRef);
          await doc.ref.update({ result, processedAt: FieldValue.serverTimestamp() });
        } catch (err) {
          console.error('[processPendingApprovals] Error processing doc', doc.id, err);
          await doc.ref.update({
            processed: false,
            error: String(err),
            failedAt: FieldValue.serverTimestamp(),
          });
        }
      }),
    );
  });
