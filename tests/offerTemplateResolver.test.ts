import { beforeEach, describe, expect, it, vi } from 'vitest';

// The resolver reads Firestore through functions/src/utils/admin — stub it so
// the suite never touches a real project.
const templates: Array<{ id: string; data: Record<string, unknown> }> = [];

vi.mock('../functions/src/utils/admin', () => ({
  db: {
    collection: (name: string) => {
      if (name !== 'offer_templates') throw new Error(`unexpected collection ${name}`);
      return {
        get: async () => ({
          empty: templates.length === 0,
          docs: templates.map((t) => ({ id: t.id, data: () => t.data })),
        }),
      };
    },
  },
  storage: {},
  auth: {},
  default: {},
}));

const { resolveOfferTemplate } = await import('../functions/src/offer/templateResolver');

const ts = (ms: number) => ({ toMillis: () => ms });

beforeEach(() => {
  templates.length = 0;
});

describe('resolveOfferTemplate', () => {
  it('returns null when no template exists', async () => {
    expect(await resolveOfferTemplate({ position: 'Promotor' })).toBeNull();
  });

  it('prefers the profile assignment over the template stored on the candidate', async () => {
    templates.push(
      { id: 'seeded', data: { name: 'Seed', positionKeywords: ['promotor'], createdAt: ts(1) } },
      { id: 'nuevo', data: { name: 'Nuevo', profileNames: ['Promotor/a Aviva tu Compra'], createdAt: ts(2) } },
    );

    const match = await resolveOfferTemplate({
      position: 'Promotor de crédito',
      profile: 'Promotor/a Aviva tu Compra',
      storedTemplateId: 'seeded',
    });

    expect(match).toMatchObject({ id: 'nuevo', matchedBy: 'profile' });
  });

  it('matches profile names regardless of case, accents and extra spacing', async () => {
    templates.push({ id: 'nuevo', data: { profileNames: ['Promotor/a Aviva tu Casa'], createdAt: ts(1) } });

    const match = await resolveOfferTemplate({ profile: '  promotor/a aviva tu  CASA ' });

    expect(match).toMatchObject({ id: 'nuevo', matchedBy: 'profile' });
  });

  it('keeps the stored template when no profile is assigned to any template', async () => {
    templates.push(
      { id: 'a', data: { createdAt: ts(1) } },
      { id: 'b', data: { createdAt: ts(2) } },
    );

    const match = await resolveOfferTemplate({ profile: 'Promotor/a Aviva tu Negocio', storedTemplateId: 'b' });

    expect(match).toMatchObject({ id: 'b', matchedBy: 'stored' });
  });

  it('falls back to keywords when the stored template was deleted', async () => {
    templates.push(
      { id: 'a', data: { positionKeywords: ['gerente'], createdAt: ts(1) } },
      { id: 'b', data: { positionKeywords: ['promotor'], createdAt: ts(2) } },
    );

    const match = await resolveOfferTemplate({ position: 'Promotor de crédito', storedTemplateId: 'borrado' });

    expect(match).toMatchObject({ id: 'b', matchedBy: 'keyword' });
  });

  it('falls back to the oldest template deterministically', async () => {
    templates.push(
      { id: 'nuevo', data: { createdAt: ts(5) } },
      { id: 'viejo', data: { createdAt: ts(1) } },
    );

    const match = await resolveOfferTemplate({ position: 'Sin coincidencias' });

    expect(match).toMatchObject({ id: 'viejo', matchedBy: 'fallback' });
  });
});
