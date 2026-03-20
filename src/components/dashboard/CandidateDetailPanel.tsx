import { useState, useEffect } from 'react';
import {
  X,
  Mail,
  Phone,
  Briefcase,
  Send,
  CheckCircle,
  XCircle,
  ExternalLink,
  Copy,
  Check,
  FileText,
  Calendar,
  User,
  RefreshCw,
  AlertTriangle,
  FolderOpen,
  FileSignature,
  ClipboardList,
  Users,
} from 'lucide-react';
import { PARENTESCO_LABELS } from '../../types';
import type { Candidate } from '../../types';
import { getCandidateDocTypes, computeCompletion } from '../../utils/candidateCompletion';
import { useFormQuestions } from '../../hooks/useFormQuestions';
import { StatusBadge } from '../ui/StatusBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { CandidateDocumentCard } from './CandidateDocumentCard';
import {
  sendReminderEmail,
  provisionAccountsManual,
  sendOfferEmail,
} from '../../services/functions';
import type { ProvisionResult } from '../../services/functions';
import { updateCandidateStatus, updateCandidateNotes, extendFormToken } from '../../services/candidates';
import { getLinkDurationSettings } from '../../services/settings';
import { sendInvitationEmail } from '../../services/functions';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  candidate: Candidate;
  onClose: () => void;
}

type TabId = 'info' | 'answers' | 'docs' | 'offer' | 'contract' | 'accounts';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'info',     label: 'Info',        icon: <User size={14} /> },
  { id: 'offer',    label: 'Carta Oferta', icon: <FileSignature size={14} /> },
  { id: 'answers',  label: 'Respuestas',  icon: <ClipboardList size={14} /> },
  { id: 'docs',     label: 'Documentos',  icon: <FolderOpen size={14} /> },
  { id: 'contract', label: 'Contrato',    icon: <ClipboardList size={14} /> },
  { id: 'accounts', label: 'Cuentas',     icon: <Users size={14} /> },
];

