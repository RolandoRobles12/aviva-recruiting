import { db } from './admin';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { profiles: string[]; fetchedAt: number } | null = null;

/**
 * Allowed hiring profiles live in Firestore (settings/hiringProfiles, field
 * `profiles`: string[] or comma-separated string) so the list survives deploys —
 * env-var edits made in the Cloud console are wiped on every `firebase deploy`.
 * Falls back to the HIRING_PROFILES param value when the doc is missing, empty,
 * or unreadable. An empty fallback means "allow all profiles" (same semantics
 * the env param always had).
 */
export async function getAllowedHiringProfiles(fallbackCsv: string): Promise<string[]> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.profiles;

  let profiles: string[] = [];
  try {
    const snap = await db.doc('settings/hiringProfiles').get();
    const raw = snap.exists ? snap.data()?.profiles : undefined;
    if (Array.isArray(raw)) {
      profiles = raw.map((p) => String(p).trim()).filter(Boolean);
    } else if (typeof raw === 'string') {
      profiles = raw.split(',').map((p) => p.trim()).filter(Boolean);
    }
  } catch (err) {
    console.error('[hiringProfiles] Firestore read failed — using fallback:', err);
  }

  if (profiles.length === 0) {
    profiles = fallbackCsv.split(',').map((p) => p.trim()).filter(Boolean);
  }

  cached = { profiles, fetchedAt: Date.now() };
  return profiles;
}
