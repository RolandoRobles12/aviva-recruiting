import { db } from './admin';

export async function getLogoUrl(): Promise<string | undefined> {
  try {
    const snap = await db.doc('settings/branding').get();
    if (!snap.exists) return undefined;
    return (snap.data() as { logoUrl?: string }).logoUrl;
  } catch {
    return undefined;
  }
}