export function CandidateDetailPanel({ candidate: c, onClose }: Props) {
  const [tab, setTab] = useState<TabId>('info');
  const [sendingReminder, setSendingReminder] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [extendingToken, setExtendingToken] = useState(false);
  const [tokenExtended, setTokenExtended] = useState(false);
  const [corpEmail, setCorpEmail] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null);
  const [provisionError, setProvisionError] = useState('');

  // Reset tab/notes when candidate changes
  useEffect(() => {
    setNotes(c.notes ?? '');
    setTab('info');
    setCorpEmail('');
    setProvisionResult(null);
    setProvisionError('');
  }, [c.id]);

  const formUrl = c.formToken ? `${window.location.origin}/form/${c.formToken}` : null;
  const offerUrl = c.offerToken ? `${window.location.origin}/offer/${c.offerToken}` : null;
  const contractUrl = c.contractToken ? `${window.location.origin}/contract/${c.contractToken}` : null;

  const formExpired = c.formExpiresAt?.toDate
    ? c.formExpiresAt.toDate() < new Date()
    : false;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendReminder = async () => {
    setSendingReminder(true);
    try {
      await sendReminderEmail({ candidateId: c.id });
    } finally {
      setSendingReminder(false);
    }
  };

  const handleApprove = () => updateCandidateStatus(c.id, 'approved');
  const handleReject = () => updateCandidateStatus(c.id, 'rejected');

  const handleExtendToken = async () => {
    setExtendingToken(true);
    try {
      const linkSettings = await getLinkDurationSettings();
      await extendFormToken(c.id, linkSettings.formDays);
      await sendInvitationEmail({ candidateId: c.id });
      setTokenExtended(true);
      setTimeout(() => setTokenExtended(false), 4000);
    } finally {
      setExtendingToken(false);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await updateCandidateNotes(c.id, notes);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleProvision = async () => {
    if (!corpEmail.trim()) return;
    setProvisioning(true);
    setProvisionError('');
    setProvisionResult(null);
    try {
      const res = await provisionAccountsManual({
        candidateId: c.id,
        corporateEmail: corpEmail.trim(),
        skipSlack: true,
      });
      setProvisionResult(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setProvisionError(msg);
    } finally {
      setProvisioning(false);
    }
  };

  const createdAt = c.createdAt?.toDate?.();
  const updatedAt = c.updatedAt?.toDate?.();

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
            <span className="text-primary-700 text-sm font-bold">
              {c.firstName[0]}{c.lastName[0]}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">
              {c.firstName} {c.lastName}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={c.status} type="candidate" />
              {createdAt && (
                <span className="text-[11px] text-gray-400">
                  {format(createdAt, "d MMM yyyy", { locale: es })}
                </span>
              )}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* ── Two-column body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Tabs + content */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-100">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 px-5 shrink-0 bg-gray-50/50">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.id
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {tab === 'info' && (
              <TabInfo
                c={c}
                notes={notes}
                setNotes={setNotes}
                savingNotes={savingNotes}
                onSaveNotes={handleSaveNotes}
              />
            )}
            {tab === 'answers' && <TabAnswers c={c} />}
            {tab === 'docs' && (
              <TabDocs
                c={c}
                formUrl={formUrl}
                formExpired={formExpired}
                copied={copied}
                onCopy={copyToClipboard}
                extendingToken={extendingToken}
                tokenExtended={tokenExtended}
                onExtendToken={handleExtendToken}
              />
            )}
            {tab === 'offer' && (
              <TabOffer c={c} offerUrl={offerUrl} copied={copied} onCopy={copyToClipboard} />
            )}
            {tab === 'contract' && (
              <TabContract c={c} contractUrl={contractUrl} copied={copied} onCopy={copyToClipboard} />
            )}
            {tab === 'accounts' && (
              <TabAccounts
                c={c}
                corpEmail={corpEmail}
                setCorpEmail={setCorpEmail}
                provisioning={provisioning}
                provisionResult={provisionResult}
                provisionError={provisionError}
                onProvision={handleProvision}
              />
            )}
          </div>
        </div>

        {/* Right sidebar: Links & quick actions — always visible */}
        <div className="w-72 shrink-0 overflow-y-auto bg-gray-50/50 p-4 space-y-4">
          {/* Document form link */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
              <FolderOpen size={13} className="text-amber-500" />
              Enlace de documentación
            </h4>
            {formUrl ? (
              <>
                {formExpired ? (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mb-2">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>
                      Venció el{' '}
                      {c.formExpiresAt?.toDate
                        ? format(c.formExpiresAt.toDate(), "d MMM yyyy", { locale: es })
                        : '—'}
                    </span>
                  </div>
                ) : c.formExpiresAt?.toDate && (
                  <p className="text-[11px] text-gray-400 mb-2">
                    Vigente hasta {format(c.formExpiresAt.toDate(), "d MMM yyyy", { locale: es })}
                  </p>
                )}
                <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 border text-xs ${
                  formExpired ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
                }`}>
                  <span className="flex-1 truncate font-mono text-gray-500">{formUrl}</span>
                  <button onClick={() => copyToClipboard(formUrl)} className="text-primary-600 hover:text-primary-700 shrink-0" title="Copiar">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <a href={formUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0" title="Abrir">
                    <ExternalLink size={13} />
                  </a>
                </div>
                {formExpired && c.status !== 'approved' && c.status !== 'rejected' && (
                  <button
                    onClick={handleExtendToken}
                    disabled={extendingToken}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 bg-amber-600 text-white px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors disabled:opacity-60"
                  >
                    <RefreshCw size={12} className={extendingToken ? 'animate-spin' : ''} />
                    {extendingToken ? 'Renovando...' : tokenExtended ? 'Renovado!' : 'Renovar enlace'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">
                El enlace se genera cuando el candidato firma la carta oferta o se crea manualmente.
              </p>
            )}
          </div>

          {/* Offer link */}
          {offerUrl && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
                <FileSignature size={13} className="text-purple-500" />
                Carta oferta
              </h4>
              <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 border bg-gray-50 border-gray-200 text-xs">
                <span className="flex-1 truncate font-mono text-gray-500">{offerUrl}</span>
                <button onClick={() => copyToClipboard(offerUrl)} className="text-primary-600 hover:text-primary-700 shrink-0" title="Copiar">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <a href={offerUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0" title="Abrir">
                  <ExternalLink size={13} />
                </a>
              </div>
              {c.offerSignedAt && (
                <p className="text-[11px] text-green-600 mt-1.5 flex items-center gap-1">
                  <CheckCircle size={11} /> Firmada
                </p>
              )}
            </div>
          )}

          {/* Contract link */}
          {contractUrl && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
                <ClipboardList size={13} className="text-indigo-500" />
                Contrato
              </h4>
              <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 border bg-gray-50 border-gray-200 text-xs">
                <span className="flex-1 truncate font-mono text-gray-500">{contractUrl}</span>
                <button onClick={() => copyToClipboard(contractUrl)} className="text-primary-600 hover:text-primary-700 shrink-0" title="Copiar">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <a href={contractUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0" title="Abrir">
                  <ExternalLink size={13} />
                </a>
              </div>
              {c.contractSignedAt && (
                <p className="text-[11px] text-green-600 mt-1.5 flex items-center gap-1">
                  <CheckCircle size={11} /> Firmado
                </p>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">Acciones rápidas</h4>
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder || c.status === 'approved' || c.status === 'rejected'}
              className="w-full btn-secondary text-xs flex items-center justify-center gap-2 py-2"
            >
              <Send size={12} />
              {sendingReminder ? 'Enviando...' : 'Enviar recordatorio'}
            </button>
            {c.status === 'under_review' && (
              <div className="flex gap-2">
                <button
                  onClick={handleApprove}
                  className="flex-1 flex items-center justify-center gap-1 bg-green-600 text-white px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                >
                  <CheckCircle size={12} /> Aprobar
                </button>
                <button
                  onClick={handleReject}
                  className="flex-1 flex items-center justify-center gap-1 bg-red-600 text-white px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-red-700 transition-colors"
                >
                  <XCircle size={12} /> Rechazar
                </button>
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="text-[11px] text-gray-400 space-y-0.5 px-1">
            {createdAt && <p>Creado: {format(createdAt, "d MMM yyyy HH:mm", { locale: es })}</p>}
            {updatedAt && <p>Actualizado: {format(updatedAt, "d MMM yyyy HH:mm", { locale: es })}</p>}
            <p>Recordatorios: {c.reminderCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Info
   ═══════════════════════════════════════════════════════════════════════════ */

function TabInfo({ c, notes, setNotes, savingNotes, onSaveNotes }: {
  c: Candidate;
  notes: string;
  setNotes: (v: string) => void;
  savingNotes: boolean;
  onSaveNotes: () => void;
}) {
  return (
    <div className="px-5 py-4 space-y-5">
      {/* Contact */}
      <Section title="Contacto">
        <div className="space-y-1.5">
          <InfoRow icon={<Mail size={13} />}>
            <a href={`mailto:${c.email}`} className="hover:text-primary-600 text-sm">{c.email}</a>
          </InfoRow>
          {c.phone && (
            <InfoRow icon={<Phone size={13} />}>
              <span className="text-sm">{c.phone}</span>
            </InfoRow>
          )}
          <InfoRow icon={<Briefcase size={13} />}>
            <span className="text-sm font-medium">{c.position}</span>
          </InfoRow>
        </div>
      </Section>

      {/* Viterbit data */}
      {(c.viterbitStartDate || c.viterbitHiringManager) && (
        <Section title="Datos del puesto (Viterbit)">
          <div className="grid grid-cols-2 gap-3">
            {c.viterbitHiringManager && (
              <DataCell icon={<User size={12} />} label="Líder" value={c.viterbitHiringManager} />
            )}
            {c.viterbitStartDate && (
              <DataCell icon={<Calendar size={12} />} label="Inicio" value={c.viterbitStartDate} />
            )}
          </div>
        </Section>
      )}

      {/* Notes */}
      <Section title="Notas internas">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Agrega notas sobre el candidato..."
          className="input-field text-xs resize-none"
        />
        <button
          onClick={onSaveNotes}
          disabled={savingNotes}
          className="mt-2 btn-secondary text-xs w-full py-1.5"
        >
          {savingNotes ? 'Guardando...' : 'Guardar notas'}
        </button>
      </Section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Documentos
   ═══════════════════════════════════════════════════════════════════════════ */

function TabDocs({ c, formUrl, formExpired, copied, onCopy, extendingToken, tokenExtended, onExtendToken }: {
  c: Candidate;
  formUrl: string | null;
  formExpired: boolean;
  copied: boolean;
  onCopy: (text: string) => void;
  extendingToken: boolean;
  tokenExtended: boolean;
  onExtendToken: () => void;
}) {
  return (
    <div className="px-5 py-4 space-y-5">
      {/* Progress */}
      <Section title="Progreso de documentación">
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500">{computeCompletion(c)}% completado</span>
            <span className="text-xs text-gray-400">
              {getCandidateDocTypes(c).filter((t) => c.documents[t]?.status === 'valid').length}/{getCandidateDocTypes(c).length} documentos
            </span>
          </div>
          <ProgressBar percentage={computeCompletion(c)} showLabel={false} />
        </div>
      </Section>

      {/* Document cards */}
      <Section title="Documentos">
        <div className="space-y-2">
          {getCandidateDocTypes(c).map((type) => {
            const docItem = c.documents[type];
            return (
              <CandidateDocumentCard
                key={type}
                type={type}
                doc={docItem ?? { id: type, type, status: 'pending' }}
              />
            );
          })}
        </div>
      </Section>

      {/* Form link */}
      {formUrl && (
        <Section title="Enlace del formulario">
          {formExpired && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                El enlace venció el{' '}
                {c.formExpiresAt?.toDate
                  ? format(c.formExpiresAt.toDate(), "d MMM yyyy", { locale: es })
                  : '—'}
                . El candidato ya no puede subir documentos.
              </span>
            </div>
          )}

          <LinkBox
            url={formUrl}
            expired={formExpired}
            copied={copied}
            onCopy={() => onCopy(formUrl)}
          />

          {!formExpired && c.formExpiresAt?.toDate && (
            <p className="text-[11px] text-gray-400 mt-1">
              Expira: {format(c.formExpiresAt.toDate(), "d MMM yyyy", { locale: es })}
            </p>
          )}

          {formExpired && c.status !== 'approved' && c.status !== 'rejected' && (
            <button
              onClick={onExtendToken}
              disabled={extendingToken}
              className="mt-2 w-full flex items-center justify-center gap-2 bg-amber-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors disabled:opacity-60"
            >
              <RefreshCw size={13} className={extendingToken ? 'animate-spin' : ''} />
              {extendingToken
                ? 'Renovando…'
                : tokenExtended
                ? '¡Enlace renovado y enviado!'
                : 'Renovar enlace (+7 días) y reenviar'}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Carta Oferta
   ═══════════════════════════════════════════════════════════════════════════ */

function TabOffer({ c, offerUrl, copied, onCopy }: {
  c: Candidate;
  offerUrl: string | null;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerSent, setOfferSent] = useState(false);
  const [offerSendError, setOfferSendError] = useState('');

  async function handleResendOffer() {
    setSendingOffer(true);
    setOfferSendError('');
    try {
      await sendOfferEmail({ candidateId: c.id });
      setOfferSent(true);
      setTimeout(() => setOfferSent(false), 3000);
    } catch (err: unknown) {
      setOfferSendError(err instanceof Error ? err.message : 'Error al enviar el correo.');
    } finally {
      setSendingOffer(false);
    }
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {!offerUrl && !c.offerPdfUrl ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <FileSignature size={24} className="text-gray-300" />
          </div>
          <p className="text-sm text-gray-500 font-medium">Sin carta oferta</p>
          <p className="text-xs text-gray-400 mt-1">
            La carta oferta se genera automáticamente cuando el candidato llega al stage correspondiente en Viterbit.
          </p>
        </div>
      ) : (
        <>
          {/* Status */}
          <Section title="Estado">
            {(c.offerSignedAt || c.status === 'offer_signed') ? (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                <CheckCircle size={14} />
                <span className="font-medium">
                  {c.offerSignedAt
                    ? `Firmada el ${format(c.offerSignedAt.toDate(), "d MMM yyyy 'a las' HH:mm", { locale: es })}`
                    : 'Carta firmada'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <AlertTriangle size={14} />
                <span className="font-medium">Pendiente de firma</span>
              </div>
            )}
          </Section>

          {/* Link */}
          {offerUrl && (
            <Section title="Enlace de la carta">
              <LinkBox
                url={offerUrl}
                copied={copied}
                onCopy={() => onCopy(offerUrl)}
              />
              {c.offerExpiresAt?.toDate && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Expira: {format(c.offerExpiresAt.toDate(), "d MMM yyyy", { locale: es })}
                </p>
              )}
            </Section>
          )}

          {/* PDF */}
          {c.offerPdfUrl && (
            <Section title="Documento PDF">
              <a
                href={c.offerPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary-700 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2.5 hover:bg-primary-100 transition-colors"
              >
                <FileText size={14} />
                <span className="font-medium">Descargar carta oferta (PDF)</span>
                <ExternalLink size={12} className="ml-auto" />
              </a>
            </Section>
          )}

          {/* Signature */}
          {c.offerSignatureUrl && (
            <Section title="Firma digital">
              <img
                src={c.offerSignatureUrl}
                alt="Firma del candidato"
                className="max-h-20 bg-white border border-gray-200 rounded-lg p-2"
              />
            </Section>
          )}

          {/* Resend offer email — only when not yet signed */}
          {offerUrl && !c.offerSignedAt && c.status !== 'offer_signed' && (
            <Section title="Correo de carta oferta">
              {offerSendError && (
                <p className="text-xs text-red-600 mb-2">{offerSendError}</p>
              )}
              <button
                onClick={handleResendOffer}
                disabled={sendingOffer}
                className="flex items-center gap-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg px-3 py-2 transition-colors disabled:opacity-60"
              >
                {sendingOffer ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : offerSent ? (
                  <Check size={13} />
                ) : (
                  <Send size={13} />
                )}
                {offerSent ? 'Correo enviado' : 'Reenviar correo de carta oferta'}
              </button>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Contrato
   ═══════════════════════════════════════════════════════════════════════════ */

function TabContract({ c, contractUrl, copied, onCopy }: {
  c: Candidate;
  contractUrl: string | null;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="px-5 py-4 space-y-5">
      {!contractUrl ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ClipboardList size={24} className="text-gray-300" />
          </div>
          <p className="text-sm text-gray-500 font-medium">Sin contrato</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            El contrato se genera automáticamente cuando el candidato es aprobado y avanza al stage de "Contrato" en Viterbit.
          </p>
        </div>
      ) : (
        <>
          {/* Status */}
          <Section title="Estado del contrato">
            {(c.contractSignedAt || c.status === 'contract_signed') ? (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                <CheckCircle size={14} />
                <span className="font-medium">
                  {c.contractSignedAt
                    ? `Firmado el ${format(c.contractSignedAt.toDate(), "d MMM yyyy 'a las' HH:mm", { locale: es })}`
                    : 'Contrato firmado'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                <Send size={14} />
                <span className="font-medium">Enviado — pendiente de firma</span>
              </div>
            )}
          </Section>

          {/* Link */}
          <Section title="Enlace del contrato">
            <LinkBox
              url={contractUrl}
              copied={copied}
              onCopy={() => onCopy(contractUrl)}
            />
            {c.contractExpiresAt?.toDate && (
              <p className="text-[11px] text-gray-400 mt-1">
                Expira: {format(c.contractExpiresAt.toDate(), "d MMM yyyy", { locale: es })}
              </p>
            )}
          </Section>

          {/* PDF */}
          {c.contractPdfUrl && (
            <Section title="Documento PDF">
              <a
                href={c.contractPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary-700 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2.5 hover:bg-primary-100 transition-colors"
              >
                <FileText size={14} />
                <span className="font-medium">Descargar contrato firmado (PDF)</span>
                <ExternalLink size={12} className="ml-auto" />
              </a>
            </Section>
          )}

          {/* Evidence */}
          {c.contractEvidenceUrl && (
            <Section title="Certificado de evidencia">
              <a
                href={c.contractEvidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 hover:bg-indigo-100 transition-colors"
              >
                <FileText size={14} />
                <span className="font-medium">Certificado FES (SHA-256)</span>
                <ExternalLink size={12} className="ml-auto" />
              </a>
            </Section>
          )}

          {/* Signature */}
          {c.contractSignatureUrl && (
            <Section title="Firma digital">
              <img
                src={c.contractSignatureUrl}
                alt="Firma del candidato"
                className="max-h-20 bg-white border border-gray-200 rounded-lg p-2"
              />
            </Section>
          )}

        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Cuentas
   ═══════════════════════════════════════════════════════════════════════════ */

function TabAccounts({ c, corpEmail, setCorpEmail, provisioning, provisionResult, provisionError, onProvision }: {
  c: Candidate;
  corpEmail: string;
  setCorpEmail: (v: string) => void;
  provisioning: boolean;
  provisionResult: ProvisionResult | null;
  provisionError: string;
  onProvision: () => void;
}) {
  return (
    <div className="px-5 py-4 space-y-5">
      {/* Contract status notice */}
      {(c.contractSignedAt || c.status === 'contract_signed') && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <CheckCircle size={14} />
          <span className="font-medium">
            {c.contractSignedAt
              ? `Contrato firmado el ${format(c.contractSignedAt.toDate(), "d MMM yyyy", { locale: es })}`
              : 'Contrato firmado'}
          </span>
        </div>
      )}

      {/* Corporate accounts that already exist */}
      {c.corporateEmail && (
        <Section title="Cuentas creadas">
          <div className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
            <Mail size={13} className="text-blue-500 shrink-0" />
            <span className="font-mono">{c.corporateEmail}</span>
          </div>
        </Section>
      )}

      {/* Provisioning form */}
      <Section title="Crear cuentas corporativas">
        <p className="text-[11px] text-gray-400 mb-3">
          Ingresa el correo corporativo para crear las cuentas.
        </p>
        <div className="space-y-2">
          <input
            type="email"
            value={corpEmail}
            onChange={(e) => setCorpEmail(e.target.value)}
            placeholder="nombre@avivacredito.com"
            disabled={provisioning}
            className="w-full input-field text-xs py-2"
          />
          <button
            onClick={onProvision}
            disabled={provisioning || !corpEmail.trim()}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {provisioning ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                Creando cuentas...
              </>
            ) : (
              <>
                <Users size={12} />
                Crear cuentas
              </>
            )}
          </button>
        </div>

        {provisionError && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 mt-3">
            <XCircle size={12} className="shrink-0 mt-0.5" />
            <span>{provisionError}</span>
          </div>
        )}

        {provisionResult && (
          <div className="space-y-1.5 mt-3">
            <div className={`space-y-0.5 px-2.5 py-1.5 rounded-lg ${provisionResult.hubspotCreated ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
              <div className="flex items-center gap-1.5 text-xs">
                {provisionResult.hubspotCreated ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                HubSpot: {provisionResult.hubspotCreated ? 'Creado' : 'Error'}
              </div>
              {!provisionResult.hubspotCreated && provisionResult.hubspotError && (
                <p className="text-[10px] pl-4 opacity-80">{provisionResult.hubspotError}</p>
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Helper: candidate-specific doc types
   ═══════════════════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Respuestas
   ═══════════════════════════════════════════════════════════════════════════ */

function TabAnswers({ c }: { c: Candidate }) {
  const a = c.formAnswers;
  const { questions: dynamicQuestions } = useFormQuestions();

  return (
    <div className="px-5 py-4 space-y-4">
      {!a && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <ClipboardList size={15} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800">El candidato aún no ha respondido las preguntas.</p>
        </div>
      )}

      <AnswerRow label="Estado civil" value={a?.estadoCivil === 'soltero' ? 'Soltero/a' : a?.estadoCivil === 'casado' ? 'Casado/a' : a?.estadoCivil === 'union_libre' ? 'Unión Libre' : '—'} />
      <AnswerRow label="¿Tiene hijos?" value={a?.tieneHijos === true ? 'Sí' : a?.tieneHijos === false ? 'No' : '—'} />
      <AnswerRow label="¿Crédito INFONAVIT?" value={a?.tieneInfonavit === true ? 'Sí' : a?.tieneInfonavit === false ? 'No' : '—'} />
      <AnswerRow label="¿Crédito FONACOT?" value={a?.tieneFonacot === true ? 'Sí' : a?.tieneFonacot === false ? 'No' : '—'} />
      <AnswerRow label="Talla de playera" value={a?.tallaPlayera ?? '—'} />
      <AnswerRow label="Sobre ti" value={a?.sobreTi ?? '—'} />
      <AnswerRow label="¿Laboró en entidad financiera?" value={a?.trabajoEntidadFinanciera === true ? `Sí — ${a?.nombreEntidadFinanciera ?? ''}` : a?.trabajoEntidadFinanciera === false ? 'No' : '—'} />

      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Beneficiario</h4>
        <AnswerRow label="Nombre" value={a?.beneficiarioNombre ?? '—'} />
        <AnswerRow label="Teléfono" value={a?.beneficiarioTelefono ?? '—'} />
        <AnswerRow label="Correo" value={a?.beneficiarioCorreo ?? '—'} />
        <AnswerRow label="Parentesco" value={a?.beneficiarioParentesco ? PARENTESCO_LABELS[a.beneficiarioParentesco] : '—'} />
      </div>

      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Contacto de emergencia 1</h4>
        <AnswerRow label="Nombre" value={a?.contacto1Nombre ?? '—'} />
        <AnswerRow label="Teléfono" value={a?.contacto1Telefono ?? '—'} />
        <AnswerRow label="Correo" value={a?.contacto1Correo ?? '—'} />
        <AnswerRow label="Parentesco" value={a?.contacto1Parentesco ? PARENTESCO_LABELS[a.contacto1Parentesco] : '—'} />
      </div>

      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Contacto de emergencia 2</h4>
        <AnswerRow label="Nombre" value={a?.contacto2Nombre ?? '—'} />
        <AnswerRow label="Teléfono" value={a?.contacto2Telefono ?? '—'} />
        <AnswerRow label="Correo" value={a?.contacto2Correo ?? '—'} />
        <AnswerRow label="Parentesco" value={a?.contacto2Parentesco ? PARENTESCO_LABELS[a.contacto2Parentesco] : '—'} />
      </div>

      {dynamicQuestions.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Preguntas adicionales</h4>
          {dynamicQuestions.map((q) => (
            <AnswerRow
              key={q.id}
              label={q.label}
              value={(a?.customAnswers ?? {})[q.id] || '—'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-800 font-medium text-right">{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Shared UI pieces
   ═══════════════════════════════════════════════════════════════════════════ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </section>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-gray-700">
      <span className="text-gray-400">{icon}</span>
      {children}
    </div>
  );
}

function DataCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1 text-gray-400 mb-0.5">
        {icon}
        <span className="text-[10px] uppercase font-medium tracking-wide">{label}</span>
      </div>
      <p className="text-xs text-gray-700 font-medium">{value}</p>
    </div>
  );
}

function LinkBox({ url, expired, copied, onCopy }: {
  url: string;
  expired?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
      expired ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
    }`}>
      <span className="text-xs text-gray-500 flex-1 truncate font-mono">{url}</span>
      <button onClick={onCopy} className="text-primary-600 hover:text-primary-700 shrink-0" title="Copiar enlace">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0" title="Abrir">
        <ExternalLink size={14} />
      </a>
    </div>
  );
}
