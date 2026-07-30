import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString, defineSecret } from 'firebase-functions/params';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as adminSdk from 'firebase-admin';
import { db } from '../utils/admin';
import { parseCandidateStartDate } from '../utils/startDate';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const CHECKINS_SERVICE_ACCOUNT = defineSecret('CHECKINS_SERVICE_ACCOUNT');

const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';
// Legacy fallback: Viterbit stage ids are per job, so a global id only works
// for the job it belongs to. Kept as last resort for candidates created
// before viterbitStageIds.onboardingIniciado was cached.
const ACTIVACION_INICIADA_STAGE_ID = '6a0e41f426f91ea93e062b1e';

/**
 * Resolve the "Onboarding Iniciado" / "Activación Iniciada" stage id for the
 * candidate's job: cached id first, live job-stage lookup second, legacy
 * hardcoded id last.
 */
async function resolveOnboardingIniciadoStageId(
  candidate: FirebaseFirestore.DocumentData,
  apiKey: string,
): Promise<string> {
  const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
  if (stageIds?.onboardingIniciado) return stageIds.onboardingIniciado;

  const jobId = candidate.viterbitJobId as string | undefined;
  if (jobId && apiKey) {
    try {
      const resp = await fetch(
        `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages`,
        { headers: { 'X-API-Key': apiKey } },
      );
      if (resp.ok) {
        const json = (await resp.json()) as Record<string, unknown>;
        const data = (json.data as Record<string, unknown>) ?? json;
        const stages = (data.stages as Array<{ id: string; name: string }>) ?? [];
        const byName = (name: string) => stages.find((s) => s.name.toLowerCase() === name)?.id;
        const found = byName('onboarding iniciado') ?? byName('activación iniciada') ?? byName('activacion iniciada');
        if (found) return found;
      }
    } catch (err) {
      console.warn('[checkActivations] stage lookup failed:', err);
    }
  }

  return ACTIVACION_INICIADA_STAGE_ID;
}

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
 * Runs 3× per day and checks if any 'induction' or 'email_ready' candidate
 * has registered their first 'entrada' check-in in the registro-aviva app.
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

    // Include 'email_ready': checkViterbitEmail advances candidates to that
    // status when it stamps corporateEmail, and this function requires
    // corporateEmail to match check-ins. Querying only 'induction' made both
    // conditions mutually exclusive, so no candidate was ever activated.
    const snapshot = await db
      .collection('candidates')
      .where('status', 'in', ['induction', 'email_ready'])
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

        // Move to "Onboarding Iniciado" / "Activación Iniciada" in Viterbit
        const stageId = await resolveOnboardingIniciadoStageId(candidate, apiKey);
        const resp = await fetch(
          `${VITERBIT_API_BASE}/candidatures/${viterbitCandidatureId}/stage`,
          {
            method: 'POST',
            headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage_id: stageId }),
          },
        );
        if (!resp.ok) {
          const text = await resp.text();
          console.error(`[checkActivations] ${docSnap.id}: Viterbit error ${resp.status}: ${text}`);
        } else {
          console.log(`[checkActivations] ${docSnap.id}: moved to Onboarding Iniciado (${stageId})`);
        }

        // Update status directly — don't rely on the Viterbit webhook firing
        // for API-triggered moves (handleStatusSync covers manual moves).
        await docSnap.ref.update({
          activatedAt,
          status: 'onboarding_iniciado',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error(`[checkActivations] ${docSnap.id}: error`, err);
      }
    }
  },
);
