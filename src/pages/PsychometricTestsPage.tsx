import { useState } from 'react';
import { Brain, ClipboardList, ListChecks } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useAuth } from '../hooks/useAuth';
import { SessionsTab } from '../components/psychometric/SessionsTab';
import { QuestionBankTab } from '../components/psychometric/QuestionBankTab';

type Tab = 'sessions' | 'bank';

export function PsychometricTestsPage() {
  const { can } = useAuth();
  const canManageBank = can('psychometric_manage_bank');
  const [activeTab, setActiveTab] = useState<Tab>('sessions');

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Brain size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Pruebas Psicométricas</h2>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('sessions')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'sessions' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <ListChecks size={15} />
              <span className="hidden sm:block">Sesiones</span>
            </button>
            {canManageBank && (
              <button
                onClick={() => setActiveTab('bank')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'bank' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <ClipboardList size={15} />
                <span className="hidden sm:block">Banco de preguntas</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'sessions' && <SessionsTab />}
          {activeTab === 'bank' && canManageBank && <QuestionBankTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
