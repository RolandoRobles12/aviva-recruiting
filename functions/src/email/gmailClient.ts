import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';

// Service account credentials (JSON key file path or inline values)
const GMAIL_SA_CLIENT_EMAIL = defineString('GMAIL_SA_CLIENT_EMAIL');
const GMAIL_SA_PRIVATE_KEY = defineString('GMAIL_SA_PRIVATE_KEY');
const GMAIL_DEFAULT_SENDER = defineString('GMAIL_DEFAULT_SENDER');

/**
 * Send an email via Gmail API using a Service Account with Domain-Wide Delegation.
 *
 * The service account impersonates `senderEmail` so the email is sent from
 * that recruiter's actual Gmail inbox (appears in their Sent folder).
 *
 * If no senderEmail is provided, falls back to GMAIL_DEFAULT_SENDER.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  senderEmail?: string;
}): Promise<void> {
  const sender = options.senderEmail || GMAIL_DEFAULT_SENDER.value();

  const auth = new google.auth.JWT({
    email: GMAIL_SA_CLIENT_EMAIL.value(),
    key: GMAIL_SA_PRIVATE_KEY.value().replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: sender, // impersonate this user
  });

  const gmail = google.gmail({ version: 'v1', auth });

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

export function getFromAddress(): string {
  return GMAIL_DEFAULT_SENDER.value();
}
