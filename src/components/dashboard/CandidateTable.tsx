import { useState, useMemo } from 'react';
import { Search, Users, ChevronDown } from 'lucide-react';
import type { Candidate, CandidateStatus } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { EmptyState } from '../ui/EmptyState';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { computeCompletion } from '../../utils/candidateCompletion';

// Pipeline stages matching Viterbit: Documentos → Contrato → Correos → Onboarding → Onboarding Iniciado → Promotor Exitoso
// Each filter groups related sub-statuses together
type FilterValue = 'all' | 'documentos' | 'contrato' | 'correos' | 'induction' | 'onboarding_iniciado' | 'promotor_exitoso' | 'bajo_desempeno' | 'offer' | 'descalificados';

const STATUS_FILTERS: { value: FilterValue; label: string; statuses: CandidateStatus[] }[] = [
  { value: 'all',                label: 'Todos',               statuses: [] },
  { value: 'offer',              label: 'Carta oferta',        statuses: ['offer_sent', 'offer_signed'] },
  { value: 'documentos',        label: 'Documentos',          statuses: ['invited', 'in_progress', 'under_review', 'approved', 'rejected'] },
  { value: 'contrato',          label: 'Contrato',            statuses: ['contract_sent', 'contract_signed'] },
  { value: 'correos',           label: 'Correos',             statuses: ['email_pending', 'email_ready'] },
  { value: 'induction',         label: 'Onboarding',          statuses: ['induction'] },
  { value: 'onboarding_iniciado', label: 'Onboarding Iniciado', statuses: ['onboarding_iniciado'] },
  { value: 'promotor_exitoso',  label: 'Promotor Exitoso',    statuses: ['promotor_exitoso'] },
  { value: 'bajo_desempeno',    label: 'Bajo Desempeño',      statuses: ['bajo_desempeno'] },
  { value: 'descalificados',    label: 'Descalificados',      statuses: ['disqualified'] },
];

function PositionCell({ position }: { position: string }) {
  // Split on " - " to separate role from store/location suffix
  const dashIdx = position.indexOf(' - ');
  if (dashIdx !== -1) {
    const role = position.slice(0, dashIdx);
    const suffix = position.slice(dashIdx + 3);
    return (
      <div title={position}>
        <p className="text-sm text-gray-700 leading-snug">{role}</p>
        <p className="text-xs text-gray-400 leading-snug">{suffix}</p>
      </div>
    );
  }
  return <p className="text-sm text-gray-600 leading-snug" title={position}>{position}</p>;
}

interface Props {
  candidates: Candidate[];
  onSelect: (candidate: Candidate) => void;
  selectedId?: string;
}

export function CandidateTable({ candidates, onSelect, selectedId }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all');
  const [profileFilter, setProfileFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState('');

  const uniqueProfiles = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((c) => {
      const p = c.profile ?? c.viterbitDepartmentProfile;
      if (p) set.add(p);
    });
    return Array.from(set).sort();
  }, [candidates]);

  const uniquePositions = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((c) => {
      if (c.position) {
        const dashIdx = c.position.indexOf(' - ');
        set.add(dashIdx !== -1 ? c.position.slice(0, dashIdx) : c.position);
      }
    });
    return Array.from(set).sort();
  }, [candidates]);

  const activeFilter = STATUS_FILTERS.find((f) => f.value === statusFilter);
  const filtered = candidates.filter((c) => {
    const matchSearch =
      !search ||
      `${c.firstName} ${c.lastName} ${c.email} ${c.position}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || (activeFilter?.statuses.includes(c.status) ?? false);
    const matchProfile =
      !profileFilter ||
      (c.profile ?? c.viterbitDepartmentProfile) === profileFilter;
    const matchPosition =
      !positionFilter ||
      (() => {
        const dashIdx = c.position?.indexOf(' - ') ?? -1;
        const role = dashIdx !== -1 ? c.position.slice(0, dashIdx) : c.position;
        return role === positionFilter;
      })();
    return matchSearch && matchStatus && matchProfile && matchPosition;
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
        <div className="flex gap-2 flex-wrap">
          {/* Profile filter */}
          <div className="relative">
            <select
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Perfil</option>
              {uniqueProfiles.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Position filter */}
          <div className="relative">
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Posición</option>
              {uniquePositions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map((f) => {
            const count = f.value === 'all'
              ? candidates.length
              : candidates.filter((c) => f.statuses.includes(c.status)).length;
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === f.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
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
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Posición</th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden xl:table-cell">Perfil</th>
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
                    <td className="px-4 py-3 hidden md:table-cell max-w-[220px]">
                      <PositionCell position={c.position} />
                    </td>

                    {/* Profile */}
                    <td className="px-4 py-3 hidden xl:table-cell max-w-[180px]">
                      {(c.profile ?? c.viterbitDepartmentProfile) ? (
                        <span
                          title={c.profile ?? c.viterbitDepartmentProfile}
                          className="inline-block px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium leading-snug break-words whitespace-normal"
                        >
                          {c.profile ?? c.viterbitDepartmentProfile}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>

                    {/* Documents progress */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="w-32">
                        <ProgressBar percentage={computeCompletion(c)} size="sm" />
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
