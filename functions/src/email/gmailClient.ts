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
  const tokenSnap = await db.doc(`users/${recruiterUid}/private/gmailTokens`).get();
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
    await db.doc(`users/${recruiterUid}/private/gmailTokens`).update(update);
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
 * Fallback: find any recruiter who has connected their Gmail via OAuth.
 * Used for automated emails (webhooks, signOffer) where there's no specific recruiter context.
 */
async function findAnyConnectedRecruiterUid(): Promise<string | null> {
  try {
    const usersSnap = await db.collection('users').limit(20).get();
    for (const userDoc of usersSnap.docs) {
      const tokenSnap = await db.doc(`users/${userDoc.id}/private/gmailTokens`).get();
      if (tokenSnap.exists) return userDoc.id;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Send an email via Gmail API.
 *
 * Strategy:
 * 1. If recruiterUid is provided and has OAuth tokens → use their tokens (email from their inbox)
 * 2. If no recruiterUid, find any recruiter with OAuth tokens → use theirs
 * 3. If senderEmail is provided and SA credentials exist → use SA impersonation (legacy)
 * 4. If GMAIL_DEFAULT_SENDER is configured → use SA with default sender (legacy)
 * 5. Otherwise → throw error
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  senderEmail?: string;
  recruiterUid?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<void> {
  let gmail: ReturnType<typeof google.gmail> | null = null;
  let sender: string | undefined = options.senderEmail;

  // Strategy 1: OAuth tokens for the specific recruiter
  if (options.recruiterUid) {
    gmail = await getOAuthGmailClient(options.recruiterUid);
    if (gmail) {
      const recruiterSnap = await db.collection('users').doc(options.recruiterUid).get();
      if (recruiterSnap.exists) {
        sender = (recruiterSnap.data() as { email?: string }).email ?? sender;
      }
    }
  }

  // Strategy 2: No specific recruiter — fall back to any connected recruiter
  if (!gmail) {
    const fallbackUid = await findAnyConnectedRecruiterUid();
    if (fallbackUid) {
      gmail = await getOAuthGmailClient(fallbackUid);
      if (gmail) {
        const recruiterSnap = await db.collection('users').doc(fallbackUid).get();
        if (recruiterSnap.exists) {
          sender = sender || (recruiterSnap.data() as { email?: string }).email;
        }
      }
    }
  }

  // Strategy 3/4: Service Account fallback (legacy)
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

  // Build RFC 2822 email (plain HTML or multipart/mixed with attachments)
  let rawMessage: string;

  if (options.attachments && options.attachments.length > 0) {
    const boundary = `----=_Part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const parts: string[] = [
      `From: ${sender}`,
      `To: ${options.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(options.subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(options.html, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
    ];
    for (const att of options.attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        att.content.toString('base64').replace(/.{76}/g, '$&\r\n'),
      );
    }
    parts.push(`--${boundary}--`);
    rawMessage = parts.join('\r\n');
  } else {
    const messageParts = [
      `From: ${sender}`,
      `To: ${options.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(options.subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      options.html,
    ];
    rawMessage = messageParts.join('\r\n');
  }

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
