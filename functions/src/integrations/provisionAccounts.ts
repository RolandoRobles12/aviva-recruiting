import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createHubSpotUser } from './hubspotService';
import { inviteSlackDual } from './slackService';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function moveToViterbitStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: stageId }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
    }
  } catch (err) {
    console.error('[provisionManual] moveToViterbitStage error:', err);
  }
}

interface ProvisionRequest {
  candidateId: string;
  corporateEmail?: string;
  skipSlack?: boolean;
}

/**
 * Manual account provisioning — allows recruiters to enter a corporate email
 * and trigger HubSpot + dual Slack account creation without Jira.
 */
export const provisionAccountsManual = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const { candidateId, corporateEmail: manualEmail, skipSlack = false } = request.data as ProvisionRequest;

    if (!candidateId) {
      throw new HttpsError('invalid-argument', 'Se requiere candidateId.');
    }

    const docRef = db.collection('candidates').doc(candidateId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new HttpsError('not-found', 'Candidato no encontrado.');
    }

    const candidate = doc.data()!;

    // Resolve corporate email: prefer Viterbit field, fall back to manually entered value
    const apiKey = VITERBIT_API_KEY.value();
    const viterbitCandidateId = candidate.viterbitCandidateId as string | undefined;
    const viterbitCandidatureId = candidate.viterbitCandidatureId as string | undefined;
    let corporateEmail = manualEmail?.trim() || '';

    const extractCustomEmail = (json: Record<string, unknown>): string => {
      const data = (json.data as Record<string, unknown>) ?? json;
      const customFields = (data.custom_field_values as Record<string, unknown>) ?? {};
      console.log('[provisionManual] custom_field_values keys:', Object.keys(customFields));
      const raw = customFields.correo_corporativo;
      if (raw && typeof raw === 'object' && 'value' in raw) {
        return String((raw as Record<string, unknown>).value ?? '');
      }
      return (raw as string) || '';
    };

    // 1. Try candidate-level custom field
    if (!corporateEmail && viterbitCandidateId && apiKey) {
      try {
        const resp = await fetch(
          `${VITERBIT_API_BASE}/candidates/${viterbitCandidateId}?includes[]=custom_field_values`,
          { headers: { 'X-API-Key': apiKey } },
        );
        if (resp.ok) {
          const json = (await resp.json()) as Record<string, unknown>;
          corporateEmail = extractCustomEmail(json);
          console.log('[provisionManual] candidate correo_corporativo →', corporateEmail || '(vacío)');
        } else {
          console.warn('[provisionManual] Viterbit GET candidate failed:', resp.status);
        }
      } catch (err) {
        console.warn('[provisionManual] Could not fetch from Viterbit candidate:', err);
      }
    }

    // 2. Fallback: try candidature-level custom field
    if (!corporateEmail && viterbitCandidatureId && apiKey) {
      try {
        const resp = await fetch(
          `${VITERBIT_API_BASE}/candidatures/${viterbitCandidatureId}?includes[]=custom_field_values`,
          { headers: { 'X-API-Key': apiKey } },
        );
        if (resp.ok) {
          const json = (await resp.json()) as Record<string, unknown>;
          corporateEmail = extractCustomEmail(json);
          console.log('[provisionManual] candidature correo_corporativo →', corporateEmail || '(vacío)');
        } else {
          console.warn('[provisionManual] Viterbit GET candidature failed:', resp.status);
        }
      } catch (err) {
        console.warn('[provisionManual] Could not fetch from Viterbit candidature:', err);
      }
    }

    console.log('[provisionManual] viterbitCandidateId:', viterbitCandidateId ?? 'null',
      '| viterbitCandidatureId:', viterbitCandidatureId ?? 'null',
      '| corporateEmail resolved:', corporateEmail || '(none)');

    if (!corporateEmail) {
      throw new HttpsError(
        'invalid-argument',
        `No se encontró correo corporativo. viterbitCandidateId=${viterbitCandidateId ?? 'null'}, viterbitCandidatureId=${viterbitCandidatureId ?? 'null'}. Ingrésalo manualmente.`,
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corporateEmail)) {
      throw new HttpsError('invalid-argument', 'El correo corporativo no es válido.');
    }

    // Provision HubSpot (always) + dual Slack (optional)
    const hubspotPromise = createHubSpotUser({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
    });

    const slackPromise = skipSlack
      ? Promise.resolve(null)
      : inviteSlackDual({
          corporateEmail,
          firstName: candidate.firstName as string,
          lastName: candidate.lastName as string,
        });

    const [hubspotResult, slackResult] = await Promise.allSettled([hubspotPromise, slackPromise]);

    const hubspotOk = hubspotResult.status === 'fulfilled';
    const hubspotOwnerId = hubspotResult.status === 'fulfilled' ? (hubspotResult.value.ownerId ?? null) : null;
    const slackValue = slackResult.status === 'fulfilled' ? slackResult.value : null;
    const slackPrimaryOk = slackValue?.primary.ok ?? false;
    const slackGuestOk = slackValue?.guest.ok ?? false;

    if (hubspotResult.status === 'rejected') {
      console.error(`[provisionManual] HubSpot failed for ${candidateId}:`, hubspotResult.reason);
    }
    if (!skipSlack && slackResult.status === 'rejected') {
      console.error(`[provisionManual] Slack failed for ${candidateId}:`, slackResult.reason);
    }

    // Update candidate record — only persist corporateEmail if HubSpot succeeded
    const firestoreUpdate: Record<string, unknown> = {
      hubspotCreated: hubspotOk,
      slackInvited: slackPrimaryOk,
      slackGuestInvited: slackGuestOk,
      emailProvisionedAt: FieldValue.serverTimestamp(),
      provisionedManuallyBy: request.auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (hubspotOk) {
      firestoreUpdate.corporateEmail = corporateEmail;
      firestoreUpdate.status = 'induction';
      if (hubspotOwnerId) firestoreUpdate.hubspotOwnerId = hubspotOwnerId;
    }
    await docRef.update(firestoreUpdate);

    // Move candidate to "Inducción" stage in Viterbit
    const viterbitStageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const induccionStageId = viterbitStageIds?.induccion;
    if (apiKey && viterbitCandidatureId && induccionStageId) {
      void moveToViterbitStage(viterbitCandidatureId, induccionStageId, apiKey);
    }

    return {
      success: true,
      hubspotCreated: hubspotOk,
      slackPrimaryInvited: slackPrimaryOk,
      slackGuestInvited: slackGuestOk,
      corporateEmail,
      hubspotError: hubspotResult.status === 'rejected' ? String(hubspotResult.reason) : undefined,
      slackError: slackResult.status === 'rejected' ? String(slackResult.reason) : undefined,
    };
  }
);
