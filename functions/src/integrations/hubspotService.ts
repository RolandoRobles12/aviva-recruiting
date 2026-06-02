import { defineString } from 'firebase-functions/params';

const HUBSPOT_API_KEY = defineString('HUBSPOT_API_KEY');
const HUBSPOT_API_BASE = 'https://api.hubapi.com';

async function getOwnerIdByEmail(email: string, apiKey: string): Promise<string | null> {
  try {
    const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/owners`);
    url.searchParams.set('email', email);
    url.searchParams.set('limit', '1');
    url.searchParams.set('archived', 'false');
    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { results: Array<{ id: string }> };
    return data.results[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a HubSpot portal user for a new employee.
 * First checks if the user already exists as an owner. If so, returns their
 * existing owner ID without creating a duplicate. On creation, fetches and
 * returns the owner ID for use in CRM record assignment.
 */
export async function createHubSpotUser(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
}): Promise<{ userId: string; ownerId: string | null }> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) throw new Error('HubSpot API key not configured.');

  // Check if user already exists as an owner before creating
  const existingOwnerId = await getOwnerIdByEmail(params.corporateEmail, apiKey);
  if (existingOwnerId) {
    return { userId: 'existing', ownerId: existingOwnerId };
  }

  const resp = await fetch(`${HUBSPOT_API_BASE}/settings/v3/users/`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: params.corporateEmail,
      firstName: params.firstName,
      lastName: params.lastName,
      sendWelcomeEmail: true,
      primaryTeamId: '11727817',
    }),
  });

  if (resp.status === 409) {
    const ownerId = await getOwnerIdByEmail(params.corporateEmail, apiKey);
    return { userId: 'existing', ownerId };
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot createUser failed: HTTP ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { id: string };
  const ownerId = await getOwnerIdByEmail(params.corporateEmail, apiKey);
  return { userId: data.id, ownerId };
}

/**
 * Count deals created by a specific owner (hubspot_owner_id) from a given
 * start date up to now. Handles pagination automatically.
 */
export async function countDealsByOwner(
  ownerId: string,
  fromDateMs: number,
): Promise<number> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) throw new Error('HubSpot API key not configured.');

  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/deals/search`;
  let after: string | undefined;
  let total = 0;

  do {
    const payload: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
            { propertyName: 'createdate',       operator: 'GTE', value: fromDateMs },
          ],
        },
      ],
      properties: ['createdate'],
      limit: 100,
      ...(after ? { after } : {}),
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HubSpot deals search failed: HTTP ${resp.status} — ${text}`);
    }

    const data = (await resp.json()) as {
      results: unknown[];
      paging?: { next?: { after?: string } };
    };

    total += data.results.length;
    after = data.paging?.next?.after;
  } while (after);

  return total;
}
