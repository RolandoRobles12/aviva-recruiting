import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { checkTicketResolved } from './jiraService';
import { createHubSpotContact } from './hubspotService';
import { inviteSlackDual } from './slackService';
import { sendEmail } from '../email/gmailClient';
import { inductionTemplate } from '../email/templates';

/**
 * Scheduled function that runs every 15 minutes to check if Jira tickets
 * for corporate email creation have been resolved.
 *
 * When a ticket is resolved and contains a corporate email:
 * 1. Updates the candidate record with the corporate email
 * 2. Creates a HubSpot contact
 * 3. Invites the user to Slack
 * 4. Updates candidate status to 'email_ready'
 */
export const checkEmailTickets = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    // Find all candidates waiting for corporate email
    const snapshot = await db
      .collection('candidates')
      .where('status', '==', 'email_pending')
      .where('jiraTicketKey', '!=', null)
      .get();

    if (snapshot.empty) {
      console.info('[checkEmailTickets] No pending email tickets');
      return;
    }

    console.info(`[checkEmailTickets] Checking ${snapshot.size} pending ticket(s)`);

    const results = await Promise.allSettled(
      snapshot.docs.map((doc) => processTicket(doc))
    );

    const resolved = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const errors = results.filter((r) => r.status === 'rejected').length;
    console.info(`[checkEmailTickets] Done: ${resolved} resolved, ${errors} errors, ${snapshot.size - resolved - errors} still pending`);
  }
);

async function processTicket(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<boolean> {
  const candidate = doc.data();
  const ticketKey = candidate.jiraTicketKey as string;

  if (!ticketKey) return false;

  const { resolved, corporateEmail } = await checkTicketResolved(ticketKey);

  if (!resolved) return false;

  if (!corporateEmail) {
    console.warn(`[checkEmailTickets] Ticket ${ticketKey} resolved but no corporate email found`);
    return false;
  }

  console.info(`[checkEmailTickets] Ticket ${ticketKey} resolved with email: ${corporateEmail}`);

  // Provision accounts in parallel
  const [hubspotResult, slackResult] = await Promise.allSettled([
    createHubSpotContact({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      personalEmail: candidate.email as string,
    }),
    inviteSlackDual({
      corporateEmail,
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
    }),
  ]);

  if (hubspotResult.status === 'rejected') {
    console.error(`[checkEmailTickets] HubSpot creation failed for ${doc.id}:`, hubspotResult.reason);
  }
  if (slackResult.status === 'rejected') {
    console.error(`[checkEmailTickets] Slack invitation failed for ${doc.id}:`, slackResult.reason);
  }

  // Extract Slack results for both workspaces
  const slackDual = slackResult.status === 'fulfilled' ? slackResult.value : null;
  const slackPrimaryOk = slackDual?.primary.ok ?? false;
  const slackGuestOk = slackDual?.guest.ok ?? false;

  if (slackDual) {
    if (!slackPrimaryOk) {
      console.warn(`[checkEmailTickets] Slack primary workspace invite failed for ${doc.id}: ${slackDual.primary.error}`);
    }
    if (!slackGuestOk) {
      console.warn(`[checkEmailTickets] Slack guest workspace invite failed for ${doc.id}: ${slackDual.guest.error}`);
    }
    if (slackPrimaryOk && slackGuestOk) {
      console.info(`[checkEmailTickets] Slack: both workspaces invited for ${doc.id}`);
    }
  }

  // Update candidate regardless of HubSpot/Slack success
  await doc.ref.update({
    corporateEmail,
    status: 'email_ready',
    hubspotCreated: hubspotResult.status === 'fulfilled',
    slackInvited: slackPrimaryOk,
    slackGuestInvited: slackGuestOk,
    emailProvisionedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Send notification email to the candidate about their new accounts
  try {
    const { subject, html } = inductionTemplate({
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      corporateEmail,
    });
    const createdBy = candidate.createdBy as string | undefined;
    await sendEmail({
      to: candidate.email as string,
      subject,
      html,
      recruiterUid: createdBy && createdBy !== 'viterbit_webhook' ? createdBy : undefined,
    });
    await db.collection('email_logs').add({
      candidateId: doc.id,
      templateType: 'induction',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: 'check_email_tickets',
      success: true,
    });
  } catch (err) {
    console.error(`[checkEmailTickets] Failed to send induction email for ${doc.id}:`, err);
  }

  return true;
}
