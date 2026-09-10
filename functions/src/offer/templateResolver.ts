import { db } from '../utils/admin';

/**
 * Shared offer-template resolution.
 *
 * The template is resolved every time the letter is rendered (getOffer /
 * signOffer), not just once when the candidate is created. A candidate created
 * before a template existed — or before a profile was assigned to it — picks up
 * the recruiter's current configuration instead of staying pinned to whatever
 * matched on the day the Viterbit webhook fired.
 */

export type OfferTemplateMatchedBy = 'profile' | 'stored' | 'keyword' | 'fallback';

export interface OfferTemplateMatch {
  id: string;
  data: Record<string, unknown>;
  matchedBy: OfferTemplateMatchedBy;
}

/** Case/accent/spacing-insensitive comparison — Viterbit profile names are
 *  free text and rarely match the picker list byte for byte. */
function normalizeProfile(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function createdAtMillis(data: Record<string, unknown>): number {
  const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
  return typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : 0;
}

/** Find the offer template for a candidate.
 *  Priority: 1. profile assigned to the template, 2. the template stored on the
 *  candidate, 3. positionKeywords, 4. the oldest template. */
export async function resolveOfferTemplate(opts: {
  position?: string;
  profile?: string;
  storedTemplateId?: string;
}): Promise<OfferTemplateMatch | null> {
  const snap = await db.collection('offer_templates').get();
  if (snap.empty) return null;

  // Deterministic order so the fallback never depends on Firestore's ordering.
  const docs = [...snap.docs].sort((a, b) => {
    const diff = createdAtMillis(a.data()) - createdAtMillis(b.data());
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  // 1. Profile-name match (primary — the recruiter's explicit assignment)
  if (opts.profile) {
    const target = normalizeProfile(opts.profile);
    if (target) {
      for (const doc of docs) {
        const profileNames = (doc.data().profileNames as string[]) ?? [];
        if (profileNames.some((n) => normalizeProfile(String(n)) === target)) {
          return { id: doc.id, data: doc.data(), matchedBy: 'profile' };
        }
      }
    }
  }

  // 2. Template already stored on the candidate — only when it still exists
  if (opts.storedTemplateId) {
    const stored = docs.find((d) => d.id === opts.storedTemplateId);
    if (stored) return { id: stored.id, data: stored.data(), matchedBy: 'stored' };
  }

  // 3. positionKeywords fallback (legacy / non-Viterbit)
  const posLower = (opts.position ?? '').toLowerCase();
  if (posLower) {
    for (const doc of docs) {
      const keywords = (doc.data().positionKeywords as string[]) ?? [];
      if (keywords.some((kw) => kw && posLower.includes(String(kw).toLowerCase()))) {
        return { id: doc.id, data: doc.data(), matchedBy: 'keyword' };
      }
    }
  }

  // 4. Oldest template
  return { id: docs[0].id, data: docs[0].data(), matchedBy: 'fallback' };
}
