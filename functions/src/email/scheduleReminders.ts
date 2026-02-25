import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { createGmailTransport, getFromAddress } from './gmailClient';
import { reminderTemplate } from './templates';

const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];

const DOCUMENT_LABELS: Record<string, string> = {
  ine: 'INE / Identificación oficial',
  curp: 'CURP',
  rfc: 'RFC con homoclave',
  comprobante_domicilio: 'Comprobante de domicilio',
  comprobante_estudios: 'Comprobante de estudios',
};

// Maximum number of automated reminders per candidate
const MAX_REMINDERS = 3;
// Minimum hours between reminders
const REMINDER_INTERVAL_HOURS = 48;

// Runs every day at 9:00 AM Mexico City time
export const scheduleReminders = functions
  .region('us-central1')
  .pubsub.schedule('0 9 * * *')
  .timeZone('America/Mexico_City')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_HOURS * 60 * 60 * 1000);

    // Fetch all candidates still waiting for documents
    const snap = await db
      .collection('candidates')
      .where('status', 'in', ['invited', 'in_progress'])
      .get();

    if (snap.empty) return null;

    const transport = await createGmailTransport();
    const appUrl = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';

    let sent = 0;
    let skipped = 0;

    for (const docSnap of snap.docs) {
      const candidate = { id: docSnap.id, ...docSnap.data() } as Record<string, unknown> & { id: string };

      // Skip if max reminders already reached
      const reminderCount = (candidate.reminderCount as number) ?? 0;
      if (reminderCount >= MAX_REMINDERS) {
        skipped++;
        continue;
      }

      // Skip if a reminder was sent recently
      const lastReminderSentAt = candidate.lastReminderSentAt as Timestamp | undefined;
      if (lastReminderSentAt) {
        const lastDate = lastReminderSentAt.toDate?.() ?? new Date(0);
        if (lastDate > cutoff) {
          skipped++;
          continue;
        }
      }

      // Find which documents are still pending or invalid
      const docs = (candidate.documents as Record<string, { status: string }>) ?? {};
      const missingDocs = DOCUMENT_TYPES
        .filter((t) => !docs[t] || docs[t].status === 'pending' || docs[t].status === 'invalid')
        .map((t) => DOCUMENT_LABELS[t]);

      if (missingDocs.length === 0) {
        skipped++;
        continue;
      }

      const formUrl = `${appUrl}/form/${candidate.formToken as string}`;

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

      try {
        await transport.sendMail({
          from: getFromAddress(),
          to: candidate.email as string,
          subject,
          html,
        });

        await docSnap.ref.update({
          lastReminderSentAt: FieldValue.serverTimestamp(),
          reminderCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection('email_logs').add({
          candidateId: candidate.id,
          templateType: 'reminder',
          sentTo: candidate.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'scheduler',
          success: true,
        });

        sent++;
      } catch (err) {
        console.error(`Reminder failed for candidate ${candidate.id}:`, err);

        await db.collection('email_logs').add({
          candidateId: candidate.id,
          templateType: 'reminder',
          sentTo: candidate.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'scheduler',
          success: false,
          error: (err as Error).message,
        });
      }
    }

    console.log(`Reminder scheduler done — sent: ${sent}, skipped: ${skipped}`);
    return null;
  });
