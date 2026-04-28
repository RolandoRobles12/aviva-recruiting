import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { sendEmail } from './gmailClient';
import { invitationTemplate } from './templates';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getRecruiterEmail } from '../utils/recruiters';
import { getLogoUrl } from '../utils/branding';

export const sendInvitationEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const recruiterUid = request.auth.uid;
    const senderEmail = await getRecruiterEmail(recruiterUid);

    const appUrl = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';
    const formUrl = `${appUrl}/form/${candidate.formToken}`;
    const expiresAt = (candidate.formExpiresAt as FirebaseFirestore.Timestamp)?.toDate?.();
    const formExpiresAt = expiresAt
      ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
      : '7 días';

    // Read custom email subject and body from Firestore settings if configured
    let customSubject: string | undefined;
    let customBodyText: string | undefined;
    try {
      const settingsSnap = await db.doc('settings/emailTemplates').get();
      if (settingsSnap.exists) {
        const data = settingsSnap.data() as Record<string, { subject?: string; bodyText?: string }>;
        if (data?.invitation?.subject) {
          customSubject = data.invitation.subject.replace('{position}', candidate.position as string);
        }
        if (data?.invitation?.bodyText) {
          customBodyText = data.invitation.bodyText
            .replace('{firstName}', candidate.firstName as string)
            .replace('{position}', candidate.position as string);
        }
      }
    } catch {
      // Fall back to default template text
    }

    const logoUrl = await getLogoUrl();

    const { subject: defaultSubject, html } = invitationTemplate(
      {
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        formUrl,
        formExpiresAt,
      },
      customBodyText,
      logoUrl,
    );
    const subject = customSubject ?? defaultSubject;

    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      senderEmail,
      recruiterUid,
    });

    // Log the email
    await db.collection('email_logs').add({
      candidateId,
      templateType: 'invitation',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: request.auth.uid,
      success: true,
    });

    return { success: true };
  }
);
