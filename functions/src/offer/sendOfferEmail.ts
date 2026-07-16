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

/**
 * Builds and sends the offer email for a candidate, logs it, and marks the
 * candidate as offer_sent. Shared by the sendOfferEmail callable and
 * reissueOffer. Throws HttpsError when the candidate lacks an offer token or
 * the required hiring details.
 */
export async function sendOfferEmailCore(
  candidateId: string,
  candidate: Record<string, unknown>,
  recruiterUid: string,
): Promise<void> {
  const offerToken = candidate.offerToken as string | undefined;
  if (!offerToken) throw new HttpsError('failed-precondition', 'El candidato no tiene carta oferta generada.');

  const missingSalary = !(candidate.viterbitSalary as string | undefined)?.trim();
  const missingDate = !(candidate.viterbitStartDate as string | undefined)?.trim();
  if (missingSalary || missingDate) {
    const missing = [missingSalary && 'salario', missingDate && 'fecha de inicio'].filter(Boolean).join(' y ');
    throw new HttpsError('failed-precondition', `Faltan datos de Viterbit: ${missing}. Refresca los datos antes de enviar.`);
  }

  const appUrl = APP_URL.value();
  const offerUrl = `${appUrl}/offer/${offerToken}`;

  const expiresAt = (candidate.offerExpiresAt as FirebaseFirestore.Timestamp | undefined)?.toDate?.()
    ?? (candidate.offerExpiresAt instanceof Date ? candidate.offerExpiresAt : undefined);
  const offerExpiresAt = expiresAt
    ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
    : '—';

  const senderEmail = await getRecruiterEmail(recruiterUid);

  // Read custom email subject from Firestore settings if configured
  let customSubject: string | undefined;
  try {
    const settingsSnap = await db.doc('settings/emailTemplates').get();
    if (settingsSnap.exists) {
      const data = settingsSnap.data() as Record<string, { subject?: string; bodyText?: string }>;
      if (data?.offer?.subject) {
        customSubject = data.offer.subject.replace('{position}', (candidate.position as string) || '');
      }
    }
  } catch {
    // Fall back to default template subject
  }

  const logoUrl = await getLogoUrl();

  const { subject: defaultSubject, html } = offerTemplate({
    firstName: (candidate.firstName as string) || '',
    lastName:  (candidate.lastName  as string) || '',
    position:  (candidate.position  as string) || '',
    offerUrl,
    offerExpiresAt,
    logoUrl,
  });
  const subject = customSubject ?? defaultSubject;

  await sendEmail({
    to: candidate.email as string,
    subject,
    html,
    senderEmail,
    recruiterUid,
  });

  await Promise.all([
    db.collection('email_logs').add({
      candidateId,
      templateType: 'offer',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: recruiterUid,
      success: true,
    }),
    db.collection('candidates').doc(candidateId).update({
      status: 'offer_sent',
      offerEmailSent: true,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
}

export const sendOfferEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId es requerido');

    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    await sendOfferEmailCore(candidateId, candidate as Record<string, unknown>, request.auth.uid);

    return { success: true };
  }
);
