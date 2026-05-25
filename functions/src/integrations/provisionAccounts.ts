import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createHubSpotUser } from './hubspotService';
import { inviteSlackDual } from './slackService';
import { sendEmail } from '../email/gmailClient';
import { inductionTemplate } from '../email/templates';
import { getLogoUrl } from '../utils/branding';

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
    let corporateEmail = manualEmail?.trim() || '';

    if (viterbitCandidateId && apiKey) {
      try {
        const resp = await fetch(`${VITERBIT_API_BASE}/candidates/${viterbitCandidateId}`, {
          headers: { 'X-API-Key': apiKey },
        });
        if (resp.ok) {
          const json = (await resp.json()) as Record<string, unknown>;
          const data = (json.data as Record<string, unknown>) ?? json;
          const customFields = (data.custom_field_values as Record<string, unknown>) ?? {};
          const viterbitEmail = (customFields.correo_corporativo as string) || '';
          if (viterbitEmail) corporateEmail = viterbitEmail;
        }
      } catch (err) {
        console.warn('[provisionManual] Could not fetch correo_corporativo from Viterbit:', err);
      }
    }

    if (!corporateEmail) {
      throw new HttpsError('invalid-argument', 'No se encontró correo corporativo en Viterbit ni fue ingresado manualmente.');
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
    const viterbitCandidatureId = candidate.viterbitCandidatureId as string | undefined;
    const viterbitStageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const induccionStageId = viterbitStageIds?.induccion;
    if (apiKey && viterbitCandidatureId && induccionStageId) {
      void moveToViterbitStage(viterbitCandidatureId, induccionStageId, apiKey);
    }

    // Send induction email
    try {
      const logoUrl = await getLogoUrl();
      const { subject, html } = inductionTemplate({
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        corporateEmail,
        logoUrl,
      });
      await sendEmail({
        to: candidate.email as string,
        subject,
        html,
        recruiterUid: request.auth.uid,
      });
      await db.collection('email_logs').add({
        candidateId,
        templateType: 'induction',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'manual_provision',
        success: true,
      });
    } catch (err) {
      console.error(`[provisionManual] Failed to send induction email for ${candidateId}:`, err);
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
