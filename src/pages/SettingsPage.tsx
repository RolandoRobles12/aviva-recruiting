import { useState } from 'react';
import { Mail, Bell, FileText, Settings } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { EmailTemplatesTab } from '../components/settings/EmailTemplatesTab';
import { RemindersTab } from '../components/settings/RemindersTab';
import { DocumentsTab } from '../components/settings/DocumentsTab';
import { useSettings } from '../hooks/useSettings';

type Tab = 'emails' | 'reminders' | 'documents';

const TABS: { id: Tab; label: string; Icon: typeof Mail }[] = [
  { id: 'emails', label: 'Plantillas de correo', Icon: Mail },
  { id: 'reminders', label: 'Recordatorios', Icon: Bell },
  { id: 'documents', label: 'Documentos', Icon: FileText },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('emails');
  const {
    reminderSettings,
    emailTemplates,
    documentSettings,
    loading,
    saving,
    savedKey,
    saveReminders,
    saveEmailTemplates,
    saveDocuments,
  } = useSettings();

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Configuración</h2>
          </div>
          <div className="flex gap-1 flex-wrap">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:block">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'emails' && (
                <EmailTemplatesTab
                  templates={emailTemplates}
                  saving={saving}
                  saved={savedKey === 'emails'}
                  onSave={saveEmailTemplates}
                />
              )}
              {activeTab === 'reminders' && (
                <RemindersTab
                  settings={reminderSettings}
                  saving={saving}
                  saved={savedKey === 'reminders'}
                  onSave={saveReminders}
                />
              )}
              {activeTab === 'documents' && (
                <DocumentsTab
                  settings={documentSettings}
                  saving={saving}
                  saved={savedKey === 'documents'}
                  onSave={saveDocuments}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
