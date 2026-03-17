import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { EmailTemplatesSettings, ReminderSettings, DocumentSettings, LinkDurationSettings } from '../types';
import { DOCUMENT_CONFIG } from '../types';

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
  };
}

export async function saveEmailTemplates(templates: EmailTemplatesSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'emailTemplates'), templates);
}

export async function getDocumentSettings(): Promise<DocumentSettings> {
  const snap = await getDoc(doc(db, 'settings', 'documents'));
  if (!snap.exists()) return DOCUMENT_CONFIG as DocumentSettings;
  return snap.data() as DocumentSettings;
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
