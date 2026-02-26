import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { getCandidateById } from '../utils/candidates';
import { createGmailTransport, getFromAddress } from './gmailClient';
import { reminderTemplate } from './templates';

const DOCUMENT_LABELS: Record<string, string> = {
  ine: 'INE / Identificación oficial',
  curp: 'CURP',
  rfc: 'RFC con homoclave',
  comprobante_domicilio: 'Comprobante de domicilio',
  comprobante_estudios: 'Comprobante de estudios',
};

const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];

export const sendReminderEmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const { candidateId } = request.data as { candidateId: string; customMessage?: string };
    const candidate = await getCandidateById(candidateId);
    if (!candidate) throw new HttpsError('not-found', 'Candidato no encontrado');

    const docs = candidate.documents as Record<string, { status: string }>;
    const missingDocs = DOCUMENT_TYPES
      .filter((t) => !docs[t] || docs[t].status === 'pending' || docs[t].status === 'invalid')
      .map((t) => DOCUMENT_LABELS[t]);

    if (missingDocs.length === 0) {
      return { success: true, message: 'No hay documentos pendientes' };
    }

    const appUrl = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';
    const formUrl = `${appUrl}/form/${candidate.formToken}`;

    const { subject, html } = reminderTemplate(
      {
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        formUrl,
        formExpiresAt: '',
      },
      missingDocs
    );

    const transport = await createGmailTransport();
    await transport.sendMail({
      from: getFromAddress(),
      to: candidate.email as string,
      subject,
      html,
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
