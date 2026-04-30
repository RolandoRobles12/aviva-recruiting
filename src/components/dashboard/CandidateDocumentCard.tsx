import { Eye, Clock, CheckCircle, XCircle, RefreshCw, AlertTriangle, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CandidateDocument, DocumentType } from '../../types';
import { DOCUMENT_CONFIG } from '../../types';

interface Props {
  type: DocumentType;
  doc: CandidateDocument;
}

const STATUS_STYLES: Record<CandidateDocument['status'], { border: string; bg: string; icon: React.ReactNode }> = {
  pending:  { border: 'border-gray-200',  bg: 'bg-gray-50',   icon: <Clock size={13} className="text-gray-400" /> },
  uploaded: { border: 'border-blue-200',  bg: 'bg-blue-50',   icon: <RefreshCw size={13} className="text-blue-500 animate-spin" /> },
  valid:    { border: 'border-green-200', bg: 'bg-green-50',  icon: <CheckCircle size={13} className="text-green-600" /> },
  invalid:  { border: 'border-red-200',   bg: 'bg-red-50',    icon: <XCircle size={13} className="text-red-500" /> },
  review:   { border: 'border-yellow-200',bg: 'bg-yellow-50', icon: <AlertTriangle size={13} className="text-yellow-500" /> },
};

const STATUS_LABEL: Record<CandidateDocument['status'], string> = {
  pending:  'Pendiente',
  uploaded: 'Validando OCR…',
  valid:    'Válido',
  invalid:  'Inválido',
  review:   'Revisión manual',
};

function isImage(fileName?: string): boolean {
  if (!fileName) return false;
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName);
}

export function CandidateDocumentCard({ type, doc }: Props) {
  const config = DOCUMENT_CONFIG[type];
  const style = STATUS_STYLES[doc.status];
  const uploadedAt = doc.uploadedAt?.toDate?.();
  const hasFile = !!doc.downloadUrl;
  const showThumbnail = hasFile && isImage(doc.fileName) && doc.status !== 'pending';

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} px-3 py-2.5`}>
      {/* Row 1: label + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-700 truncate">{config.label}</span>
        <div className="flex items-center gap-1 shrink-0">
          {style.icon}
          <span className="text-xs text-gray-500">{STATUS_LABEL[doc.status]}</span>
        </div>
      </div>

      {/* Image thumbnail (for photos and image docs) */}
      {showThumbnail && (
        <a href={doc.downloadUrl} target="_blank" rel="noopener noreferrer" className="block mt-2">
          <img
            src={doc.downloadUrl}
            alt={config.label}
            className="w-full max-h-28 object-cover rounded-lg border border-gray-200 hover:opacity-90 transition-opacity"
          />
        </a>
      )}

      {/* File info row */}
      {doc.fileName && doc.status !== 'pending' && (
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <FileText size={11} className="text-gray-400 shrink-0" />
            <span className="text-xs text-gray-400 truncate max-w-[140px]">{doc.fileName}</span>
          </div>
          {uploadedAt && (
            <span className="text-xs text-gray-400 shrink-0">
              {format(uploadedAt, 'd MMM', { locale: es })}
            </span>
          )}
        </div>
      )}

      {/* View document button — prominent when there's a file */}
      {hasFile && doc.status !== 'pending' && (
        <a
          href={doc.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-2 flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            doc.status === 'valid'
              ? 'bg-green-600 text-white hover:bg-green-700'
              : doc.status === 'invalid'
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          <Eye size={13} />
          Ver documento
        </a>
      )}

      {/* OCR confidence (valid only) */}
      {doc.status === 'valid' && doc.ocrResult && (
        <p className="text-xs text-green-700 mt-1.5">
          OCR: {Math.round(doc.ocrResult.confidence * 100)}% confianza
        </p>
      )}

      {/* Detected document type (invalid) */}
      {doc.status === 'invalid' && doc.ocrResult?.documentTypeDetected &&
        doc.ocrResult.documentTypeDetected !== 'parse_error' &&
        doc.ocrResult.documentTypeDetected !== 'unknown' && (
        <p className="text-xs text-orange-600 mt-1">
          Detectado: <span className="font-medium">{doc.ocrResult.documentTypeDetected}</span>
          {doc.ocrResult.confidence != null && (
            <> · {Math.round(doc.ocrResult.confidence * 100)}%</>
          )}
        </p>
      )}

      {/* OCR validation errors detail */}
      {doc.status === 'invalid' && doc.ocrResult?.validationErrors?.length ? (
        <ul className="mt-1 space-y-0.5">
          {doc.ocrResult.validationErrors.map((err, i) => (
            <li key={i} className="text-xs text-red-500 leading-tight">• {err}</li>
          ))}
        </ul>
      ) : doc.status === 'invalid' && doc.rejectionReason ? (
        <p className="text-xs text-red-600 mt-1">{doc.rejectionReason}</p>
      ) : null}

      {/* Review state hint */}
      {doc.status === 'review' && (
        <p className="text-xs text-yellow-700 mt-1">OCR no disponible — revisar manualmente</p>
      )}
    </div>
  );
}
