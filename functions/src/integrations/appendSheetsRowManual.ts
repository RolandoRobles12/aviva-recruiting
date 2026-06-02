import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString, defineSecret } from 'firebase-functions/params';
import { db } from '../utils/admin';
import { appendCandidateRow } from './sheetsService';
import { getRecruiterName } from '../utils/recruiters';

const DRIVE_SERVICE_ACCOUNT = defineSecret('DRIVE_SERVICE_ACCOUNT');
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function fetchJobInfo(
  jobId: string,
  apiKey: string,
): Promise<{ externalId: string | undefined; recruiterName: string }> {
  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=custom_field_values`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) return { externalId: undefined, recruiterName: '' };
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const externalId = (data.external_id as string) || undefined;
    const custom = (data.custom_field_values as Record<string, unknown>) ?? {};
    const reclutadorId = custom.reclutador as string | undefined;
    let recruiterName = '';
    if (reclutadorId) {
      const uResp = await fetch(`${VITERBIT_API_BASE}/users/${reclutadorId}`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (uResp.ok) {
        const uJson = (await uResp.json()) as Record<string, unknown>;
        const uData = (uJson.data as Record<string, unknown>) ?? uJson;
        recruiterName = (uData.full_name as string) ?? '';
      }
    }
    return { externalId, recruiterName };
  } catch {
    return { externalId: undefined, recruiterName: '' };
  }
}

export const appendSheetsRowManual = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [DRIVE_SERVICE_ACCOUNT],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) {
      throw new HttpsError('invalid-argument', 'Se requiere candidateId.');
    }

    const doc = await db.collection('candidates').doc(candidateId).get();
    if (!doc.exists) {
      throw new HttpsError('not-found', 'Candidato no encontrado.');
    }

    const candidate = { ...doc.data()!, id: candidateId };
    const folderId = (candidate.driveFolderId as string) ?? '';

    const viterbitJobId = candidate.viterbitJobId as string | undefined;
    const apiKey = VITERBIT_API_KEY.value();
    const { externalId, recruiterName: viterbitRecruiter } = viterbitJobId && apiKey
      ? await fetchJobInfo(viterbitJobId, apiKey)
      : { externalId: undefined, recruiterName: '' };
    const recruiterName = viterbitRecruiter
      || await getRecruiterName(candidate.createdBy as string).catch(() => '');

    const serviceAccount = JSON.parse(DRIVE_SERVICE_ACCOUNT.value());

    await appendCandidateRow(candidate, folderId, recruiterName, externalId, serviceAccount);

    return { success: true };
  },
);
