import { Resend } from 'resend';
import { defineString } from 'firebase-functions/params';

const RESEND_API_KEY = defineString('RESEND_API_KEY');
const EMAIL_FROM = defineString('EMAIL_FROM');

let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (!resendInstance) {
    resendInstance = new Resend(RESEND_API_KEY.value());
  }
  return resendInstance;
}

export async function sendEmail(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: options.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });

  if (error) {
    throw new Error(`Error sending email: ${error.message}`);
  }
}

export function getFromAddress(): string {
  return EMAIL_FROM.value();
}
