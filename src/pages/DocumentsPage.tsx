import { useState } from 'react';
import {
  FolderOpen,
  Search,
  Eye,
  Download,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Filter,
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useCandidates } from '../hooks/useCandidates';
import { DOCUMENT_CONFIG, DOCUMENT_TYPES } from '../types';
import type { DocumentType, DocumentStatus, CandidateDocument, Candidate } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type DocRow = {
  candidate: Candidate;
  type: DocumentType;
  doc: CandidateDocument;
};

const STATUS_ICONS: Record<DocumentStatus, React.ReactNode> = {
  pending:  <Clock size={13} className="text-gray-400" />,
  uploaded: <RefreshCw size={13} className="text-blue-500 animate-spin" />,
  valid:    <CheckCircle size={13} className="text-green-600" />,
  invalid:  <XCircle size={13} className="text-red-500" />,
  review:   <AlertTriangle size={13} className="text-yellow-500" />,
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  pending:  'Pendiente',
  uploaded: 'Validando...',
  valid:    'Válido',
  invalid:  'Inválido',
  review:   'Rev. manual',
};

const STATUS_BADGE_CLASS: Record<DocumentStatus, string> = {
  pending:  'bg-gray-100 text-gray-600',
  uploaded: 'bg-blue-50 text-blue-700',
  valid:    'bg-green-50 text-green-700',
  invalid:  'bg-red-50 text-red-700',
  review:   'bg-yellow-50 text-yellow-700',
};

type StatusFilter = DocumentStatus | 'all';
type TypeFilter = DocumentType | 'all';

export function DocumentsPage() {
  const { candidates, loading } = useCandidates();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // Build flat list of all documents
  const allDocs: DocRow[] = [];
  for (const c of candidates) {
    for (const type of DOCUMENT_TYPES) {
      const doc = c.documents[type];
      if (doc && doc.status !== 'pending') {
        allDocs.push({ candidate: c, type, doc });
      }
    }
  }

  // Sort by upload date descending
  allDocs.sort((a, b) => {
    const da = a.doc.uploadedAt?.toDate?.()?.getTime() ?? 0;
    const db = b.doc.uploadedAt?.toDate?.()?.getTime() ?? 0;
    return db - da;
  });

  const filtered = allDocs.filter((row) => {
    if (statusFilter !== 'all' && row.doc.status !== statusFilter) return false;
    if (typeFilter !== 'all' && row.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${row.candidate.firstName} ${row.candidate.lastName}`.toLowerCase();
      const docLabel = DOCUMENT_CONFIG[row.type].label.toLowerCase();
      if (!name.includes(q) && !docLabel.includes(q) && !row.candidate.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Summary stats
  const totalUploaded = allDocs.length;
  const totalValid = allDocs.filter((r) => r.doc.status === 'valid').length;
  const totalInvalid = allDocs.filter((r) => r.doc.status === 'invalid').length;
  const totalReview = allDocs.filter((r) => r.doc.status === 'review' || r.doc.status === 'uploaded').length;

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-primary-600" />
              <h2 className="text-base font-semibold text-gray-900">Documentos</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-600" /> {totalValid} válidos</span>
              <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-yellow-500" /> {totalReview} en revisión</span>
              <span className="flex items-center gap-1"><XCircle size={12} className="text-red-500" /> {totalInvalid} inválidos</span>
              <span className="text-gray-300">|</span>
              <span>{totalUploaded} total</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por candidato o documento..."
                className="input-field pl-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Filter size={13} className="text-gray-400" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="all">Todos los tipos</option>
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{DOCUMENT_CONFIG[t].label}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="all">Todos los estados</option>
                <option value="valid">Válido</option>
                <option value="uploaded">Validando</option>
                <option value="review">Revisión manual</option>
                <option value="invalid">Inválido</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto bg-white">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <FolderOpen size={24} className="text-gray-300" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Sin documentos</p>
              <p className="text-xs text-gray-400 mt-1">
                {search || statusFilter !== 'all' || typeFilter !== 'all'
                  ? 'No se encontraron documentos con estos filtros.'
                  : 'Los documentos aparecerán aquí cuando los candidatos los suban.'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-100 text-left">
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Candidato</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Documento</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Archivo</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Fecha</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((row) => {
                  const uploadedAt = row.doc.uploadedAt?.toDate?.();
                  return (
                    <tr key={`${row.candidate.id}-${row.type}`} className="hover:bg-gray-50 transition-colors">
                      {/* Candidate */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                            <span className="text-primary-700 text-[10px] font-semibold">
                              {row.candidate.firstName[0]}{row.candidate.lastName[0]}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {row.candidate.firstName} {row.candidate.lastName}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate">{row.candidate.position}</p>
                          </div>
                        </div>
                      </td>

                      {/* Document type */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700">{DOCUMENT_CONFIG[row.type].label}</span>
                      </td>

                      {/* Filename */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-gray-400 truncate max-w-[180px] block">
                          {row.doc.fileName ?? '—'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_CLASS[row.doc.status]}`}>
                          {STATUS_ICONS[row.doc.status]}
                          {STATUS_LABELS[row.doc.status]}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-xs text-gray-400">
                          {uploadedAt ? format(uploadedAt, 'd MMM yyyy', { locale: es }) : '—'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {row.doc.downloadUrl && (
                            <>
                              <a
                                href={row.doc.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                title="Ver documento"
                              >
                                <Eye size={14} />
                              </a>
                              <a
                                href={row.doc.downloadUrl}
                                download
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Descargar"
                              >
                                <Download size={14} />
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
