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
  UserX,
  TableProperties,
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
  sendInvitationEmail,
  sendContractEmail,
  refreshCandidateViterbit,
  createDriveFolderManual,
  appendSheetsRowManual,
} from '../../services/functions';
import type { ProvisionResult } from '../../services/functions';
import { updateCandidateStatus, updateCandidateNotes, extendFormToken, markDocumentAsValid, disqualifyCandidate, updateCandidateDataOverrides } from '../../services/candidates';
import { getLinkDurationSettings } from '../../services/settings';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Contract data fields: validation rules for OCR-extracted values ──────────

interface ContractField {
  key: string;
  label: string;
  placeholder: string;
  validate: (v: string) => boolean;
}

const CONTRACT_FIELDS: ContractField[] = [
  { key: 'curp',      label: 'CURP',      placeholder: '18 caracteres',   validate: (v) => /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/i.test(v.trim()) },
  { key: 'rfc',       label: 'RFC',       placeholder: '12-13 caracteres', validate: (v) => /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(v.trim()) },
  { key: 'nss',       label: 'NSS',       placeholder: '11 dígitos',       validate: (v) => /^\d{11}$/.test(v.trim()) },
  { key: 'clabe',     label: 'CLABE',     placeholder: '18 dígitos',       validate: (v) => /^\d{18}$/.test(v.trim()) },
  { key: 'banco',     label: 'Banco',     placeholder: 'Ej. BBVA',         validate: (v) => v.trim().length > 1 },
  { key: 'domicilio', label: 'Domicilio', placeholder: 'Calle, número…',   validate: (v) => v.trim().length > 5 },
];

function extractOcrContractData(c: Candidate): Record<string, string> {
  const docs = (c.documents ?? {}) as Record<string, import('../../types').CandidateDocument>;
  const ocr = (t: string): Record<string, string> => {
    const d = docs[t];
    return d?.status === 'valid' ? ((d.ocrResult?.extractedData ?? {}) as Record<string, string>) : {};
  };
  const ine       = ocr('ine');
  const curpDoc   = ocr('curp');
  const constancia = ocr('constancia_fiscal');
  const caratula  = ocr('caratula_bancaria');
  const nssDoc    = ocr('nss');
  return {
    curp:      curpDoc.curp      || ine.curp      || '',
    rfc:       constancia.rfc                      || '',
    nss:       nssDoc.nss                          || '',
    clabe:     caratula.clabe                      || '',
    banco:     caratula.banco                      || '',
    domicilio: ine.domicilio                       || '',
  };
}

/** Merge OCR data with manual overrides */
function mergedContractData(c: Candidate): Record<string, string> {
  const ocr = extractOcrContractData(c);
  const ov  = (c.dataOverrides ?? {}) as Record<string, string>;
  return Object.fromEntries(CONTRACT_FIELDS.map(({ key }) => [key, ov[key] ?? ocr[key] ?? '']));
}

