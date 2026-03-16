import { google } from 'googleapis';
import * as nodemailer from 'nodemailer';
import { defineString } from 'firebase-functions/params';

// Firebase config parameters — set with: firebase functions:config:set
const GMAIL_CLIENT_ID = defineString('GMAIL_CLIENT_ID');
const GMAIL_CLIENT_SECRET = defineString('GMAIL_CLIENT_SECRET');
const GMAIL_REFRESH_TOKEN = defineString('GMAIL_REFRESH_TOKEN');
const GMAIL_USER = defineString('GMAIL_USER');

export async function createGmailTransport() {
  const oAuth2Client = new google.auth.OAuth2(
    GMAIL_CLIENT_ID.value(),
    GMAIL_CLIENT_SECRET.value(),
    'https://developers.google.com/oauthplayground'
  );

  oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN.value() });

  const accessToken = await oAuth2Client.getAccessToken();

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: GMAIL_USER.value(),
      clientId: GMAIL_CLIENT_ID.value(),
      clientSecret: GMAIL_CLIENT_SECRET.value(),
      refreshToken: GMAIL_REFRESH_TOKEN.value(),
      accessToken: accessToken.token ?? '',
    },
  });
}

export function getFromAddress(): string {
  return `Aviva Recruiting <${GMAIL_USER.value()}>`;
}
