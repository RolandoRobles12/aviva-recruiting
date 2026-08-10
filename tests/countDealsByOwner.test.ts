import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// defineString('HUBSPOT_API_KEY').value() reads the environment, so this must
// be set before the module under test is imported.
process.env.HUBSPOT_API_KEY = 'test-key';

type Filter = { propertyName: string; operator: string; value: number | string };
type SearchBody = {
  filterGroups: { filters: Filter[] }[];
  sorts?: { propertyName: string; direction: string }[];
  limit: number;
  after?: string;
};

let countDealsByOwner: typeof import('../functions/src/integrations/hubspotService')['countDealsByOwner'];

beforeAll(async () => {
  ({ countDealsByOwner } = await import('../functions/src/integrations/hubspotService'));
});

/** Captures every request body and replays the queued responses in order. */
function mockSearch(pages: { results: unknown[]; after?: string }[]) {
  const bodies: SearchBody[] = [];
  let call = 0;

  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body) as SearchBody);
    const page = pages[Math.min(call++, pages.length - 1)];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        results: page.results,
        paging: page.after ? { next: { after: page.after } } : undefined,
      }),
    };
  });

  vi.stubGlobal('fetch', fetchMock);
  return { bodies, fetchMock };
}

const deals = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('countDealsByOwner', () => {
  it('bounds the window on both ends when an end date is given', async () => {
    const { bodies } = mockSearch([{ results: deals(3) }]);

    const from = Date.UTC(2026, 6, 15);
    const to = from + 30 * 24 * 60 * 60 * 1000;
    const total = await countDealsByOwner('owner-1', from, to);

    expect(total).toBe(3);
    const filters = bodies[0].filterGroups[0].filters;
    expect(filters).toEqual([
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: 'owner-1' },
      { propertyName: 'createdate', operator: 'GTE', value: from },
      { propertyName: 'createdate', operator: 'LTE', value: to },
    ]);
  });

  it('omits the upper bound when no end date is given', async () => {
    const { bodies } = mockSearch([{ results: deals(1) }]);

    await countDealsByOwner('owner-1', 1000);

    const filters = bodies[0].filterGroups[0].filters;
    expect(filters.filter((f) => f.operator === 'LTE')).toHaveLength(0);
    expect(filters).toHaveLength(2);
  });

  it('sorts by a stable key so the paging cursor stays consistent', async () => {
    const { bodies } = mockSearch([{ results: deals(1) }]);

    await countDealsByOwner('owner-1', 0, 1);

    expect(bodies[0].sorts).toEqual([{ propertyName: 'createdate', direction: 'ASCENDING' }]);
    expect(bodies[0].limit).toBe(100);
  });

  it('follows the cursor across pages and sums every page', async () => {
    const { bodies, fetchMock } = mockSearch([
      { results: deals(100), after: 'cursor-1' },
      { results: deals(100), after: 'cursor-2' },
      { results: deals(37) },
    ]);

    const total = await countDealsByOwner('owner-1', 0, 1);

    expect(total).toBe(237);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodies.map((b) => b.after)).toEqual([undefined, 'cursor-1', 'cursor-2']);
  });

  it('keeps the window filters identical on every page', async () => {
    const { bodies } = mockSearch([
      { results: deals(100), after: 'cursor-1' },
      { results: deals(5) },
    ]);

    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2026, 0, 31);
    await countDealsByOwner('owner-1', from, to);

    expect(bodies[1].filterGroups).toEqual(bodies[0].filterGroups);
  });

  it('stops instead of looping when the cursor repeats', async () => {
    const { fetchMock } = mockSearch([
      { results: deals(100), after: 'same-cursor' },
      { results: deals(100), after: 'same-cursor' },
    ]);

    const total = await countDealsByOwner('owner-1', 0, 1);

    // Two pages counted, then the repeated cursor ends the walk.
    expect(total).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a missing results array as an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      })),
    );

    await expect(countDealsByOwner('owner-1', 0, 1)).resolves.toBe(0);
  });

  it('retries a rate limit and returns the eventual count', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === 'Retry-After' ? '0' : null) },
          text: async () => 'rate limited',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ results: deals(4) }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(countDealsByOwner('owner-1', 0, 1)).resolves.toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a non-retryable error instead of undercounting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () => 'bad request',
      })),
    );

    await expect(countDealsByOwner('owner-1', 0, 1)).rejects.toThrow(/HTTP 400/);
  });
});
