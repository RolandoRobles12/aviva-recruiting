import { defineString } from 'firebase-functions/params';

const HUBSPOT_API_KEY = defineString('HUBSPOT_API_KEY');
const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/**
 * Deploy-time fallbacks for the portal settings. What the app actually reads is
 * `settings/hubspot` in Firestore, written from Configuración → HubSpot, so the
 * role can be changed without a redeploy — env-var edits made in the Cloud
 * console are wiped by the next `firebase deploy`.
 */
const HUBSPOT_ROLE_ID = defineString('HUBSPOT_ROLE_ID', { default: '' });
const HUBSPOT_PRIMARY_TEAM_ID = defineString('HUBSPOT_PRIMARY_TEAM_ID', { default: '11727817' });

export interface HubSpotRole {
  id: string;
  name: string;
}

export interface HubSpotPortalSettings {
  /**
   * Role stamped on every user we create. HubSpot grants a user created
   * without one its minimum access — "ver solo sus propios contactos y
   * negocios" — so leaving this empty is what lands new promotores without the
   * permissions they need.
   */
  roleId: string;
  primaryTeamId: string;
}

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
let settingsCache: { settings: HubSpotPortalSettings; fetchedAt: number } | null = null;
let verifiedRoleId = '';

/** Drops the cached portal settings so the next read sees a just-saved change. */
export function clearHubSpotSettingsCache(): void {
  settingsCache = null;
  verifiedRoleId = '';
}

/**
 * Reads settings/hubspot, falling back to the deploy params. The Admin SDK is
 * imported lazily so this module stays usable — and testable — without it.
 */
export async function getHubSpotPortalSettings(): Promise<HubSpotPortalSettings> {
  if (settingsCache && Date.now() - settingsCache.fetchedAt < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.settings;
  }

  let roleId = '';
  let primaryTeamId = '';
  try {
    const { db } = await import('../utils/admin');
    const snap = await db.doc('settings/hubspot').get();
    const data = (snap.exists ? snap.data() : undefined) ?? {};
    roleId = String(data.roleId ?? '').trim();
    primaryTeamId = String(data.primaryTeamId ?? '').trim();
  } catch (err) {
    console.error('[hubspot] settings/hubspot read failed — using deploy params:', err);
  }

  const settings: HubSpotPortalSettings = {
    roleId: roleId || HUBSPOT_ROLE_ID.value().trim(),
    primaryTeamId: primaryTeamId || HUBSPOT_PRIMARY_TEAM_ID.value().trim(),
  };
  settingsCache = { settings, fetchedAt: Date.now() };
  return settings;
}

async function fetchRoles(apiKey: string): Promise<HubSpotRole[]> {
  const resp = await fetch(`${HUBSPOT_API_BASE}/settings/v3/users/roles`, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`HubSpot listRoles failed: HTTP ${resp.status} — ${await resp.text()}`);
  }
  const data = (await resp.json()) as { results?: Array<{ id?: string | number; name?: string }> };
  return (data.results ?? [])
    .filter((role) => role.id !== undefined && role.id !== null)
    .map((role) => ({ id: String(role.id), name: String(role.name ?? '') }));
}

/**
 * Roles defined in the HubSpot portal. One of them carries "ver todos los
 * contactos y negocios"; which one is a portal decision, so the app lists them
 * and the admin picks.
 */
export async function listHubSpotRoles(): Promise<HubSpotRole[]> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) throw new Error('HubSpot API key not configured.');
  return fetchRoles(apiKey);
}

/**
 * The role to stamp on new users, or '' when none is usable.
 *
 * A configured role is checked against the portal once per instance: a stale id
 * would make HubSpot reject the whole user creation, and a promotor without a
 * HubSpot account is worse than one with the default permissions. Either way
 * the reason lands in the logs instead of failing provisioning.
 */
async function resolveRoleId(apiKey: string): Promise<string> {
  const { roleId } = await getHubSpotPortalSettings();
  if (!roleId) {
    console.warn(
      '[hubspot] No role configured (settings/hubspot.roleId / HUBSPOT_ROLE_ID) — the new user keeps ' +
      'HubSpot\'s default "ver solo sus propios contactos y negocios". Set it in Configuración → HubSpot.',
    );
    return '';
  }
  if (verifiedRoleId === roleId) return roleId;

  try {
    const roles = await fetchRoles(apiKey);
    if (roles.length > 0 && !roles.some((role) => role.id === roleId)) {
      console.error(
        `[hubspot] configured roleId ${roleId} is not a role in this portal ` +
        `(${roles.map((role) => `${role.id}:${role.name}`).join(', ')}) — creating the user without a role`,
      );
      return '';
    }
  } catch (err) {
    // A rate-limited or unavailable roles endpoint must not block provisioning.
    console.warn('[hubspot] could not verify the configured roleId — using it as-is:', err);
  }

  verifiedRoleId = roleId;
  return roleId;
}

interface HubSpotUser {
  id: string;
  /** '' when the user carries no role — HubSpot's default minimum access. */
  roleId: string;
  superAdmin: boolean;
}

