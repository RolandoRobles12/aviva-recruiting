import { db } from './admin';

type BrandingDoc = { logoUrl?: string; companySignatureUrl?: string };

async function getBranding(): Promise<BrandingDoc> {
  try {
    const snap = await db.doc('settings/branding').get();
    if (!snap.exists) return {};
    return (snap.data() as BrandingDoc) ?? {};
  } catch {
    return {};
  }
}

export async function getLogoUrl(): Promise<string | undefined> {
  return (await getBranding()).logoUrl;
}

export async function getCompanySignatureUrl(): Promise<string | undefined> {
  return (await getBranding()).companySignatureUrl;
}
