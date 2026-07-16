import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString, defineSecret } from 'firebase-functions/params';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as adminSdk from 'firebase-admin';
import { db } from '../utils/admin';
import { parseCandidateStartDate } from '../utils/startDate';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const CHECKINS_SERVICE_ACCOUNT = defineSecret('CHECKINS_SERVICE_ACCOUNT');

const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';
const ACTIVACION_INICIADA_STAGE_ID = '6a0e41f426f91ea93e062b1e';

function getCheckInsDb(serviceAccount: adminSdk.ServiceAccount): FirebaseFirestore.Firestore {
  const appName = 'registro-aviva';
  let app: adminSdk.app.App;
  try {
    app = adminSdk.app(appName);
  } catch {
    app = adminSdk.initializeApp(
      { credential: adminSdk.credential.cert(serviceAccount) },
      appName,
    );
  }
  return app.firestore();
}

/**
 * Runs 3× per day and checks if any 'induction' candidate has registered
 * their first 'entrada' check-in in the registro-aviva app.
 * On first check-in found → move Viterbit stage to "Activación Iniciada"
 * and save activatedAt on the candidate document.
 */
export const checkActivations = onSchedule(
  {
    schedule: '0 8,13,18 * * *',
    timeZone: 'America/Mexico_City',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 300,
    secrets: [CHECKINS_SERVICE_ACCOUNT],
  },
  async () => {
    const apiKey = VITERBIT_API_KEY.value();
    const serviceAccount = JSON.parse(CHECKINS_SERVICE_ACCOUNT.value()) as adminSdk.ServiceAccount;
    const checkInsDb = getCheckInsDb(serviceAccount);

    const snapshot = await db
      .collection('candidates')
      .where('status', '==', 'induction')
      .get();

    const pending = snapshot.docs.filter((d) => !d.data().activatedAt);
    console.log(`[checkActivations] ${pending.length} candidate(s) pending activation`);

    for (const docSnap of pending) {
      const candidate = docSnap.data();
      const corporateEmail = candidate.corporateEmail as string | undefined;
      const viterbitCandidatureId = candidate.viterbitCandidatureId as string | undefined;

      if (!corporateEmail || !viterbitCandidatureId) {
        console.warn(`[checkActivations] ${docSnap.id}: missing required fields — skipping`);
        continue;
      }

      const startDate = parseCandidateStartDate(candidate);
      if (!startDate) {
        console.warn(`[checkActivations] ${docSnap.id}: missing or unparseable viterbitStartDate "${candidate.viterbitStartDate}" — skipping`);
        continue;
      }

      try {
        const checkInSnap = await checkInsDb
          .collection('checkins')
          .where('email', '==', corporateEmail)
          .where('type', '==', 'entrada')
          .where('timestamp', '>=', Timestamp.fromDate(startDate))
          .orderBy('timestamp', 'asc')
          .limit(1)
          .get();

        if (checkInSnap.empty) {
          console.log(`[checkActivations] ${docSnap.id}: no check-in yet for ${corporateEmail}`);
          continue;
        }

        const activatedAt = checkInSnap.docs[0].data().timestamp as Timestamp;
        console.log(`[checkActivations] ${docSnap.id}: first check-in at ${activatedAt.toDate().toISOString()}`);

        // Move to "Activación Iniciada" in Viterbit
        const resp = await fetch(
          `${VITERBIT_API_BASE}/candidatures/${viterbitCandidatureId}/stage`,
          {
            method: 'POST',
            headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage_id: ACTIVACION_INICIADA_STAGE_ID }),
          },
        );
        if (!resp.ok) {
          const text = await resp.text();
          console.error(`[checkActivations] ${docSnap.id}: Viterbit error ${resp.status}: ${text}`);
        } else {
          console.log(`[checkActivations] ${docSnap.id}: moved to Activación Iniciada`);
        }

        await docSnap.ref.update({
          activatedAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error(`[checkActivations] ${docSnap.id}: error`, err);
      }
    }
  },
);
