import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import { db } from '../utils/admin';

// OAuth 2.0 client credentials (same ones used for the consent flow)
const GMAIL_OAUTH_CLIENT_ID = defineString('GMAIL_OAUTH_CLIENT_ID');
const GMAIL_OAUTH_CLIENT_SECRET = defineString('GMAIL_OAUTH_CLIENT_SECRET');

// Legacy Service Account credentials — used as fallback when a recruiter
// has not connected their Gmail via OAuth yet.
const GMAIL_SA_CLIENT_EMAIL = defineString('GMAIL_SA_CLIENT_EMAIL', { default: '' });
const GMAIL_SA_PRIVATE_KEY = defineString('GMAIL_SA_PRIVATE_KEY', { default: '' });
const GMAIL_DEFAULT_SENDER = defineString('GMAIL_DEFAULT_SENDER', { default: '' });

/**
 * Get an authenticated Gmail client using the recruiter's OAuth tokens.
 * Returns null if the recruiter has no stored tokens.
 */
async function getOAuthGmailClient(recruiterUid: string) {
  const tokenSnap = await db.doc(`recruiters/${recruiterUid}/private/gmailTokens`).get();
  if (!tokenSnap.exists) return null;

  const tokens = tokenSnap.data() as {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
  };

  const oauth2Client = new google.auth.OAuth2(
    GMAIL_OAUTH_CLIENT_ID.value(),
    GMAIL_OAUTH_CLIENT_SECRET.value()
  );

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });

  // Listen for token refresh events to persist new access tokens
  oauth2Client.on('tokens', async (newTokens) => {
    const update: Record<string, unknown> = {
      access_token: newTokens.access_token,
      expiry_date: newTokens.expiry_date,
      updatedAt: new Date().toISOString(),
    };
    if (newTokens.refresh_token) {
      update.refresh_token = newTokens.refresh_token;
    }
    await db.doc(`recruiters/${recruiterUid}/private/gmailTokens`).update(update);
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Fallback: get a Gmail client using the Service Account with Domain-Wide Delegation.
 * Returns null if SA credentials are not configured.
 */
function getServiceAccountGmailClient(senderEmail: string) {
  const saEmail = GMAIL_SA_CLIENT_EMAIL.value();
  const saKey = GMAIL_SA_PRIVATE_KEY.value();
  if (!saEmail || !saKey) return null;

  const auth = new google.auth.JWT({
    email: saEmail,
    key: saKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: senderEmail,
  });

  return google.gmail({ version: 'v1', auth });
}

/**
 * Send an email via Gmail API.
 *
 * Strategy:
 * 1. If recruiterUid is provided and has OAuth tokens → use their tokens (email from their inbox)
 * 2. If senderEmail is provided and SA credentials exist → use SA impersonation (legacy)
 * 3. If GMAIL_DEFAULT_SENDER is configured → use SA with default sender (legacy)
 * 4. Otherwise → throw error
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  senderEmail?: string;
  recruiterUid?: string;
}): Promise<void> {
  let gmail: ReturnType<typeof google.gmail> | null = null;
  let sender: string | undefined = options.senderEmail;

  // Strategy 1: OAuth tokens for the recruiter
  if (options.recruiterUid) {
    gmail = await getOAuthGmailClient(options.recruiterUid);
    if (gmail) {
      // Fetch recruiter email for the From header
      const recruiterSnap = await db.collection('recruiters').doc(options.recruiterUid).get();
      if (recruiterSnap.exists) {
        sender = (recruiterSnap.data() as { email?: string }).email ?? sender;
      }
    }
  }

  // Strategy 2/3: Service Account fallback
  if (!gmail) {
    sender = sender || GMAIL_DEFAULT_SENDER.value();
    if (!sender) {
      throw new Error('No Gmail credentials available. Recruiter must connect Gmail via OAuth.');
    }
    gmail = getServiceAccountGmailClient(sender);
    if (!gmail) {
      throw new Error('No Gmail credentials available. Configure OAuth or Service Account.');
    }
  }

  // Build RFC 2822 email
  const messageParts = [
    `From: ${sender}`,
    `To: ${options.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(options.subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    options.html,
  ];
  const rawMessage = messageParts.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
}

export function getDefaultSender(): string {
  return GMAIL_DEFAULT_SENDER.value();
}
