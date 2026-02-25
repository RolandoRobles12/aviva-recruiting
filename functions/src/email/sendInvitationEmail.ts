import * as functions from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { createGmailTransport, getFromAddress } from './gmailClient';
import { invitationTemplate } from './templates';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export const sendInvitationEmail = functions
  .region('us-central1')
  .https.onCall(async (data: { candidateId: string }, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = data;
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new functions.https.HttpsError('not-found', 'Candidato no encontrado');

    const appUrl = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';
    const formUrl = `${appUrl}/form/${candidate.formToken}`;
    const expiresAt = (candidate.formExpiresAt as FirebaseFirestore.Timestamp)?.toDate?.();
    const formExpiresAt = expiresAt
      ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
      : '7 días';

    const { subject, html } = invitationTemplate({
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      formUrl,
      formExpiresAt,
    });

    const transport = await createGmailTransport();
    await transport.sendMail({
      from: getFromAddress(),
      to: candidate.email as string,
      subject,
      html,
    });

    // Log the email
    await db.collection('email_logs').add({
      candidateId,
      templateType: 'invitation',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: context.auth.uid,
      success: true,
    });

    return { success: true };
  });
