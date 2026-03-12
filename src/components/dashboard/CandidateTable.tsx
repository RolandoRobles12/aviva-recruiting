import { useState } from 'react';
import { Search, ChevronRight, Users } from 'lucide-react';
import type { Candidate, CandidateStatus } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { EmptyState } from '../ui/EmptyState';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const STATUS_FILTERS: { value: CandidateStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'offer_sent', label: 'Carta enviada' },
  { value: 'offer_signed', label: 'Carta firmada' },
  { value: 'invited', label: 'Invitados' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'under_review', label: 'En revisión' },
  { value: 'approved', label: 'Aprobados' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'rejected', label: 'Rechazados' },
];

interface Props {
  candidates: Candidate[];
  onSelect: (candidate: Candidate) => void;
  selectedId?: string;
}

export function CandidateTable({ candidates, onSelect, selectedId }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | 'all'>('all');

  const filtered = candidates.filter((c) => {
    const matchSearch =
      !search ||
      `${c.firstName} ${c.lastName} ${c.email} ${c.position}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="p-4 border-b border-gray-100 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar candidato..."
            className="input-field pl-9 text-sm"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={40} />}
            title="Sin candidatos"
            description={
              search
                ? 'No se encontraron resultados para tu búsqueda.'
                : 'Aún no hay candidatos en esta categoría.'
            }
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {filtered.map((c) => {
              const createdAt = c.createdAt?.toDate?.();
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onSelect(c)}
                    className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                      selectedId === c.id ? 'bg-primary-50 border-l-2 border-primary-500' : ''
                    }`}
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                      <span className="text-primary-700 text-sm font-semibold">
                        {c.firstName[0]}{c.lastName[0]}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {c.firstName} {c.lastName}
                        </p>
                        <StatusBadge status={c.status} type="candidate" />
                      </div>
                      <p className="text-xs text-gray-500 truncate">{c.position}</p>
                      <div className="mt-1.5">
                        <ProgressBar percentage={c.completionPercentage} showLabel={false} size="sm" />
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-gray-400 truncate">{c.email}</p>
                        {createdAt && (
                          <p className="text-xs text-gray-400 shrink-0">
                            {format(createdAt, 'd MMM', { locale: es })}
                          </p>
                        )}
                      </div>
                    </div>

                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
