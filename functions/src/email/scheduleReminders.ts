import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from './gmailClient';
import { reminderTemplate, offerTemplate } from './templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { DOCUMENT_TYPES_REQUIRED, DOCUMENT_LABELS } from '../utils/documentTypes';
import { getLogoUrl } from '../utils/branding';

// Runs every day at 9:00 AM Mexico City time
export const scheduleReminders = functions
  .region('us-central1')
  .pubsub.schedule('0 9 * * *')
  .timeZone('America/Mexico_City')
  .onRun(async () => {
    // Read reminder settings from Firestore (configured via Settings UI)
    let MAX_REMINDERS = 3;
    let REMINDER_INTERVAL_HOURS = 48;
    let remindersEnabled = true;
    try {
      const settingsSnap = await db.doc('settings/reminders').get();
      if (settingsSnap.exists) {
        const s = settingsSnap.data() as {
          enabled?: boolean;
          maxReminders?: number;
          intervalHours?: number;
        };
        if (typeof s.enabled === 'boolean') remindersEnabled = s.enabled;
        if (typeof s.maxReminders === 'number' && s.maxReminders > 0) MAX_REMINDERS = s.maxReminders;
        if (typeof s.intervalHours === 'number' && s.intervalHours > 0) REMINDER_INTERVAL_HOURS = s.intervalHours;
      }
    } catch {
      // Use defaults if settings read fails
    }

    if (!remindersEnabled) {
      console.log('Automatic reminders are disabled via Settings.');
      return null;
    }

    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_HOURS * 60 * 60 * 1000);

    // Fetch all candidates still waiting for documents
    const snap = await db
      .collection('candidates')
      .where('status', 'in', ['invited', 'in_progress'])
      .get();

    if (snap.empty) return null;

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

      // Build candidate-specific required types
      const formAnswers = candidate.formAnswers as Record<string, unknown> | undefined;
      const requiredTypes = [...DOCUMENT_TYPES_REQUIRED];
      if (formAnswers?.tieneInfonavit) requiredTypes.push('aviso_retencion');
      if (formAnswers?.tieneFonacot) requiredTypes.push('estado_cuenta_fonacot');

      // Find which documents are still pending or invalid
      const docs = (candidate.documents as Record<string, { status: string }>) ?? {};
      const missingDocs = requiredTypes
        .filter((t) => !docs[t] || docs[t].status === 'pending' || docs[t].status === 'invalid')
        .map((t) => DOCUMENT_LABELS[t] ?? t);

      if (missingDocs.length === 0) {
        skipped++;
        continue;
      }

      const formUrl = `${appUrl}/form/${candidate.formToken as string}`;

      // Read custom reminder body from Firestore settings
      let customBodyText: string | undefined;
      try {
        const emailSettingsSnap = await db.doc('settings/emailTemplates').get();
        if (emailSettingsSnap.exists) {
          const emailData = emailSettingsSnap.data() as Record<string, { bodyText?: string }>;
          if (emailData?.reminder?.bodyText) {
            customBodyText = emailData.reminder.bodyText
              .replace('{firstName}', candidate.firstName as string)
              .replace('{position}', candidate.position as string);
          }
        }
      } catch {
        // Fall back to default
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

      try {
        // Send from the recruiter who created the candidate
        const createdBy = candidate.createdBy as string;
        const senderEmail = await getRecruiterEmail(createdBy);
        await sendEmail({
          to: candidate.email as string,
          subject,
          html,
          senderEmail,
          recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
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

    console.log(`Document reminder scheduler done — sent: ${sent}, skipped: ${skipped}`);

    // ── Offer letter reminders (offer_sent candidates who haven't signed) ─────
    const offerSnap = await db
      .collection('candidates')
      .where('status', '==', 'offer_sent')
      .get();

    let offerSent = 0;

    for (const docSnap of offerSnap.docs) {
      const candidate = { id: docSnap.id, ...docSnap.data() } as Record<string, unknown> & { id: string };

      const reminderCount = (candidate.reminderCount as number) ?? 0;
      if (reminderCount >= MAX_REMINDERS) continue;

      const lastReminderSentAt = candidate.lastReminderSentAt as Timestamp | undefined;
      if (lastReminderSentAt) {
        const lastDate = lastReminderSentAt.toDate?.() ?? new Date(0);
        if (lastDate > cutoff) continue;
      }

      const offerToken = candidate.offerToken as string | undefined;
      if (!offerToken) continue;

      // Skip expired offers
      const offerExpiresAt = (candidate.offerExpiresAt as Timestamp | undefined)?.toDate?.();
      if (offerExpiresAt && new Date() > offerExpiresAt) continue;

      const offerUrl = `${appUrl}/offer/${offerToken}`;
      const offerExpiresAtStr = offerExpiresAt
        ? format(offerExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es })
        : '—';

      const logoUrlOffer = await getLogoUrl();
      const { subject, html } = offerTemplate({
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        offerUrl,
        offerExpiresAt: offerExpiresAtStr,
        logoUrl: logoUrlOffer,
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

        await docSnap.ref.update({
          lastReminderSentAt: FieldValue.serverTimestamp(),
          reminderCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection('email_logs').add({
          candidateId: candidate.id,
          templateType: 'offer_reminder',
          sentTo: candidate.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'scheduler',
          success: true,
        });

        offerSent++;
      } catch (err) {
        console.error(`Offer reminder failed for candidate ${candidate.id}:`, err);
        await db.collection('email_logs').add({
          candidateId: candidate.id,
          templateType: 'offer_reminder',
          sentTo: candidate.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'scheduler',
          success: false,
          error: (err as Error).message,
        });
      }
    }

    console.log(`Offer reminder scheduler done — sent: ${offerSent}`);
    return null;
  });
