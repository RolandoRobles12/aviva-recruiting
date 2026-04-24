import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { sendEmail } from './gmailClient';
import { reminderTemplate } from './templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { DOCUMENT_TYPES_REQUIRED, DOCUMENT_LABELS } from '../utils/documentTypes';
import { getLogoUrl } from '../utils/branding';

export const sendReminderEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string; customMessage?: string };
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const recruiterUid = request.auth.uid;
    const senderEmail = await getRecruiterEmail(recruiterUid);

    const docs = candidate.documents as Record<string, { status: string }>;
    // Build candidate-specific required types
    const formAnswers = candidate.formAnswers as Record<string, unknown> | undefined;
    const requiredTypes = [...DOCUMENT_TYPES_REQUIRED];
    if (formAnswers?.tieneInfonavit) requiredTypes.push('aviso_retencion');
    if (formAnswers?.tieneFonacot) requiredTypes.push('estado_cuenta_fonacot');

    const missingDocs = requiredTypes
      .filter((t) => !docs[t] || docs[t].status === 'pending' || docs[t].status === 'invalid')
      .map((t) => DOCUMENT_LABELS[t] ?? t);

    if (missingDocs.length === 0) {
      return { success: true, message: 'No hay documentos pendientes' };
    }

    const appUrl = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';
    const formUrl = `${appUrl}/form/${candidate.formToken}`;

    // Read custom email body from Firestore settings if configured
    let customBodyText: string | undefined;
    try {
      const settingsSnap = await db.doc('settings/emailTemplates').get();
      if (settingsSnap.exists) {
        const data = settingsSnap.data() as Record<string, { bodyText?: string }>;
        if (data?.reminder?.bodyText) {
          customBodyText = data.reminder.bodyText
            .replace('{firstName}', candidate.firstName as string)
            .replace('{position}', candidate.position as string);
        }
      }
    } catch {
      // Fall back to default template text
    }

    const logoUrl = await getLogoUrl();

    const { subject, html } = reminderTemplate(
      {
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        formUrl,
        formExpiresAt: '',
      },
      missingDocs,
      customBodyText,
      logoUrl,
    );

    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      senderEmail,
      recruiterUid,
    });

    // Update reminder count and timestamp
    await db.collection('candidates').doc(candidateId).update({
      lastReminderSentAt: FieldValue.serverTimestamp(),
      reminderCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log
    await db.collection('email_logs').add({
      candidateId,
      templateType: 'reminder',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: request.auth.uid,
      success: true,
    });

    return { success: true };
  }
);
