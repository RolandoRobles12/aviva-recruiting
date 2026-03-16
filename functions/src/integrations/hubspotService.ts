import { defineString } from 'firebase-functions/params';

const HUBSPOT_API_KEY = defineString('HUBSPOT_API_KEY');

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/**
 * Create a HubSpot contact for a new employee using their corporate email.
 * If the contact already exists, it updates the existing record.
 */
export async function createHubSpotContact(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
  position: string;
  personalEmail: string;
}): Promise<{ contactId: string }> {
  const apiKey = HUBSPOT_API_KEY.value();

  const resp = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        email: params.corporateEmail,
        firstname: params.firstName,
        lastname: params.lastName,
        jobtitle: params.position,
        hs_additional_emails: params.personalEmail,
      },
    }),
  });

  if (resp.status === 409) {
    // Contact already exists — try to find and update
    const existing = await findHubSpotContactByEmail(params.corporateEmail, apiKey);
    if (existing) {
      return { contactId: existing };
    }
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot createContact failed: HTTP ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { id: string };
  return { contactId: data.id };
}

async function findHubSpotContactByEmail(email: string, apiKey: string): Promise<string | null> {
  const resp = await fetch(
    `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: 'EQ',
            value: email,
          }],
        }],
        limit: 1,
      }),
    }
  );

  if (!resp.ok) return null;

  const data = (await resp.json()) as { results: Array<{ id: string }> };
  return data.results[0]?.id ?? null;
}
