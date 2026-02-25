import { useState } from 'react';
import {
  Users,
  UserPlus,
  Clock,
  CheckCircle,
  Search,
  LayoutDashboard,
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { StatsCard } from '../components/dashboard/StatsCard';
import { CandidateTable } from '../components/dashboard/CandidateTable';
import { CandidateDetailPanel } from '../components/dashboard/CandidateDetailPanel';
import { CreateCandidateModal } from '../components/dashboard/CreateCandidateModal';
import { useCandidates } from '../hooks/useCandidates';
import type { Candidate } from '../types';

export function DashboardPage() {
  const { candidates, loading, stats } = useCandidates();
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Stats Row */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <LayoutDashboard size={18} className="text-primary-600" />
              <h2 className="text-base font-semibold text-gray-900">Dashboard</h2>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <UserPlus size={15} />
              Nuevo candidato
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatsCard
              label="Total"
              value={stats.total}
              icon={<Users size={20} className="text-gray-600" />}
              color="bg-gray-100"
            />
            <StatsCard
              label="Invitados"
              value={stats.invited}
              icon={<Search size={20} className="text-yellow-600" />}
              color="bg-yellow-100"
            />
            <StatsCard
              label="En progreso"
              value={stats.inProgress}
              icon={<Clock size={20} className="text-blue-600" />}
              color="bg-blue-100"
            />
            <StatsCard
              label="En revisión"
              value={stats.underReview}
              icon={<Clock size={20} className="text-purple-600" />}
              color="bg-purple-100"
            />
            <StatsCard
              label="Aprobados"
              value={stats.approved}
              icon={<CheckCircle size={20} className="text-green-600" />}
              color="bg-green-100"
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Candidate List */}
          <div className={`border-r border-gray-100 bg-white flex flex-col ${selected ? 'hidden lg:flex lg:w-96' : 'flex-1'}`}>
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <CandidateTable
                candidates={candidates}
                onSelect={setSelected}
                selectedId={selected?.id}
              />
            )}
          </div>

          {/* Detail Panel */}
          {selected ? (
            <div className="flex-1 bg-white overflow-hidden flex flex-col">
              <CandidateDetailPanel
                candidate={selected}
                onClose={() => setSelected(null)}
              />
            </div>
          ) : (
            <div className="hidden lg:flex flex-1 items-center justify-center bg-gray-50">
              <div className="text-center">
                <Users size={48} className="mx-auto text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Selecciona un candidato para ver su detalle</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateCandidateModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
    </DashboardLayout>
  );
}
