// Every credential the functions use, declared once and stored in Google Secret
// Manager.
//
// Several of these used to be `defineString` params: plain environment values
// written in functions/.env, visible to anyone who can read the function's
// configuration in the Cloud console. Secrets are encrypted at rest, access is
// audited, and they are only exposed to the functions that declare them.
//
// Declaring: every function gets ALL_SECRETS — v2 functions through
// setGlobalOptions (src/globalOptions.ts, imported first by index.ts) and the
// four v1 functions through .runWith(). A function that sets its own `secrets`
// option *replaces* the global list instead of adding to it, so no function
// declares secrets on its own; tests/secrets.test.ts checks that.
//
// Creating them (once, before the first deploy that includes this file):
//   firebase functions:secrets:set NAME
// and remove NAME from functions/.env — Firebase refuses to deploy a name that
// is both a secret and a plain param. For the emulator, put the values in
// functions/.secret.local (git-ignored). See docs/secretos.md.

import { defineSecret } from 'firebase-functions/params';

export const DRIVE_SERVICE_ACCOUNT = defineSecret('DRIVE_SERVICE_ACCOUNT');
export const CHECKINS_SERVICE_ACCOUNT = defineSecret('CHECKINS_SERVICE_ACCOUNT');
export const SLACK_CHAT_BOT_TOKEN = defineSecret('SLACK_CHAT_BOT_TOKEN');

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const VITERBIT_API_KEY = defineSecret('VITERBIT_API_KEY');
export const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');
export const JIRA_API_TOKEN = defineSecret('JIRA_API_TOKEN');
export const HUBSPOT_API_KEY = defineSecret('HUBSPOT_API_KEY');
export const GMAIL_OAUTH_CLIENT_SECRET = defineSecret('GMAIL_OAUTH_CLIENT_SECRET');

/**
 * Optional: only needed if that integration is used. A secret cannot be empty,
 * so when it is not used it is created with the value "-", which
 * optionalSecret() reads as "not configured".
 */
export const SLACK_GUEST_BOT_TOKEN = defineSecret('SLACK_GUEST_BOT_TOKEN');
export const GMAIL_SA_PRIVATE_KEY = defineSecret('GMAIL_SA_PRIVATE_KEY');

export const ALL_SECRETS = [
  DRIVE_SERVICE_ACCOUNT,
  CHECKINS_SERVICE_ACCOUNT,
  SLACK_CHAT_BOT_TOKEN,
  ANTHROPIC_API_KEY,
  VITERBIT_API_KEY,
  SLACK_BOT_TOKEN,
  JIRA_API_TOKEN,
  HUBSPOT_API_KEY,
  GMAIL_OAUTH_CLIENT_SECRET,
  SLACK_GUEST_BOT_TOKEN,
  GMAIL_SA_PRIVATE_KEY,
];

/** Value of an optional secret; '' when it holds the "-" placeholder. */
export function optionalSecret(secret: { value(): string }): string {
  const value = (secret.value() ?? '').trim();
  return value === '-' ? '' : value;
}
