import { useState } from 'react';
import {
  Users,
  UserPlus,
  FileSignature,
  FolderOpen,
  FileText,
  Mail,
  GraduationCap,
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { CandidateTable } from '../components/dashboard/CandidateTable';
import { CandidateDetailPanel } from '../components/dashboard/CandidateDetailPanel';
import { CreateCandidateModal } from '../components/dashboard/CreateCandidateModal';
import { useCandidates } from '../hooks/useCandidates';
import type { Candidate } from '../types';

export function DashboardPage() {
  const { candidates, loading } = useCandidates();
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const pipelineStats = {
    total: candidates.length,
    offer: candidates.filter((c) => c.status === 'offer_sent' || c.status === 'offer_signed').length,
    documentos: candidates.filter((c) =>
      ['invited', 'in_progress', 'under_review', 'approved', 'rejected'].includes(c.status)
    ).length,
    contrato: candidates.filter((c) => c.status === 'contract_sent' || c.status === 'contract_signed').length,
    correos: candidates.filter((c) => c.status === 'email_pending' || c.status === 'email_ready').length,
    induccion: candidates.filter((c) => c.status === 'induction').length,
  };

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header + Stats */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">Candidatos</h2>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3"
            >
              <UserPlus size={14} />
              Nuevo candidato
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatChip icon={<Users size={13} />} label="Total" value={pipelineStats.total} color="gray" />
            <StatChip icon={<FileSignature size={13} />} label="Carta oferta" value={pipelineStats.offer} color="purple" />
            <StatChip icon={<FolderOpen size={13} />} label="Documentos" value={pipelineStats.documentos} color="amber" />
            <StatChip icon={<FileText size={13} />} label="Contrato" value={pipelineStats.contrato} color="indigo" />
            <StatChip icon={<Mail size={13} />} label="Correos" value={pipelineStats.correos} color="teal" />
            <StatChip icon={<GraduationCap size={13} />} label="Inducción" value={pipelineStats.induccion} color="rose" />
          </div>
        </div>

        {/* Full-width candidate list */}
        <div className="flex-1 overflow-hidden bg-white">
          {loading ? (
            <div className="flex-1 flex items-center justify-center h-full">
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
      </div>

      {/* ── Slide-over drawer ──────────────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 transition-opacity"
            onClick={() => setSelected(null)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-4xl bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <CandidateDetailPanel
              candidate={selected}
              onClose={() => setSelected(null)}
            />
          </div>
        </div>
      )}

      <CreateCandidateModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
    </DashboardLayout>
  );
}

/* ─── Compact stat chip ──────────────────────────────────────────────────── */

const CHIP_COLORS: Record<string, string> = {
  gray:   'bg-gray-100 text-gray-700',
  purple: 'bg-purple-50 text-purple-700',
  amber:  'bg-amber-50 text-amber-700',
  blue:   'bg-blue-50 text-blue-700',
  green:  'bg-green-50 text-green-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  teal:   'bg-teal-50 text-teal-700',
  rose:   'bg-rose-50 text-rose-700',
};

function StatChip({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${CHIP_COLORS[color] ?? CHIP_COLORS.gray}`}>
      {icon}
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
