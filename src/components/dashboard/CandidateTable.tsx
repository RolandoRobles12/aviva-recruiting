import { useState } from 'react';
import { Search, Users } from 'lucide-react';
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
  { value: 'contract_sent', label: 'Contrato enviado' },
  { value: 'contract_signed', label: 'Contrato firmado' },
  { value: 'email_pending', label: 'Correo pendiente' },
  { value: 'email_ready', label: 'Correo listo' },
  { value: 'induction', label: 'Inducción' },
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
      <div className="px-5 py-3 border-b border-gray-100 space-y-3 shrink-0">
        <div className="relative max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar candidato..."
            className="input-field pl-9 text-sm"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
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

      {/* Table */}
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
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-100 text-left">
                <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Candidato</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Puesto</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Documentos</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((c) => {
                const createdAt = c.createdAt?.toDate?.();
                return (
                  <tr
                    key={c.id}
                    onClick={() => onSelect(c)}
                    className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                      selectedId === c.id ? 'bg-primary-50' : ''
                    }`}
                  >
                    {/* Candidate */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                          <span className="text-primary-700 text-xs font-semibold">
                            {c.firstName[0]}{c.lastName[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {c.firstName} {c.lastName}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{c.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Position */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-sm text-gray-600 truncate max-w-[200px]">{c.position}</p>
                    </td>

                    {/* Documents progress */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="w-32">
                        <ProgressBar percentage={c.completionPercentage} size="sm" />
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} type="candidate" />
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs text-gray-400">
                        {createdAt ? format(createdAt, 'd MMM', { locale: es }) : '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