/** Returns how many contract fields are missing or malformed */
function contractDataIssues(c: Candidate): number {
  const data = mergedContractData(c);
  return CONTRACT_FIELDS.filter(({ key, validate }) => {
    const val = data[key] ?? '';
    return !val || !validate(val);
  }).length;
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const [showDisqualifyModal, setShowDisqualifyModal] = useState(false);
  const [creatingDriveFolder, setCreatingDriveFolder] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState(
    c.driveFolderId ? `https://drive.google.com/drive/folders/${c.driveFolderId}` : ''
  );
  const [appendingSheets, setAppendingSheets] = useState(false);
  const [sheetsAppended, setSheetsAppended] = useState(false);

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

  // Document collection is complete once the candidate moves past the review phase.
  // After this point the form link expiry is irrelevant and the renewal button should be hidden.
  const FORM_ACTIVE_STATUSES: import('../../types').CandidateStatus[] = [
    'offer_signed', 'invited', 'in_progress', 'under_review',
  ];
  const formDone = !FORM_ACTIVE_STATUSES.includes(c.status);

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
      setTokenExtended(true);
      setTimeout(() => setTokenExtended(false), 4000);
    } finally {
      setExtendingToken(false);
    }
  };

  const handleMarkValid = async (type: import('../../types').DocumentType) => {
    await markDocumentAsValid(c.id, type, c);
  };

  // Auto-generate formToken when offer is signed but token doesn't exist yet
  useEffect(() => {
    if (c.status === 'offer_signed' && !c.formToken) {
      getLinkDurationSettings()
        .then((s) => extendFormToken(c.id, s.formDays))
        .catch((err) => console.error('[auto formToken]', err));
    }
  }, [c.id, c.status, c.formToken]);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await updateCandidateNotes(c.id, notes);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setProvisionError('');
    setProvisionResult(null);
    try {
      const res = await provisionAccountsManual({
        candidateId: c.id,
        corporateEmail: corpEmail.trim() || undefined,
        skipSlack: true,
      });
      setProvisionResult(res.data);
      if (res.data.corporateEmail) setCorpEmail(res.data.corporateEmail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setProvisionError(msg);
    } finally {
      setProvisioning(false);
    }
  };

  const handleCreateDriveFolder = async () => {
    setCreatingDriveFolder(true);
    try {
      const res = await createDriveFolderManual({ candidateId: c.id });
      setDriveFolderUrl(res.data.folderUrl);
    } catch (err: unknown) {
      console.error('[createDriveFolder]', err);
    } finally {
      setCreatingDriveFolder(false);
    }
  };

  const handleAppendSheets = async () => {
    setAppendingSheets(true);
    setSheetsAppended(false);
    try {
      await appendSheetsRowManual({ candidateId: c.id });
      setSheetsAppended(true);
    } catch (err: unknown) {
      console.error('[appendSheets]', err);
    } finally {
      setAppendingSheets(false);
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

      {/* ── Disqualification modal ─────────────────────────────────────────── */}
      {showDisqualifyModal && (
        <DisqualifyModal
          candidateName={`${c.firstName} ${c.lastName}`}
          onConfirm={async (reason) => {
            await disqualifyCandidate(c.id, reason);
            setShowDisqualifyModal(false);
          }}
          onCancel={() => setShowDisqualifyModal(false)}
        />
      )}

      {/* ── Two-column body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Tabs + content */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-100">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 px-5 shrink-0 bg-gray-50/50">
            {TABS.map((t) => {
              const issueCount = t.id === 'contract' ? contractDataIssues(c) : 0;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                    tab === t.id
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {issueCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 text-white text-[8px] font-bold flex items-center justify-center leading-none">
                      {issueCount}
                    </span>
                  )}
                </button>
              );
            })}
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
                onMarkValid={handleMarkValid}
              />
            )}
            {tab === 'offer' && (
              <TabOffer c={c} offerUrl={offerUrl} copied={copied} onCopy={copyToClipboard} onCandidateChange={() => {}} />
            )}
            {tab === 'contract' && (
              <TabContract c={c} contractUrl={contractUrl} copied={copied} onCopy={copyToClipboard} onCandidateChange={() => {}} />
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
                {formDone ? (
                  <p className="text-[11px] text-green-600 mb-2 flex items-center gap-1">
                    <CheckCircle size={11} /> Documentación completada
                  </p>
                ) : formExpired ? (
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
                <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 border text-xs bg-gray-50 border-gray-200">
                  <span className="flex-1 truncate font-mono text-gray-500">{formUrl}</span>
                  <button onClick={() => copyToClipboard(formUrl)} className="text-primary-600 hover:text-primary-700 shrink-0" title="Copiar">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <a href={formUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0" title="Abrir">
                    <ExternalLink size={13} />
                  </a>
                </div>
                {formExpired && !formDone && (
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

          {/* Drive folder */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
              <FolderOpen size={13} className="text-green-500" />
              Expediente Drive
            </h4>
            {driveFolderUrl ? (
              <a
                href={driveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-2 hover:bg-green-100 transition-colors"
              >
                <FolderOpen size={12} />
                <span className="flex-1 truncate font-medium">Ver carpeta en Drive</span>
                <ExternalLink size={11} />
              </a>
            ) : (
              <button
                onClick={handleCreateDriveFolder}
                disabled={creatingDriveFolder}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                {creatingDriveFolder ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <FolderOpen size={12} />
                )}
                {creatingDriveFolder ? 'Creando...' : 'Crear carpeta en Drive'}
              </button>
            )}
          </div>

          {/* Google Sheets */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
              <TableProperties size={13} className="text-emerald-500" />
              Hoja de control
            </h4>
            <button
              onClick={handleAppendSheets}
              disabled={appendingSheets}
              className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${
                sheetsAppended
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {appendingSheets ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <TableProperties size={12} />
              )}
              {appendingSheets ? 'Agregando...' : sheetsAppended ? 'Fila agregada ✓' : 'Agregar a Sheets'}
            </button>
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">Acciones rápidas</h4>
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder || c.status === 'approved' || c.status === 'rejected' || c.status === 'disqualified'}
              className="w-full btn-secondary text-xs flex items-center justify-center gap-2 py-2"
            >
              <Send size={12} />
              {sendingReminder ? 'Enviando...' : 'Enviar recordatorio'}
            </button>
            {/* Trigger contract generation for candidates stuck at 100% before under_review */}
            {computeCompletion(c) === 100 &&
              ['offer_signed', 'invited', 'in_progress'].includes(c.status) && (
              <button
                onClick={() => updateCandidateStatus(c.id, 'under_review')}
                className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 text-white px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                <FileText size={12} /> Generar contrato
              </button>
            )}
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
            {c.status !== 'disqualified' && (
              <button
                onClick={() => setShowDisqualifyModal(true)}
                className="w-full flex items-center justify-center gap-1.5 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                <UserX size={12} /> Descalificar candidato
              </button>
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

      {/* Viterbit / position data */}
      {((c.profile ?? c.viterbitDepartmentProfile) || c.viterbitStartDate || c.viterbitHiringManager) && (
        <Section title="Datos del puesto">
          <div className="grid grid-cols-2 gap-3">
            {(c.profile ?? c.viterbitDepartmentProfile) && (
              <DataCell icon={<Briefcase size={12} />} label="Perfil" value={(c.profile ?? c.viterbitDepartmentProfile)!} />
            )}
            {c.viterbitHiringManager && (
              <DataCell icon={<User size={12} />} label="Líder" value={c.viterbitHiringManager} />
            )}
            {c.viterbitStartDate && (
              <DataCell icon={<Calendar size={12} />} label="Inicio" value={c.viterbitStartDate} />
            )}
          </div>
        </Section>
      )}

      {/* Disqualification reason */}
      {c.status === 'disqualified' && c.disqualificationReason && (
        <Section title="Motivo de descalificación">
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <UserX size={13} className="shrink-0" />
            <span className="font-medium">{c.disqualificationReason}</span>
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

function TabDocs({ c, formUrl, formExpired, copied, onCopy, extendingToken, tokenExtended, onExtendToken, onMarkValid }: {
  c: Candidate;
  formUrl: string | null;
  formExpired: boolean;
  copied: boolean;
  onCopy: (text: string) => void;
  extendingToken: boolean;
  tokenExtended: boolean;
  onExtendToken: () => void;
  onMarkValid: (type: import('../../types').DocumentType) => void;
}) {
  const [sendingInvitation, setSendingInvitation] = useState(false);
  const [invitationSent, setInvitationSent] = useState(false);
  const [invitationError, setInvitationError] = useState('');

  async function handleSendInvitation() {
    setSendingInvitation(true);
    setInvitationError('');
    try {
      await sendInvitationEmail({ candidateId: c.id });
      setInvitationSent(true);
      setTimeout(() => setInvitationSent(false), 3000);
    } catch (err: unknown) {
      setInvitationError(err instanceof Error ? err.message : 'Error al enviar.');
    } finally {
      setSendingInvitation(false);
    }
  }
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
            const status = docItem?.status ?? 'pending';
            return (
              <div key={type}>
                <CandidateDocumentCard
                  type={type}
                  doc={docItem ?? { id: type, type, status: 'pending' }}
                />
                {(status === 'invalid' || status === 'review') && docItem?.fileName && (
                  <button
                    onClick={() => onMarkValid(type)}
                    className="mt-1 w-full flex items-center justify-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 rounded-lg py-1 transition-colors"
                  >
                    <CheckCircle size={11} /> Marcar como válido
                  </button>
                )}
              </div>
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

          {!formExpired && c.status !== 'approved' && c.status !== 'rejected' && (
            <>
              {invitationError && <p className="text-xs text-red-600 mt-2">{invitationError}</p>}
              <button
                onClick={handleSendInvitation}
                disabled={sendingInvitation}
                className="mt-2 w-full flex items-center justify-center gap-2 bg-primary-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-primary-700 transition-colors disabled:opacity-60"
              >
                {sendingInvitation ? <RefreshCw size={13} className="animate-spin" /> : invitationSent ? <Check size={13} /> : <Send size={13} />}
                {invitationSent ? '¡Correo enviado!' : 'Enviar correo de invitación'}
              </button>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Viterbit data alert — shown when salary or start date are missing
   ═══════════════════════════════════════════════════════════════════════════ */

function ViterbitDataAlert({ c, onRefreshed }: { c: Candidate; onRefreshed: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [refreshed, setRefreshed] = useState(false);

  const missingSalary = !c.viterbitSalary || c.viterbitSalary.trim() === '';
  const missingDate = !c.viterbitStartDate || c.viterbitStartDate.trim() === '';
  if (!missingSalary && !missingDate) return null;

  const missing: string[] = [];
  if (missingSalary) missing.push('salario');
  if (missingDate) missing.push('fecha de inicio');

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError('');
    try {
      await refreshCandidateViterbit({ candidateId: c.id });
      setRefreshed(true);
      onRefreshed();
    } catch (err: unknown) {
      setRefreshError(err instanceof Error ? err.message : 'Error al refrescar datos.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-800">
            Faltan datos de Viterbit: {missing.join(' y ')}
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            El documento se generará con campos vacíos. Actualiza el puesto en Viterbit y luego refresca.
          </p>
        </div>
      </div>
      {refreshError && <p className="text-xs text-red-600">{refreshError}</p>}
      {refreshed && <p className="text-xs text-amber-700 font-medium">Datos consultados — si el botón sigue bloqueado, los campos siguen vacíos en Viterbit. Actualízalos allá y refresca de nuevo.</p>}
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
      >
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Refrescando...' : 'Refrescar datos de Viterbit'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB: Carta Oferta
   ═══════════════════════════════════════════════════════════════════════════ */

function TabOffer({ c, offerUrl, copied, onCopy, onCandidateChange }: {
  c: Candidate;
  offerUrl: string | null;
  copied: boolean;
  onCopy: (text: string) => void;
  onCandidateChange: () => void;
}) {
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerSent, setOfferSent] = useState(false);
  const [offerSendError, setOfferSendError] = useState('');

  const missingSalary = !c.viterbitSalary || c.viterbitSalary.trim() === '';
  const missingDate = !c.viterbitStartDate || c.viterbitStartDate.trim() === '';
  const missingHiringDetails = missingSalary || missingDate;

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
      <ViterbitDataAlert c={c} onRefreshed={onCandidateChange} />
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
              {missingHiringDetails && (
                <p className="text-xs text-amber-700 mb-2">Completa los datos de Viterbit antes de reenviar.</p>
              )}
              <button
                onClick={handleResendOffer}
                disabled={sendingOffer || missingHiringDetails}
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

function TabContract({ c, contractUrl, copied, onCopy, onCandidateChange }: {
  c: Candidate;
  contractUrl: string | null;
  copied: boolean;
  onCopy: (text: string) => void;
  onCandidateChange: () => void;
}) {
  const [sendingContract, setSendingContract] = useState(false);
  const [contractSent, setContractSent] = useState(false);
  const [contractSendError, setContractSendError] = useState('');

  const missingSalary = !c.viterbitSalary || c.viterbitSalary.trim() === '';
  const missingDate = !c.viterbitStartDate || c.viterbitStartDate.trim() === '';
  const missingHiringDetails = missingSalary || missingDate;

  async function handleResendContract() {
    setSendingContract(true);
    setContractSendError('');
    try {
      await sendContractEmail({ candidateId: c.id });
      setContractSent(true);
      setTimeout(() => setContractSent(false), 3000);
    } catch (err: unknown) {
      setContractSendError(err instanceof Error ? err.message : 'Error al enviar.');
    } finally {
      setSendingContract(false);
    }
  }

  return (
    <div className="px-5 py-4 space-y-5">
      <ViterbitDataAlert c={c} onRefreshed={onCandidateChange} />
      {/* Contract data always visible so recruiter can review OCR fields at any stage */}
      <Section title="Datos para el contrato">
        <ContractDataSection c={c} />
      </Section>

      {!contractUrl ? (
        <div className="text-center py-8">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ClipboardList size={24} className="text-gray-300" />
          </div>
          <p className="text-sm text-gray-500 font-medium">Sin contrato aún</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            El contrato se genera automáticamente cuando el candidato avanza al stage de "Contrato" en Viterbit.
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

          {/* Resend contract email — only when not yet signed */}
          {!c.contractSignedAt && c.status !== 'contract_signed' && (
            <Section title="Correo del contrato">
              {contractSendError && <p className="text-xs text-red-600 mb-2">{contractSendError}</p>}
              {missingHiringDetails && (
                <p className="text-xs text-amber-700 mb-2">Completa los datos de Viterbit antes de reenviar.</p>
              )}
              <button
                onClick={handleResendContract}
                disabled={sendingContract || missingHiringDetails}
                className="flex items-center gap-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg px-3 py-2 transition-colors disabled:opacity-60 w-full justify-center"
              >
                {sendingContract ? <RefreshCw size={13} className="animate-spin" /> : contractSent ? <Check size={13} /> : <Send size={13} />}
                {contractSent ? 'Correo enviado' : 'Reenviar correo de contrato'}
              </button>
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
          Si el correo ya está en Viterbit se detecta automáticamente. De lo contrario, ingrésalo manualmente.
        </p>
        <div className="space-y-2">
          <input
            type="email"
            value={corpEmail}
            onChange={(e) => setCorpEmail(e.target.value)}
            placeholder="nombre@avivacredito.com (opcional)"
            disabled={provisioning}
            className="w-full input-field text-xs py-2"
          />
          <button
            onClick={onProvision}
            disabled={provisioning}
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

      {dynamicQuestions.length > 0 && dynamicQuestions.some((q) => (a?.customAnswers ?? {})[q.id]) && (
        <div className="border-t border-gray-100 pt-3">
          <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Preguntas adicionales</h4>
          {dynamicQuestions
            .filter((q) => (a?.customAnswers ?? {})[q.id])
            .map((q) => (
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

/* ═══════════════════════════════════════════════════════════════════════════
   Contract data editor: editable OCR fields with validation warnings
   ═══════════════════════════════════════════════════════════════════════════ */

function ContractDataSection({ c }: { c: Candidate }) {
  const ocr   = extractOcrContractData(c);
  const saved = (c.dataOverrides ?? {}) as Record<string, string>;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(CONTRACT_FIELDS.map(({ key }) => [key, saved[key] ?? ocr[key] ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const issueFields = CONTRACT_FIELDS.filter(({ key, validate }) => {
    const v = values[key] ?? '';
    return !v || !validate(v);
  });

  const handleSave = async () => {
    setSaving(true);
    setSavedOk(false);
    try {
      await updateCandidateDataOverrides(c.id, values);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const hasAnyData = CONTRACT_FIELDS.some(({ key }) => ocr[key] || saved[key]);
  if (!hasAnyData && issueFields.length === CONTRACT_FIELDS.length) {
    return (
      <p className="text-xs text-gray-400 italic">
        Los datos del contrato aparecerán aquí una vez que el candidato suba sus documentos.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {issueFields.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800">
              {issueFields.length} dato{issueFields.length > 1 ? 's' : ''} incompleto{issueFields.length > 1 ? 's' : ''} o ilegible{issueFields.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {issueFields.map((f) => f.label).join(', ')} — corrige antes de firmar el contrato.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {CONTRACT_FIELDS.map(({ key, label, placeholder, validate }) => {
          const val    = values[key] ?? '';
          const isOk   = val && validate(val);
          const hasOcr = !!ocr[key];
          const overridden = saved[key] && saved[key] !== ocr[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {label}
                  {overridden && <span className="ml-1 text-blue-500 normal-case font-normal">(corregido)</span>}
                  {!hasOcr && !saved[key] && <span className="ml-1 text-amber-500 normal-case font-normal">(sin datos OCR)</span>}
                </label>
                {isOk
                  ? <CheckCircle size={11} className="text-green-500 shrink-0" />
                  : val
                    ? <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                    : <XCircle size={11} className="text-gray-300 shrink-0" />
                }
              </div>
              <input
                value={val}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className={`w-full text-xs rounded-lg border px-2.5 py-1.5 font-mono focus:outline-none focus:ring-1 ${
                  isOk
                    ? 'border-green-200 bg-green-50/40 focus:ring-green-300'
                    : val
                      ? 'border-amber-300 bg-amber-50/40 focus:ring-amber-300'
                      : 'border-gray-200 bg-gray-50 focus:ring-primary-300'
                }`}
              />
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-60"
      >
        {saving ? <RefreshCw size={12} className="animate-spin" /> : savedOk ? <CheckCircle size={12} /> : <Check size={12} />}
        {saving ? 'Guardando…' : savedOk ? '¡Guardado!' : 'Guardar correcciones'}
      </button>
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

/* ═══════════════════════════════════════════════════════════════════════════
   Modal: Descalificar candidato
   ═══════════════════════════════════════════════════════════════════════════ */

const DISQUALIFY_REASONS = [
  'Rechazo oferta (2026)',
  'Declino proceso (2026)',
  'No subió documentos (2026)',
];

function DisqualifyModal({ candidateName, onConfirm, onCancel }: {
  candidateName: string;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await onConfirm(selected);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <UserX size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Descalificar candidato</h3>
            <p className="text-xs text-gray-500">{candidateName}</p>
          </div>
        </div>

        <p className="text-xs text-gray-600 mb-4">Selecciona el motivo de descalificación:</p>

        <div className="space-y-2 mb-5">
          {DISQUALIFY_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => setSelected(reason)}
              className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                selected === reason
                  ? 'border-red-400 bg-red-50 text-red-700 font-medium'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {reason}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || loading}
            className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <UserX size={13} />}
            {loading ? 'Guardando...' : 'Descalificar'}
          </button>
        </div>
      </div>
    </div>
  );
}
