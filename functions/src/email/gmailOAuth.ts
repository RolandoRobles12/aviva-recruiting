import { onRequest } from 'firebase-functions/v2/https';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { google } from 'googleapis';
import { db, auth } from '../utils/admin';

const GMAIL_OAUTH_CLIENT_ID = defineString('GMAIL_OAUTH_CLIENT_ID');
const GMAIL_OAUTH_CLIENT_SECRET = defineString('GMAIL_OAUTH_CLIENT_SECRET');
const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

function getOAuth2Client(redirectUri: string) {
  return new google.auth.OAuth2(
    GMAIL_OAUTH_CLIENT_ID.value(),
    GMAIL_OAUTH_CLIENT_SECRET.value(),
    redirectUri
  );
}

/**
 * Callable function: returns the Google OAuth consent URL.
 * The recruiter clicks this link to authorize Gmail access.
 */
export const getGmailAuthUrl = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const redirectUri = `${APP_URL.value()}/gmail/callback`;
    const oauth2Client = getOAuth2Client(redirectUri);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // always show consent to get refresh_token
      state: request.auth.uid, // pass UID so callback knows who authorized
      login_hint: request.auth.token.email,
    });

    return { authUrl };
  }
);

/**
 * HTTP endpoint: handles the OAuth callback from Google.
 * Exchanges the authorization code for tokens and stores them in Firestore.
 */
export const gmailOAuthCallback = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    const { code, state: uid, error } = req.query;

    const appUrl = APP_URL.value();

    if (error) {
      res.redirect(`${appUrl}/settings?gmail=error&reason=${error as string}`);
      return;
    }

    if (!code || !uid) {
      res.redirect(`${appUrl}/settings?gmail=error&reason=missing_params`);
      return;
    }

    try {
      // Verify the UID corresponds to a real recruiter
      await auth.getUser(uid as string);
      const recruiterSnap = await db.collection('recruiters').doc(uid as string).get();
      if (!recruiterSnap.exists) {
        res.redirect(`${appUrl}/settings?gmail=error&reason=not_recruiter`);
        return;
      }

      const redirectUri = `${appUrl}/gmail/callback`;
      const oauth2Client = getOAuth2Client(redirectUri);
      const { tokens } = await oauth2Client.getToken(code as string);

      if (!tokens.refresh_token) {
        res.redirect(`${appUrl}/settings?gmail=error&reason=no_refresh_token`);
        return;
      }

      // Store tokens in a private subcollection (not readable by client)
      await db.doc(`recruiters/${uid}/private/gmailTokens`).set({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
        scope: tokens.scope,
        updatedAt: new Date().toISOString(),
      });

      // Mark the recruiter profile as gmail-connected
      await db.collection('recruiters').doc(uid as string).update({
        gmailConnected: true,
      });

      res.redirect(`${appUrl}/settings?gmail=success`);
    } catch (err) {
      console.error('Gmail OAuth callback error:', err);
      res.redirect(`${appUrl}/settings?gmail=error&reason=token_exchange_failed`);
    }
  }
);

/**
 * Callable function: disconnects Gmail for the current recruiter.
 * Revokes the token and removes stored credentials.
 */
export const disconnectGmail = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const uid = request.auth.uid;

    try {
      // Read stored tokens
      const tokenSnap = await db.doc(`recruiters/${uid}/private/gmailTokens`).get();
      if (tokenSnap.exists) {
        const tokens = tokenSnap.data() as { access_token?: string; refresh_token?: string };

        // Try to revoke the token at Google
        if (tokens.refresh_token) {
          const oauth2Client = getOAuth2Client('');
          oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
          try {
            await oauth2Client.revokeToken(tokens.refresh_token);
          } catch {
            // Token may already be invalid — continue cleanup
          }
        }

        // Delete stored tokens
        await db.doc(`recruiters/${uid}/private/gmailTokens`).delete();
      }

      // Update recruiter profile
      await db.collection('recruiters').doc(uid).update({
        gmailConnected: false,
      });

      return { success: true };
    } catch (err) {
      console.error('Gmail disconnect error:', err);
      throw new HttpsError('internal', 'Error al desconectar Gmail');
    }
  }
);
