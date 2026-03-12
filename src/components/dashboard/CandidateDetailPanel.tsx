import { useState } from 'react';
import {
  X,
  Mail,
  Phone,
  Briefcase,
  FolderOpen,
  FileSpreadsheet,
  Send,
  CheckCircle,
  XCircle,
  ExternalLink,
  Copy,
  Check,
  FileText,
  DollarSign,
  Calendar,
  User,
} from 'lucide-react';
import { DOCUMENT_CONFIG, DOCUMENT_TYPES } from '../../types';
import type { Candidate } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';
import { ProgressBar } from '../ui/ProgressBar';
import {
  sendReminderEmail,
  syncToGoogleDrive,
  syncToGoogleSheets,
} from '../../services/functions';
import { updateCandidateStatus, updateCandidateNotes } from '../../services/candidates';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  candidate: Candidate;
  onClose: () => void;
}

export function CandidateDetailPanel({ candidate: c, onClose }: Props) {
  const [sendingReminder, setSendingReminder] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState(c.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);

  const formUrl = c.formToken ? `${window.location.origin}/form/${c.formToken}` : null;
  const offerUrl = c.offerToken ? `${window.location.origin}/offer/${c.offerToken}` : null;

  const copyFormLink = async () => {
    if (!formUrl) return;
    await navigator.clipboard.writeText(formUrl);
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

  const handleSyncDrive = async () => {
    setSyncingDrive(true);
    try {
      await syncToGoogleDrive({ candidateId: c.id });
    } finally {
      setSyncingDrive(false);
    }
  };

  const handleSyncSheets = async () => {
    setSyncingSheets(true);
    try {
      await syncToGoogleSheets({ candidateId: c.id });
    } finally {
      setSyncingSheets(false);
    }
  };

  const handleApprove = () => updateCandidateStatus(c.id, 'approved');
  const handleReject = () => updateCandidateStatus(c.id, 'rejected');

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await updateCandidateNotes(c.id, notes);
    } finally {
      setSavingNotes(false);
    }
  };

  const createdAt = c.createdAt?.toDate?.();
  const updatedAt = c.updatedAt?.toDate?.();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {c.firstName} {c.lastName}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge status={c.status} type="candidate" />
            <span className="text-xs text-gray-400">
              {createdAt ? format(createdAt, "d MMM yyyy", { locale: es }) : ''}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Info */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Información
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Mail size={14} className="text-gray-400" />
              <a href={`mailto:${c.email}`} className="hover:text-primary-600">{c.email}</a>
            </div>
            {c.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Phone size={14} className="text-gray-400" />
                <span>{c.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Briefcase size={14} className="text-gray-400" />
              <span>{c.position}</span>
            </div>
          </div>
        </section>

        {/* Offer letter details — shown when candidate came from Viterbit */}
        {(c.viterbitSalary || c.viterbitStartDate || c.viterbitHiringManager || c.viterbitDepartmentProfile) && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Datos del puesto (Viterbit)
            </h3>
            <div className="space-y-2">
              {c.viterbitDepartmentProfile && (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <Briefcase size={14} className="text-gray-400 mt-0.5 shrink-0" />
                  <span>{c.viterbitDepartmentProfile}</span>
                </div>
              )}
              {c.viterbitSalary && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <DollarSign size={14} className="text-gray-400 shrink-0" />
                  <span>{c.viterbitSalary}</span>
                </div>
              )}
              {c.viterbitHiringManager && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <User size={14} className="text-gray-400 shrink-0" />
                  <span>{c.viterbitHiringManager}</span>
                </div>
              )}
              {c.viterbitStartDate && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Calendar size={14} className="text-gray-400 shrink-0" />
                  <span>{c.viterbitStartDate}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Offer letter link */}
        {offerUrl && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Carta oferta
            </h3>
            {c.status === 'offer_signed' && c.offerSignedAt && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-2">
                <CheckCircle size={13} />
                <span>Firmada el {format(c.offerSignedAt.toDate(), "d MMM yyyy", { locale: es })}</span>
              </div>
            )}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <FileText size={13} className="text-gray-400 shrink-0" />
              <span className="text-xs text-gray-500 flex-1 truncate">{offerUrl}</span>
              <a href={offerUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0">
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Expira: {c.offerExpiresAt?.toDate
                ? format(c.offerExpiresAt.toDate(), "d MMM yyyy", { locale: es })
                : '—'}
            </p>
          </section>
        )}

        {/* Progress */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Progreso de documentación
          </h3>
          <ProgressBar percentage={c.completionPercentage} />
          <div className="mt-3 space-y-2">
            {DOCUMENT_TYPES.map((type) => {
              const docItem = c.documents[type];
              const config = DOCUMENT_CONFIG[type];
              return (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">{config.label}</span>
                  <StatusBadge status={docItem?.status ?? 'pending'} type="document" />
                </div>
              );
            })}
          </div>
        </section>

        {/* Form link — only shown once documents phase has started */}
        {formUrl && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Enlace del formulario
            </h3>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-500 flex-1 truncate">{formUrl}</span>
              <button onClick={copyFormLink} className="text-primary-600 hover:text-primary-700 shrink-0">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 shrink-0">
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Expira: {c.formExpiresAt?.toDate
                ? format(c.formExpiresAt.toDate(), "d MMM yyyy", { locale: es })
                : '—'}
            </p>
          </section>
        )}

        {/* Actions */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Acciones
          </h3>
          <div className="space-y-2">
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder || c.status === 'approved' || c.status === 'rejected'}
              className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
            >
              <Send size={14} />
              {sendingReminder ? 'Enviando...' : 'Enviar recordatorio por email'}
            </button>

            <button
              onClick={handleSyncDrive}
              disabled={syncingDrive || c.completionPercentage === 0}
              className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
            >
              <FolderOpen size={14} />
              {syncingDrive ? 'Sincronizando...' : 'Sincronizar a Google Drive'}
            </button>

            {c.driveFolder && (
              <a
                href={c.driveFolder.folderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
              >
                <ExternalLink size={14} />
                Abrir carpeta en Drive
              </a>
            )}

            <button
              onClick={handleSyncSheets}
              disabled={syncingSheets}
              className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
            >
              <FileSpreadsheet size={14} />
              {syncingSheets ? 'Sincronizando...' : 'Actualizar Google Sheets'}
            </button>
          </div>
        </section>

        {/* Approve / Reject */}
        {c.status === 'under_review' && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Decisión
            </h3>
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                <CheckCircle size={14} /> Aprobar
              </button>
              <button
                onClick={handleReject}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                <XCircle size={14} /> Rechazar
              </button>
            </div>
          </section>
        )}

        {/* Notes */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Notas internas
          </h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Agrega notas sobre el candidato..."
            className="input-field text-xs resize-none"
          />
          <button
            onClick={handleSaveNotes}
            disabled={savingNotes}
            className="mt-2 btn-secondary text-xs w-full"
          >
            {savingNotes ? 'Guardando...' : 'Guardar notas'}
          </button>
        </section>

        {/* Timestamps */}
        <div className="text-xs text-gray-400 space-y-0.5 pb-4">
          {createdAt && <p>Creado: {format(createdAt, "d MMM yyyy HH:mm", { locale: es })}</p>}
          {updatedAt && <p>Actualizado: {format(updatedAt, "d MMM yyyy HH:mm", { locale: es })}</p>}
          <p>Recordatorios enviados: {c.reminderCount}</p>
        </div>
      </div>
    </div>
  );
}
