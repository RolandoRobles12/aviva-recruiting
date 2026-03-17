import { db } from './admin';

interface LinkDurationSettings {
  formDays: number;
  offerDays: number;
  contractDays: number;
}

const DEFAULTS: LinkDurationSettings = {
  formDays: 7,
  offerDays: 7,
  contractDays: 7,
};

export async function getLinkDuration(): Promise<LinkDurationSettings> {
  try {
    const snap = await db.doc('settings/linkDuration').get();
    if (!snap.exists) return DEFAULTS;
    const data = snap.data() as Partial<LinkDurationSettings>;
    return { ...DEFAULTS, ...data };
  } catch {
    return DEFAULTS;
  }
}
