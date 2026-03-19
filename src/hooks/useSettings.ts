import { useState, useEffect } from 'react';
import {
  getReminderSettings,
  saveReminderSettings,
  getEmailTemplates,
  saveEmailTemplates,
  getDocumentSettings,
  saveDocumentSettings,
  getLinkDurationSettings,
  saveLinkDurationSettings,
  getEmployerSignatureSettings,
  saveEmployerSignatureSettings,
  DEFAULT_REMINDER_SETTINGS,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_LINK_DURATION,
} from '../services/settings';
import type { ReminderSettings, EmailTemplatesSettings, DocumentSettings, LinkDurationSettings, EmployerSignatureSettings } from '../types';
import { DOCUMENT_CONFIG } from '../types';

export function useSettings() {
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplatesSettings>(DEFAULT_EMAIL_TEMPLATES);
  const [documentSettings, setDocumentSettings] = useState<DocumentSettings>(DOCUMENT_CONFIG as DocumentSettings);
  const [linkDuration, setLinkDuration] = useState<LinkDurationSettings>(DEFAULT_LINK_DURATION);
  const [employerSignature, setEmployerSignature] = useState<EmployerSignatureSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getReminderSettings(), getEmailTemplates(), getDocumentSettings(), getLinkDurationSettings(), getEmployerSignatureSettings()])
      .then(([reminders, emails, documents, links, employer]) => {
        setReminderSettings(reminders);
        setEmailTemplates(emails);
        setDocumentSettings(documents);
        setLinkDuration(links);
        setEmployerSignature(employer);
      })
      .finally(() => setLoading(false));
  }, []);

  const showSaved = (key: string) => {
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 2500);
  };

  const handleSaveReminders = async (settings: ReminderSettings) => {
    setSaving(true);
    try {
      await saveReminderSettings(settings);
      setReminderSettings(settings);
      showSaved('reminders');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmailTemplates = async (templates: EmailTemplatesSettings) => {
    setSaving(true);
    try {
      await saveEmailTemplates(templates);
      setEmailTemplates(templates);
      showSaved('emails');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDocuments = async (settings: DocumentSettings) => {
    setSaving(true);
    try {
      await saveDocumentSettings(settings);
      setDocumentSettings(settings);
      showSaved('documents');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLinkDuration = async (settings: LinkDurationSettings) => {
    setSaving(true);
    try {
      await saveLinkDurationSettings(settings);
      setLinkDuration(settings);
      showSaved('links');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmployerSignature = async (settings: EmployerSignatureSettings) => {
    setSaving(true);
    try {
      await saveEmployerSignatureSettings(settings);
      setEmployerSignature(settings);
      showSaved('employer');
    } finally {
      setSaving(false);
    }
  };

  return {
    reminderSettings,
    emailTemplates,
    documentSettings,
    linkDuration,
    employerSignature,
    loading,
    saving,
    savedKey,
    saveReminders: handleSaveReminders,
    saveEmailTemplates: handleSaveEmailTemplates,
    saveDocuments: handleSaveDocuments,
    saveLinkDuration: handleSaveLinkDuration,
    saveEmployerSignature: handleSaveEmployerSignature,
  };
}
