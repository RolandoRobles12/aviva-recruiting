import { useState } from 'react';
import { Bell, Settings, Link, Clock, Wrench, HelpCircle, Palette } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { RemindersTab } from '../components/settings/RemindersTab';
import { GmailConnectionTab } from '../components/settings/GmailConnectionTab';
import { LinkDurationTab } from '../components/settings/LinkDurationTab';
import { QuestionsTab } from '../components/settings/QuestionsTab';
import { BrandingTab } from '../components/settings/BrandingTab';
import { useSettings } from '../hooks/useSettings';
import { backfillCandidateDocuments } from '../services/functions';

type Tab = 'gmail' | 'reminders' | 'links' | 'questions' | 'branding' | 'admin';

const TABS: { id: Tab; label: string; Icon: typeof Link }[] = [
  { id: 'gmail', label: 'Conexión Gmail', Icon: Link },
  { id: 'reminders', label: 'Recordatorios', Icon: Bell },
  { id: 'links', label: 'Duración de enlaces', Icon: Clock },
  { id: 'questions', label: 'Preguntas del formulario', Icon: HelpCircle },
  { id: 'branding', label: 'Marca', Icon: Palette },
  { id: 'admin', label: 'Admin', Icon: Wrench },
];

function AdminTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleBackfill = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await backfillCandidateDocuments({});
      setResult(res.data.message);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-sm font-semibold text-gray-800">Mantenimiento</h3>
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Completar documentos faltantes</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Agrega los tipos de documento que falten en candidatos existentes sin sobreescribir los actuales.
          </p>
        </div>
        <button
          onClick={handleBackfill}
          disabled={running}
          className="flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors disabled:opacity-60"
        >
          {running ? 'Procesando...' : 'Ejecutar backfill'}
        </button>
        {result && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{result}</p>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('gmail');
  const {
    reminderSettings,
    linkDuration,
    loading,
    saving,
    savedKey,
    saveReminders,
    saveLinkDuration,
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
              {activeTab === 'gmail' && <GmailConnectionTab />}
              {activeTab === 'reminders' && (
                <RemindersTab
                  settings={reminderSettings}
                  saving={saving}
                  saved={savedKey === 'reminders'}
                  onSave={saveReminders}
                />
              )}
              {activeTab === 'links' && (
                <LinkDurationTab
                  settings={linkDuration}
                  saving={saving}
                  saved={savedKey === 'links'}
                  onSave={saveLinkDuration}
                />
              )}
              {activeTab === 'questions' && <QuestionsTab />}
              {activeTab === 'branding' && <BrandingTab />}
              {activeTab === 'admin' && <AdminTab />}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
