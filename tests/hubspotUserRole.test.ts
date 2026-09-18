import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// defineString(...).value() reads the environment, so these must be set before
// the module under test is imported.
process.env.HUBSPOT_API_KEY = 'test-key';

/** What settings/hubspot holds for the current test. */
let storedSettings: Record<string, unknown> = {};

vi.mock('../functions/src/utils/admin', () => ({
  db: {
    doc: (path: string) => {
      if (path !== 'settings/hubspot') throw new Error(`unexpected doc ${path}`);
      return { get: async () => ({ exists: true, data: () => storedSettings }) };
    },
  },
  storage: {},
  auth: {},
  default: {},
}));

const { createHubSpotUser, ensureHubSpotUserRole, clearHubSpotSettingsCache } = await import(
  '../functions/src/integrations/hubspotService'
);

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** Routes each HubSpot endpoint to a canned response and records every call. */
function mockHubspot(handlers: {
  roles?: Array<{ id: string; name: string }>;
  owner?: string | null;
  user?: { id: string; roleId?: string | null; superAdmin?: boolean } | 'missing';
  createStatus?: number;
}) {
  const calls: Call[] = [];

  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });

    const json = (status: number, payload: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    if (url.includes('/settings/v3/users/roles')) {
      return json(200, { results: handlers.roles ?? [] });
    }
    if (url.includes('/crm/v3/owners')) {
      return json(200, { results: handlers.owner ? [{ id: handlers.owner }] : [] });
    }
    if (url.includes('idProperty=EMAIL')) {
      if (!handlers.user || handlers.user === 'missing') return json(404, {});
      return json(200, handlers.user);
    }
    if (init?.method === 'PUT') return json(204, {});
    if (init?.method === 'POST') return json(handlers.createStatus ?? 201, { id: 'user-new' });
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  storedSettings = {};
  clearHubSpotSettingsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createHubSpotUser', () => {
  it('creates the user with the configured role and team', async () => {
    storedSettings = { roleId: 'role-42', primaryTeamId: 'team-7' };
    const calls = mockHubspot({ roles: [{ id: 'role-42', name: 'Ventas' }], owner: null });

    const result = await createHubSpotUser({
      corporateEmail: 'promotor@aviva.test',
      firstName: 'Ana',
      lastName: 'Ruiz',
    });

    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/settings/v3/users/'));
    expect(created?.body).toMatchObject({
      email: 'promotor@aviva.test',
      roleId: 'role-42',
      primaryTeamId: 'team-7',
    });
    expect(result.roleId).toBe('role-42');
    expect(result.roleStatus).toBe('assigned');
  });

  it('creates the user without a role when none is configured', async () => {
    const calls = mockHubspot({ owner: null });

    const result = await createHubSpotUser({
      corporateEmail: 'promotor@aviva.test',
      firstName: 'Ana',
      lastName: 'Ruiz',
    });

    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/settings/v3/users/'));
    expect(created?.body).not.toHaveProperty('roleId');
    expect(result.roleStatus).toBe('not_configured');
  });

  it('drops a role the portal does not have instead of failing provisioning', async () => {
    storedSettings = { roleId: 'role-stale' };
    const calls = mockHubspot({ roles: [{ id: 'role-42', name: 'Ventas' }], owner: null });

    const result = await createHubSpotUser({
      corporateEmail: 'promotor@aviva.test',
      firstName: 'Ana',
      lastName: 'Ruiz',
    });

    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/settings/v3/users/'));
    expect(created?.body).not.toHaveProperty('roleId');
    expect(result.userId).toBe('user-new');
  });

  it('tops up the role of an account that already exists without one', async () => {
    storedSettings = { roleId: 'role-42' };
    const calls = mockHubspot({
      roles: [{ id: 'role-42', name: 'Ventas' }],
      owner: 'owner-9',
      user: { id: 'user-5', roleId: null },
    });

    const result = await createHubSpotUser({
      corporateEmail: 'promotor@aviva.test',
      firstName: 'Ana',
      lastName: 'Ruiz',
    });

    expect(result.ownerId).toBe('owner-9');
    expect(result.roleStatus).toBe('assigned');
    const assigned = calls.find((c) => c.method === 'PUT');
    expect(assigned?.url).toContain('/settings/v3/users/user-5');
    expect(assigned?.body).toEqual({ roleId: 'role-42' });
    // Nothing is created for an account that already exists.
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/settings/v3/users/'))).toBe(false);
  });
});

describe('ensureHubSpotUserRole', () => {
  beforeEach(() => {
    storedSettings = { roleId: 'role-42' };
  });

  it('leaves a user who already carries a role untouched', async () => {
    const calls = mockHubspot({
      roles: [{ id: 'role-42', name: 'Ventas' }],
      user: { id: 'user-5', roleId: 'role-admin' },
    });

    const result = await ensureHubSpotUserRole('lider@aviva.test');

    expect(result).toEqual({ status: 'already_set', roleId: 'role-admin' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('never touches a super admin, who carries no role by design', async () => {
    const calls = mockHubspot({
      roles: [{ id: 'role-42', name: 'Ventas' }],
      user: { id: 'user-1', roleId: null, superAdmin: true },
    });

    const result = await ensureHubSpotUserRole('admin@aviva.test');

    expect(result.status).toBe('skipped_super_admin');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('reports what it would do on a dry run without writing', async () => {
    const calls = mockHubspot({
      roles: [{ id: 'role-42', name: 'Ventas' }],
      user: { id: 'user-5', roleId: null },
    });

    const result = await ensureHubSpotUserRole('promotor@aviva.test', { dryRun: true });

    expect(result).toEqual({ status: 'would_assign', roleId: 'role-42' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('reports an account that does not exist in HubSpot', async () => {
    mockHubspot({ roles: [{ id: 'role-42', name: 'Ventas' }], user: 'missing' });

    expect(await ensureHubSpotUserRole('nadie@aviva.test')).toEqual({
      status: 'user_not_found',
      roleId: 'role-42',
    });
  });

  it('does nothing when the portal has no role configured', async () => {
    storedSettings = {};
    const calls = mockHubspot({ user: { id: 'user-5', roleId: null } });

    expect(await ensureHubSpotUserRole('promotor@aviva.test')).toEqual({
      status: 'not_configured',
      roleId: '',
    });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
