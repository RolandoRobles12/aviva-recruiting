import { useState } from 'react';
import { BarChart3, Brain, ClipboardList, ListChecks } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useAuth } from '../hooks/useAuth';
import { SessionsTab } from '../components/psychometric/SessionsTab';
import { QuestionBankTab } from '../components/psychometric/QuestionBankTab';
import { InstrumentAnalysisTab } from '../components/psychometric/InstrumentAnalysisTab';

type Tab = 'sessions' | 'bank' | 'analysis';

const TABS: { key: Tab; label: string; icon: typeof ListChecks; needsBankPermission: boolean }[] = [
  { key: 'sessions', label: 'Sesiones', icon: ListChecks, needsBankPermission: false },
  { key: 'bank', label: 'Banco de preguntas', icon: ClipboardList, needsBankPermission: true },
  { key: 'analysis', label: 'Análisis del instrumento', icon: BarChart3, needsBankPermission: true },
];

export function PsychometricTestsPage() {
  const { can } = useAuth();
  const canManageBank = can('psychometric_manage_bank');
  const [activeTab, setActiveTab] = useState<Tab>('sessions');
  // Tabs mount on first visit and then stay mounted (hidden). The analysis tab
  // reads up to 1000 sessions, so re-running it on every visit was wasteful, and
  // the bank tab would lose unsaved edits on a tab switch.
  const [visited, setVisited] = useState<Set<Tab>>(new Set(['sessions']));
  const [focusQuestionId, setFocusQuestionId] = useState<string | null>(null);

  const open = (tab: Tab) => {
    setActiveTab(tab);
    setVisited((prev) => new Set(prev).add(tab));
  };

  /** From "ítems a revisar" in the analysis tab straight to that item's editor. */
  const editItem = (questionId: string) => {
    setFocusQuestionId(questionId);
    open('bank');
  };

  const visibleTabs = TABS.filter((tab) => !tab.needsBankPermission || canManageBank);

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Brain size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Pruebas Psicométricas</h2>
          </div>
          <div className="flex gap-1">
            {visibleTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => open(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === key
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

        <div className="flex-1 overflow-y-auto p-6">
          {visited.has('sessions') && (
            <div className={activeTab === 'sessions' ? '' : 'hidden'}>
              <SessionsTab />
            </div>
          )}
          {canManageBank && visited.has('bank') && (
            <div className={activeTab === 'bank' ? '' : 'hidden'}>
              <QuestionBankTab
                focusQuestionId={focusQuestionId}
                onFocusHandled={() => setFocusQuestionId(null)}
              />
            </div>
          )}
          {canManageBank && visited.has('analysis') && (
            <div className={activeTab === 'analysis' ? '' : 'hidden'}>
              <InstrumentAnalysisTab onEditItem={editItem} />
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
