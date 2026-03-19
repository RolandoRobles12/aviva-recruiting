import { defineString } from 'firebase-functions/params';

const HUBSPOT_API_KEY = defineString('HUBSPOT_API_KEY');

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/**
 * Create a HubSpot portal user for a new employee.
 * If the user already exists (409), it's treated as success.
 */
export async function createHubSpotUser(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
}): Promise<{ userId: string }> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) {
    throw new Error('HubSpot API key not configured.');
  }

  const resp = await fetch(`${HUBSPOT_API_BASE}/settings/v3/users/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.corporateEmail,
      firstName: params.firstName,
      lastName: params.lastName,
      sendWelcomeEmail: true,
      primaryTeamId: '11727817',
    }),
  });

  // Already exists — treat as success
  if (resp.status === 409) {
    return { userId: 'existing' };
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot createUser failed: HTTP ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { id: string };
  return { userId: data.id };
}
