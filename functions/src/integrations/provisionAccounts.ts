import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createHubSpotUser } from './hubspotService';
import { inviteSlackDual } from './slackService';
import { sendEmail } from '../email/gmailClient';
import { inductionTemplate } from '../email/templates';

interface ProvisionRequest {
  candidateId: string;
  corporateEmail: string;
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

    const { candidateId, corporateEmail } = request.data as ProvisionRequest;

    if (!candidateId || !corporateEmail) {
      throw new HttpsError('invalid-argument', 'Se requiere candidateId y corporateEmail.');
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corporateEmail)) {
      throw new HttpsError('invalid-argument', 'El correo corporativo no es válido.');
    }

    const docRef = db.collection('candidates').doc(candidateId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new HttpsError('not-found', 'Candidato no encontrado.');
    }

    const candidate = doc.data()!;

    // Provision HubSpot + dual Slack in parallel
    const [hubspotResult, slackResult] = await Promise.allSettled([
      createHubSpotUser({
        corporateEmail,
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
      }),
      inviteSlackDual({
        corporateEmail,
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
      }),
    ]);

    const hubspotOk = hubspotResult.status === 'fulfilled';
    const slackDual = slackResult.status === 'fulfilled' ? slackResult.value : null;
    const slackPrimaryOk = slackDual?.primary.ok ?? false;
    const slackGuestOk = slackDual?.guest.ok ?? false;

    if (hubspotResult.status === 'rejected') {
      console.error(`[provisionManual] HubSpot failed for ${candidateId}:`, hubspotResult.reason);
    }
    if (slackResult.status === 'rejected') {
      console.error(`[provisionManual] Slack failed for ${candidateId}:`, slackResult.reason);
    }

    // Update candidate record
    await docRef.update({
      corporateEmail,
      status: 'email_ready',
      hubspotCreated: hubspotOk,
      slackInvited: slackPrimaryOk,
      slackGuestInvited: slackGuestOk,
      emailProvisionedAt: FieldValue.serverTimestamp(),
      provisionedManuallyBy: request.auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Send induction email
    try {
      const { subject, html } = inductionTemplate({
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        corporateEmail,
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
      hubspotError: hubspotResult.status === 'rejected' ? String(hubspotResult.reason) : undefined,
      slackError: slackResult.status === 'rejected' ? String(slackResult.reason) : undefined,
    };
  }
);
