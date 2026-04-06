import { useState } from 'react';
import { FileText, HelpCircle, ClipboardList } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { DocumentsTab } from '../components/settings/DocumentsTab';
import { QuestionsTab } from '../components/settings/QuestionsTab';
import { useSettings } from '../hooks/useSettings';

type Tab = 'documents' | 'questions';

export function FormConfigPage() {
  const [activeTab, setActiveTab] = useState<Tab>('questions');
  const { documentSettings, loading, saving, savedKey, saveDocuments } = useSettings();

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Preguntas y documentos</h2>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('questions')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'questions'
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <HelpCircle size={15} />
              <span className="hidden sm:block">Preguntas</span>
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'documents'
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <FileText size={15} />
              <span className="hidden sm:block">Documentos</span>
            </button>
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
              {activeTab === 'questions' && <QuestionsTab />}
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
