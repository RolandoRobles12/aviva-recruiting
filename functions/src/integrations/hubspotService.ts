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
 * Look up an existing HubSpot owner by email without creating anything.
 * Returns null when the owner doesn't exist or the API key is not configured.
 */
export async function findOwnerIdByEmail(email: string): Promise<string | null> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) return null;
  return getOwnerIdByEmail(email, apiKey);
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
 * Count deals created by a specific owner (hubspot_owner_id) inside a date
 * window. Handles pagination automatically.
 *
 * `toDateMs` closes the window (createdate <= toDateMs). Pass it whenever the
 * count is compared against a fixed-period target: an open-ended count keeps
 * accumulating deals after the period ends, so a check evaluated late — a
 * backfilled one, or a retroactive recalculation — would measure months of
 * work against a monthly target. With both ends bound the count is
 * reproducible: the same window always yields the same number.
 */
export async function countDealsByOwner(
  ownerId: string,
  fromDateMs: number,
  toDateMs?: number,
): Promise<number> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) throw new Error('HubSpot API key not configured.');

  const url = `${HUBSPOT_API_BASE}/crm/v3/objects/deals/search`;
  let after: string | undefined;
  let total = 0;
  const seenCursors = new Set<string>();

  do {
    const filters: Record<string, unknown>[] = [
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
      { propertyName: 'createdate',       operator: 'GTE', value: fromDateMs },
    ];
    if (toDateMs !== undefined) {
      filters.push({ propertyName: 'createdate', operator: 'LTE', value: toDateMs });
    }

    const payload: Record<string, unknown> = {
      filterGroups: [{ filters }],
      properties: ['createdate'],
      // Sorting by a stable key keeps the cursor consistent across pages;
      // without it HubSpot may repeat or skip records between requests.
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      limit: 100,
      ...(after ? { after } : {}),
    };

    const resp = await hubspotSearchWithRetry(url, apiKey, payload);

    const data = (await resp.json()) as {
      results?: unknown[];
      paging?: { next?: { after?: string } };
    };

    total += data.results?.length ?? 0;

    const nextCursor = data.paging?.next?.after;
    if (!nextCursor) break;
    // A cursor that repeats (or points back at a page already fetched) would
    // loop forever and inflate the count — stop instead.
    if (seenCursors.has(nextCursor)) {
      console.warn(`[hubspot] countDealsByOwner: repeated paging cursor for owner ${ownerId} — stopping at ${total}`);
      break;
    }
    seenCursors.add(nextCursor);
    after = nextCursor;
  } while (after);

  return total;
}

/**
 * POST to the HubSpot search API, retrying rate limits and transient server
 * errors. A backfill walks every evaluated candidate, so 429s are expected.
 */
async function hubspotSearchWithRetry(
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
  maxAttempts = 4,
): Promise<Response> {
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (resp.ok) return resp;

    lastError = await resp.text();
    const retryable = resp.status === 429 || resp.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`HubSpot deals search failed: HTTP ${resp.status} — ${lastError}`);
    }

    const retryAfterHeader = Number(resp.headers.get('Retry-After'));
    const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 500 * 2 ** (attempt - 1);
    console.warn(`[hubspot] search HTTP ${resp.status} — retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`HubSpot deals search failed after ${maxAttempts} attempts — ${lastError}`);
}
