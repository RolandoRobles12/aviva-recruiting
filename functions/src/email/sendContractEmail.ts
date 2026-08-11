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
import { getLogoUrl } from '../utils/branding';
import { evaluateContractDataReview } from '../contract/contractReview';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });

/**
 * Builds and sends the contract email for a candidate, logs it, and marks the
 * candidate as contract_sent. Shared by the sendContractEmail callable and
 * reissueContract. Throws HttpsError when the candidate lacks a contract
 * token or the contract data hasn't been confirmed yet.
 */
export async function sendContractEmailCore(
  candidateId: string,
  candidate: Record<string, unknown>,
  recruiterUid: string,
): Promise<void> {
  const contractToken = candidate.contractToken as string | undefined;
  if (!contractToken) throw new HttpsError('failed-precondition', 'El candidato no tiene contrato generado.');

  const missingSalary = !(candidate.viterbitSalary as string | undefined)?.trim();
  const missingDate = !(candidate.viterbitStartDate as string | undefined)?.trim();
  if (missingSalary || missingDate) {
    const missing = [missingSalary && 'salario', missingDate && 'fecha de inicio'].filter(Boolean).join(' y ');
    throw new HttpsError('failed-precondition', `Faltan datos de Viterbit: ${missing}. Refresca los datos antes de enviar.`);
  }

  // Block sending until OCR-sourced contract fields (CURP, RFC, domicilio,
  // CLABE, banco, NSS) have been confirmed — either the OCR was confident
  // enough, or a recruiter explicitly saved them in "Datos para el contrato".
  const review = evaluateContractDataReview(candidate);
  if (review.required) {
    throw new HttpsError(
      'failed-precondition',
      `Revisa y confirma los datos del contrato antes de enviarlo: ${review.reasons.join(' ')}`,
    );
  }

  const appUrl = APP_URL.value();
  const contractUrl = `${appUrl}/contract/${contractToken}`;

  const expiresAt = (candidate.contractExpiresAt as FirebaseFirestore.Timestamp | undefined)?.toDate?.()
    ?? (candidate.contractExpiresAt instanceof Date ? candidate.contractExpiresAt : undefined);
  const contractExpiresAt = expiresAt
    ? format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
    : '—';

  const senderEmail = await getRecruiterEmail(recruiterUid);

  // Read custom email subject from Firestore settings if configured
  let customSubject: string | undefined;
  try {
    const settingsSnap = await db.doc('settings/emailTemplates').get();
    if (settingsSnap.exists) {
      const data = settingsSnap.data() as Record<string, { subject?: string; bodyText?: string }>;
      if (data?.contract?.subject) {
        customSubject = data.contract.subject.replace('{position}', (candidate.position as string) || '');
      }
    }
  } catch {
    // Fall back to default template subject
  }

  const logoUrl = await getLogoUrl();

  const { subject: defaultSubject, html } = contractTemplate({
    firstName: (candidate.firstName as string) || '',
    lastName:  (candidate.lastName  as string) || '',
    position:  (candidate.position  as string) || '',
    contractUrl,
    contractExpiresAt,
    logoUrl,
  });
  const subject = customSubject ?? defaultSubject;

  await sendEmail({ to: candidate.email as string, subject, html, senderEmail, recruiterUid });

  await Promise.all([
    db.collection('email_logs').add({
      candidateId,
      templateType: 'contract',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: recruiterUid,
      success: true,
    }),
    db.collection('candidates').doc(candidateId).update({
      status: 'contract_sent',
      contractReviewRequired: false,
      contractReviewReasons: [],
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
}

export const sendContractEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string };
    if (!candidateId) throw new HttpsError('invalid-argument', 'candidateId es requerido');

    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    await sendContractEmailCore(candidateId, candidate as Record<string, unknown>, request.auth.uid);

    return { success: true };
  }
);
