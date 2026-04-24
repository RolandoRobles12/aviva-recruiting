import * as functions from 'firebase-functions/v1';
import { FieldValue } from 'firebase-admin/firestore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from '../email/gmailClient';
import { offerTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { getLogoUrl } from '../utils/branding';

const APP_URL = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';

/**
 * Firestore trigger: when a candidate document is created with status 'offer_sent',
 * automatically send the offer letter email.
 * This ensures the email is sent regardless of how the candidate was created
 * (Viterbit webhook, manual creation, etc.).
 * Uses offerEmailSent flag to prevent double-sends with the webhook.
 */
export const onCandidateCreated = functions
  .region('us-central1')
  .firestore.document('candidates/{candidateId}')
  .onCreate(async (snap, context) => {
    const candidate = snap.data();
    const candidateId = context.params.candidateId;

    if (candidate.status !== 'offer_sent') return null;

    const offerToken = candidate.offerToken as string | undefined;
    if (!offerToken) return null;

    // Skip if the webhook already sent the email
    if (candidate.offerEmailSent === true) return null;

    const offerUrl = `${APP_URL}/offer/${offerToken}`;
    const expiresAt = candidate.offerExpiresAt?.toDate?.() as Date | undefined;
    const offerExpiresAtStr = expiresAt
      ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
      : '—';

    const logoUrl = await getLogoUrl();
    const { subject, html } = offerTemplate({
      firstName: (candidate.firstName as string) || '',
      lastName:  (candidate.lastName  as string) || '',
      position:  (candidate.position  as string) || '',
      offerUrl,
      offerExpiresAt: offerExpiresAtStr,
      logoUrl,
    });

    try {
      const createdBy = candidate.createdBy as string;
      const senderEmail = await getRecruiterEmail(createdBy);
      await sendEmail({
        to: candidate.email as string,
        subject,
        html,
        senderEmail,
        recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
      });

      await snap.ref.update({ offerEmailSent: true, updatedAt: FieldValue.serverTimestamp() });

      await db.collection('email_logs').add({
        candidateId,
        templateType: 'offer',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'onCreate_trigger',
        success: true,
      });
    } catch (err) {
      console.error('[onCandidateCreated] offer email error:', err);
      await db.collection('email_logs').add({
        candidateId,
        templateType: 'offer',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'onCreate_trigger',
        success: false,
        error: (err as Error).message,
      });
    }

    return null;
  });
