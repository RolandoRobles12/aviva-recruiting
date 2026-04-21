import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { sendEmail } from './gmailClient';
import { contractTemplate } from './templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });

export const sendContractEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const contractToken = candidate.contractToken as string | undefined;
    if (!contractToken) throw new HttpsError('failed-precondition', 'El candidato no tiene contrato generado.');

    const appUrl = APP_URL.value();
    const contractUrl = `${appUrl}/contract/${contractToken}`;

    const expiresAt = (candidate.contractExpiresAt as FirebaseFirestore.Timestamp | undefined)?.toDate?.();
    const contractExpiresAt = expiresAt
      ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
      : '—';

    const recruiterUid = request.auth.uid;
    const senderEmail = await getRecruiterEmail(recruiterUid);

    const { subject, html } = contractTemplate({
      firstName: (candidate.firstName as string) || '',
      lastName:  (candidate.lastName  as string) || '',
      position:  (candidate.position  as string) || '',
      contractUrl,
      contractExpiresAt,
    });

    await sendEmail({ to: candidate.email as string, subject, html, senderEmail, recruiterUid });

    await db.collection('email_logs').add({
      candidateId,
      templateType: 'contract',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: recruiterUid,
      success: true,
    });

    return { success: true };
  }
);
