import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { sendEmail } from '../email/gmailClient';
import { offerTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { getLogoUrl } from '../utils/branding';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });

export const sendOfferEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId es requerido');

    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const offerToken = candidate.offerToken as string | undefined;
    if (!offerToken) throw new HttpsError('failed-precondition', 'El candidato no tiene carta oferta generada.');

    const appUrl = APP_URL.value();
    const offerUrl = `${appUrl}/offer/${offerToken}`;

    const expiresAt = (candidate.offerExpiresAt as FirebaseFirestore.Timestamp | undefined)?.toDate?.();
    const offerExpiresAt = expiresAt
      ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
      : '—';

    const recruiterUid = request.auth.uid;
    const senderEmail = await getRecruiterEmail(recruiterUid);

    const logoUrl = await getLogoUrl();

    const { subject, html } = offerTemplate({
      firstName: (candidate.firstName as string) || '',
      lastName:  (candidate.lastName  as string) || '',
      position:  (candidate.position  as string) || '',
      offerUrl,
      offerExpiresAt,
      logoUrl,
    });

    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      senderEmail,
      recruiterUid,
    });

    await db.collection('email_logs').add({
      candidateId,
      templateType: 'offer',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: recruiterUid,
      success: true,
    });

    return { success: true };
  }
);
