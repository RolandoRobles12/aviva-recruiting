import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { BrandingSettings, EmailTemplatesSettings, ReminderSettings, DocumentSettings, LinkDurationSettings, DocumentSetting, DocumentType } from '../types';
import { DOCUMENT_CONFIG, DOCUMENT_TYPES } from '../types';

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  intervalHours: 48,
  maxReminders: 3,
};

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplatesSettings = {
  invitation: {
    subject: 'Aviva | Sube tu documentación de ingreso — {position}',
    bodyText:
      'Nos da gusto que vayas a formar parte del equipo. Para continuar con tu proceso de ingreso, necesitamos que subas los siguientes documentos a través del enlace a continuación.',
  },
  reminder: {
    subject: 'Aviva | Recordatorio: Documentos pendientes — {position}',
    bodyText:
      'Notamos que aún tienes documentos pendientes por subir. Para no retrasar tu proceso de ingreso, te pedimos que los completes lo antes posible.',
  },
  offer: {
    subject: 'Aviva | Tu Carta Oferta está lista — {position}',
    bodyText:
      'Nos complace informarte que hemos preparado tu carta oferta. Por favor revísala y fírmala a través del enlace a continuación para continuar con tu proceso de ingreso.',
  },
  contract: {
    subject: 'Aviva | Tu Contrato está listo para firmar — {position}',
    bodyText:
      'Nos da gusto que estés avanzando en tu proceso de contratación. Tu contrato está listo para ser revisado y firmado. Accede a través del enlace a continuación.',
  },
};

export async function getReminderSettings(): Promise<ReminderSettings> {
  const snap = await getDoc(doc(db, 'settings', 'reminders'));
  if (!snap.exists()) return DEFAULT_REMINDER_SETTINGS;
  return { ...DEFAULT_REMINDER_SETTINGS, ...(snap.data() as Partial<ReminderSettings>) };
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'reminders'), settings);
}

export async function getEmailTemplates(): Promise<EmailTemplatesSettings> {
  const snap = await getDoc(doc(db, 'settings', 'emailTemplates'));
  if (!snap.exists()) return DEFAULT_EMAIL_TEMPLATES;
  const data = snap.data() as Partial<EmailTemplatesSettings>;
  return {
    invitation: { ...DEFAULT_EMAIL_TEMPLATES.invitation, ...data.invitation },
    reminder: { ...DEFAULT_EMAIL_TEMPLATES.reminder, ...data.reminder },
    offer: { ...DEFAULT_EMAIL_TEMPLATES.offer, ...data.offer },
    contract: { ...DEFAULT_EMAIL_TEMPLATES.contract, ...data.contract },
  };
}

export async function saveEmailTemplates(templates: EmailTemplatesSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'emailTemplates'), templates);
}

export async function getDocumentSettings(): Promise<DocumentSettings> {
  const snap = await getDoc(doc(db, 'settings', 'documents'));
  if (!snap.exists()) return DOCUMENT_CONFIG as DocumentSettings;
  const data = snap.data() as Partial<Record<string, Partial<DocumentSetting>>>;
  const result = {} as DocumentSettings;
  for (const type of DOCUMENT_TYPES) {
    result[type as DocumentType] = {
      ...(DOCUMENT_CONFIG as Record<string, { label: string; description: string; required: boolean }>)[type],
      ...(data[type] ?? {}),
    } as DocumentSetting;
  }
  return result;
}

export async function saveDocumentSettings(settings: DocumentSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'documents'), settings);
}

// ─── Link Duration Settings ──────────────────────────────────────────────────

export const DEFAULT_LINK_DURATION: LinkDurationSettings = {
  formDays: 7,
  offerDays: 7,
  contractDays: 7,
};

export async function getLinkDurationSettings(): Promise<LinkDurationSettings> {
  const snap = await getDoc(doc(db, 'settings', 'linkDuration'));
  if (!snap.exists()) return DEFAULT_LINK_DURATION;
  return { ...DEFAULT_LINK_DURATION, ...(snap.data() as Partial<LinkDurationSettings>) };
}

export async function saveLinkDurationSettings(settings: LinkDurationSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'linkDuration'), settings);
}

// ─── Branding Settings ───────────────────────────────────────────────────────

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const snap = await getDoc(doc(db, 'settings', 'branding'));
  if (!snap.exists()) return {};
  return snap.data() as BrandingSettings;
}

export async function saveBrandingSettings(settings: BrandingSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'branding'), settings);
}