async function getUserByEmail(email: string, apiKey: string): Promise<HubSpotUser | null> {
  const resp = await fetch(
    `${HUBSPOT_API_BASE}/settings/v3/users/${encodeURIComponent(email)}?idProperty=EMAIL`,
    { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.error(`[hubspot] getUser ${email} → HTTP ${resp.status} — ${await resp.text()}`);
    return null;
  }
  const data = (await resp.json()) as {
    id?: string | number;
    roleId?: string | number | null;
    roleIds?: Array<string | number>;
    superAdmin?: boolean;
  };
  const roleId = data.roleId ?? data.roleIds?.[0];
  return {
    id: data.id === undefined || data.id === null ? '' : String(data.id),
    roleId: roleId === undefined || roleId === null ? '' : String(roleId),
    superAdmin: data.superAdmin === true,
  };
}

async function assignRole(userId: string, roleId: string, apiKey: string): Promise<void> {
  const resp = await fetch(`${HUBSPOT_API_BASE}/settings/v3/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId }),
  });
  if (!resp.ok) {
    throw new Error(`HubSpot assignRole failed: HTTP ${resp.status} — ${await resp.text()}`);
  }
}

export type RoleAssignment =
  | 'assigned'            // the configured role was applied
  | 'would_assign'        // dry run: the user has no role and would get one
  | 'already_set'         // the user already carries a role — left untouched
  | 'not_configured'      // no role configured for this portal
  | 'user_not_found'
  | 'skipped_super_admin'
  | 'error';

export interface EnsureRoleResult {
  status: RoleAssignment;
  roleId: string;
  error?: string;
}

/**
 * Gives an existing HubSpot user the configured role when they carry none.
 *
 * A user who already has a role — or a super admin, who has none by design — is
 * never touched, so healing the accounts created before the role was configured
 * can't quietly downgrade anyone.
 */
export async function ensureHubSpotUserRole(
  email: string,
  options: { dryRun?: boolean } = {},
): Promise<EnsureRoleResult> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) throw new Error('HubSpot API key not configured.');

  const roleId = await resolveRoleId(apiKey);
  if (!roleId) return { status: 'not_configured', roleId: '' };

  try {
    const user = await getUserByEmail(email, apiKey);
    if (!user || !user.id) return { status: 'user_not_found', roleId };
    if (user.superAdmin) return { status: 'skipped_super_admin', roleId };
    if (user.roleId) return { status: 'already_set', roleId: user.roleId };
    if (options.dryRun) return { status: 'would_assign', roleId };

    await assignRole(user.id, roleId, apiKey);
    console.info(`[hubspot] assigned role ${roleId} to ${email}`);
    return { status: 'assigned', roleId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hubspot] ensureUserRole ${email} failed:`, message);
    return { status: 'error', roleId, error: message };
  }
}

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

export interface CreateHubSpotUserResult {
  userId: string;
  ownerId: string | null;
  /** Role the user ended up with, '' when the portal has none configured. */
  roleId: string;
  roleStatus: RoleAssignment;
}

/**
 * Create a HubSpot portal user for a new employee.
 *
 * The user is created with the configured role, which is what decides whether
 * they see every contact and deal or only their own — HubSpot's default for a
 * roleless user is the latter. First checks if the user already exists as an
 * owner: if so it returns their existing owner ID without creating a duplicate,
 * and tops up the role when that older account never got one.
 */
export async function createHubSpotUser(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
}): Promise<CreateHubSpotUserResult> {
  const apiKey = HUBSPOT_API_KEY.value();
  if (!apiKey) throw new Error('HubSpot API key not configured.');

  // Read the settings once, then resolve the role from the cached copy.
  const { primaryTeamId } = await getHubSpotPortalSettings();
  const roleId = await resolveRoleId(apiKey);

  // Check if user already exists as an owner before creating
  const existingOwnerId = await getOwnerIdByEmail(params.corporateEmail, apiKey);
  if (existingOwnerId) {
    const role = await ensureHubSpotUserRole(params.corporateEmail);
    return { userId: 'existing', ownerId: existingOwnerId, roleId: role.roleId, roleStatus: role.status };
  }

  const resp = await fetch(`${HUBSPOT_API_BASE}/settings/v3/users/`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: params.corporateEmail,
      firstName: params.firstName,
      lastName: params.lastName,
      sendWelcomeEmail: true,
      ...(primaryTeamId ? { primaryTeamId } : {}),
      ...(roleId ? { roleId } : {}),
    }),
  });

  if (resp.status === 409) {
    const ownerId = await getOwnerIdByEmail(params.corporateEmail, apiKey);
    const role = await ensureHubSpotUserRole(params.corporateEmail);
    return { userId: 'existing', ownerId, roleId: role.roleId, roleStatus: role.status };
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HubSpot createUser failed: HTTP ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { id: string };
  const ownerId = await getOwnerIdByEmail(params.corporateEmail, apiKey);
  return {
    userId: data.id,
    ownerId,
    roleId,
    roleStatus: roleId ? 'assigned' : 'not_configured',
  };
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
