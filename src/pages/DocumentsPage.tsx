import { useState } from 'react';
import {
  FolderOpen,
  Search,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileSignature,
  FileText,
  ExternalLink,
  User,
} from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useCandidates } from '../hooks/useCandidates';
import { useFormQuestions } from '../hooks/useFormQuestions';
import { CandidateDocumentCard } from '../components/dashboard/CandidateDocumentCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { PARENTESCO_LABELS } from '../types';
import type { Candidate } from '../types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getCandidateDocTypes, computeCompletion } from '../utils/candidateCompletion';

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={15} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={15} className="text-gray-400 shrink-0" />
        )}
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider flex-1">
          {title}
        </span>
        {badge}
      </button>
      {open && <div className="px-4 py-4">{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <span className="text-xs text-gray-800 font-medium text-right">{value || '—'}</span>
    </div>
  );
}

// ─── Expediente ───────────────────────────────────────────────────────────────

function Expediente({ c }: { c: Candidate }) {
  const { questions: dynamicQuestions } = useFormQuestions();
  const a = c.formAnswers;
  const docTypes = getCandidateDocTypes(c);
  const validDocs = docTypes.filter((t) => c.documents[t]?.status === 'valid').length;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-3">
      {/* ── Header: candidate identity ─────────────────────────────── */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-12 h-12 rounded-2xl bg-primary-100 flex items-center justify-center shrink-0">
          <span className="text-primary-700 text-base font-semibold">
            {c.firstName[0]}{c.lastName[0]}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-900">
            {c.firstName} {c.lastName}
          </h2>
          <p className="text-xs text-gray-500 truncate">{c.position}</p>
          <div className="mt-1">
            <StatusBadge status={c.status} />
          </div>
        </div>
        {c.viterbitHiringManager && (
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Líder</p>
            <p className="text-xs text-gray-700 font-medium">{c.viterbitHiringManager}</p>
          </div>
        )}
      </div>

      {/* ── Respuestas ─────────────────────────────────────────────── */}
      <Section
        title="Respuestas"
        defaultOpen={!!a}
        badge={
          !a ? (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              Sin responder
            </span>
          ) : null
        }
      >
        {!a && (
          <p className="text-xs text-gray-400 italic">El candidato aún no ha respondido.</p>
        )}

        <div className="space-y-0.5">
          <Row label="Estado civil" value={
            a?.estadoCivil === 'soltero' ? 'Soltero/a' :
            a?.estadoCivil === 'casado' ? 'Casado/a' :
            a?.estadoCivil === 'union_libre' ? 'Unión Libre' : ''
          } />
          <Row label="¿Tiene hijos?" value={a?.tieneHijos === true ? 'Sí' : a?.tieneHijos === false ? 'No' : ''} />
          <Row label="INFONAVIT" value={a?.tieneInfonavit === true ? 'Sí' : a?.tieneInfonavit === false ? 'No' : ''} />
          <Row label="FONACOT" value={a?.tieneFonacot === true ? 'Sí' : a?.tieneFonacot === false ? 'No' : ''} />
          <Row label="Talla playera" value={a?.tallaPlayera ?? ''} />
          <Row label="Sobre ti" value={a?.sobreTi ?? ''} />
          <Row label="Entidad financiera previa" value={
            a?.trabajoEntidadFinanciera === true
              ? `Sí — ${a?.nombreEntidadFinanciera ?? ''}`
              : a?.trabajoEntidadFinanciera === false ? 'No' : ''
          } />
        </div>

        {/* Beneficiario */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Beneficiario</p>
          <div className="space-y-0.5">
            <Row label="Nombre" value={a?.beneficiarioNombre ?? ''} />
            <Row label="Teléfono" value={a?.beneficiarioTelefono ?? ''} />
            <Row label="Correo" value={a?.beneficiarioCorreo ?? ''} />
            <Row label="Parentesco" value={a?.beneficiarioParentesco ? PARENTESCO_LABELS[a.beneficiarioParentesco] : ''} />
          </div>
        </div>

        {/* Contacto 1 */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Contacto de emergencia 1</p>
          <div className="space-y-0.5">
            <Row label="Nombre" value={a?.contacto1Nombre ?? ''} />
            <Row label="Teléfono" value={a?.contacto1Telefono ?? ''} />
            <Row label="Correo" value={a?.contacto1Correo ?? ''} />
            <Row label="Parentesco" value={a?.contacto1Parentesco ? PARENTESCO_LABELS[a.contacto1Parentesco] : ''} />
          </div>
        </div>

        {/* Contacto 2 */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Contacto de emergencia 2</p>
          <div className="space-y-0.5">
            <Row label="Nombre" value={a?.contacto2Nombre ?? ''} />
            <Row label="Teléfono" value={a?.contacto2Telefono ?? ''} />
            <Row label="Correo" value={a?.contacto2Correo ?? ''} />
            <Row label="Parentesco" value={a?.contacto2Parentesco ? PARENTESCO_LABELS[a.contacto2Parentesco] : ''} />
          </div>
        </div>

        {/* Dynamic questions — only shown when candidate actually has customAnswers for them */}
        {dynamicQuestions.length > 0 && dynamicQuestions.some((q) => (a?.customAnswers ?? {})[q.id]) && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Preguntas adicionales</p>
            <div className="space-y-0.5">
              {dynamicQuestions
                .filter((q) => (a?.customAnswers ?? {})[q.id])
                .map((q) => (
                  <Row key={q.id} label={q.label} value={(a?.customAnswers ?? {})[q.id] ?? ''} />
                ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── Carta Oferta ───────────────────────────────────────────── */}
      <Section
        title="Carta Oferta"
        defaultOpen={!!c.offerPdfUrl || !!c.offerToken}
        badge={
          c.offerSignedAt ? (
            <span className="flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              <CheckCircle size={10} /> Firmada
            </span>
          ) : c.offerToken ? (
            <span className="flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              <AlertTriangle size={10} /> Pendiente
            </span>
          ) : null
        }
      >
        {!c.offerToken && !c.offerPdfUrl ? (
          <p className="text-xs text-gray-400 italic">
            La carta oferta se genera cuando el candidato avanza al stage correspondiente en Viterbit.
          </p>
        ) : (
          <div className="space-y-2">
            {c.offerSignedAt && (
              <p className="text-xs text-green-700 font-medium">
                Firmada el {format(c.offerSignedAt.toDate(), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })}
              </p>
            )}
            {c.offerPdfUrl && (
              <a
                href={c.offerPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary-700 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2.5 hover:bg-primary-100 transition-colors"
              >
                <FileSignature size={14} />
                <span className="font-medium flex-1">Carta oferta firmada (PDF)</span>
                <ExternalLink size={12} />
              </a>
            )}
            {c.offerSignatureUrl && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Firma digital</p>
                <img
                  src={c.offerSignatureUrl}
                  alt="Firma"
                  className="max-h-16 bg-white border border-gray-200 rounded-lg p-2"
                />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── Contrato ───────────────────────────────────────────────── */}
      <Section
        title="Contrato"
        defaultOpen={!!c.contractPdfUrl || !!c.contractToken}
        badge={
          c.contractSignedAt ? (
            <span className="flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              <CheckCircle size={10} /> Firmado
            </span>
          ) : c.contractToken ? (
            <span className="flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              Enviado
            </span>
          ) : null
        }
      >
        {!c.contractToken && !c.contractPdfUrl ? (
          <p className="text-xs text-gray-400 italic">
            El contrato se genera cuando el candidato avanza al stage de "Contrato" en Viterbit.
          </p>
        ) : (
          <div className="space-y-2">
            {c.contractSignedAt && (
              <p className="text-xs text-green-700 font-medium">
                Firmado el {format(c.contractSignedAt.toDate(), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })}
              </p>
            )}
            {c.contractPdfUrl && (
              <a
                href={c.contractPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary-700 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2.5 hover:bg-primary-100 transition-colors"
              >
                <FileText size={14} />
                <span className="font-medium flex-1">Contrato firmado (PDF)</span>
                <ExternalLink size={12} />
              </a>
            )}
            {c.contractEvidenceUrl && (
              <a
                href={c.contractEvidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 hover:bg-indigo-100 transition-colors"
              >
                <FileText size={14} />
                <span className="font-medium flex-1">Certificado FES (SHA-256)</span>
                <ExternalLink size={12} />
              </a>
            )}
            {c.contractSignatureUrl && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Firma digital</p>
                <img
                  src={c.contractSignatureUrl}
                  alt="Firma"
                  className="max-h-16 bg-white border border-gray-200 rounded-lg p-2"
                />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── Documentos ─────────────────────────────────────────────── */}
      <Section
        title="Documentos"
        defaultOpen
        badge={
          <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">
            {validDocs}/{docTypes.length}
          </span>
        }
      >
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">{computeCompletion(c)}% completado</span>
            <span className="text-xs text-gray-400">{validDocs}/{docTypes.length} válidos</span>
          </div>
          <ProgressBar percentage={computeCompletion(c)} showLabel={false} />
        </div>

        <div className="space-y-2">
          {docTypes.map((type) => {
            const docItem = c.documents[type];
            return (
              <CandidateDocumentCard
                key={type}
                candidateId={c.id}
                type={type}
                doc={docItem ?? { id: type, type, status: 'pending' }}
              />
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ─── Candidate list item ──────────────────────────────────────────────────────

function CandidateItem({
  c,
  selected,
  onClick,
}: {
  c: Candidate;
  selected: boolean;
  onClick: () => void;
}) {
  const docTypes = getCandidateDocTypes(c);
  const valid = docTypes.filter((t) => c.documents[t]?.status === 'valid').length;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-lg transition-colors ${
        selected
          ? 'bg-primary-50 border border-primary-200'
          : 'hover:bg-gray-50 border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-primary-700 text-[10px] font-semibold">
            {c.firstName[0]}{c.lastName[0]}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {c.firstName} {c.lastName}
          </p>
          <p className="text-[11px] text-gray-400 truncate">{c.position}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="flex-1 bg-gray-100 rounded-full h-1 overflow-hidden">
              <div
                className="h-full bg-primary-400 rounded-full transition-all"
                style={{ width: `${computeCompletion(c)}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-400 shrink-0">
              {valid}/{docTypes.length}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const { candidates, loading } = useCandidates();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = candidates.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.position.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  // Summary stats across all candidates
  const allDocRows = candidates.flatMap((c) =>
    getCandidateDocTypes(c).map((t) => c.documents[t])
  ).filter(Boolean);
  const totalValid   = allDocRows.filter((d) => d?.status === 'valid').length;
  const totalInvalid = allDocRows.filter((d) => d?.status === 'invalid').length;
  const totalReview  = allDocRows.filter((d) => d?.status === 'review' || d?.status === 'uploaded').length;

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col overflow-hidden">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Expedientes</h2>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <CheckCircle size={12} className="text-green-600" /> {totalValid} válidos
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle size={12} className="text-yellow-500" /> {totalReview} en revisión
            </span>
            <span className="flex items-center gap-1 text-red-500">
              {totalInvalid} inválidos
            </span>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">

          {/* Left: candidate list */}
          <div className="w-64 shrink-0 border-r border-gray-100 flex flex-col bg-white overflow-hidden">
            {/* Search */}
            <div className="p-3 border-b border-gray-100">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar candidato…"
                  className="input-field pl-8 text-xs py-2"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">Sin candidatos</p>
              ) : (
                filtered.map((c) => (
                  <CandidateItem
                    key={c.id}
                    c={c}
                    selected={selected?.id === c.id}
                    onClick={() => setSelectedId(c.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: expediente */}
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
            {selected ? (
              <Expediente key={selected.id} c={selected} />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <User size={28} className="text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-500 font-medium">Selecciona un candidato</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Su expediente completo aparecerá aquí.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
