import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  File,
  RefreshCw,
  Eye,
} from 'lucide-react';
import type { DocumentType, CandidateDocument, DocumentSetting } from '../../types';
import { DOCUMENT_CONFIG } from '../../types';
import { uploadDocument } from '../../services/storage';
import { updateCandidateDocumentStatus } from '../../services/candidates';
import { Timestamp } from 'firebase/firestore';

interface Props {
  candidateId: string;
  documentType: DocumentType;
  document: CandidateDocument;
  setting?: Partial<DocumentSetting>;
}

const STATUS_ICONS = {
  pending: <Clock size={18} className="text-yellow-500" />,
  uploaded: <RefreshCw size={18} className="text-blue-500 animate-spin" />,
  valid: <CheckCircle size={18} className="text-green-500" />,
  invalid: <XCircle size={18} className="text-red-500" />,
  review: <AlertCircle size={18} className="text-blue-500" />,
};

const ACCEPTED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

export function DocumentUploadCard({ candidateId, documentType, document, setting }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const config = { ...DOCUMENT_CONFIG[documentType], ...(setting ?? {}) };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setLocalError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        // 1. Upload to Firebase Storage
        const { storagePath, downloadUrl } = await uploadDocument(
          candidateId,
          documentType,
          file,
          ({ percentage }) => setUploadProgress(percentage)
        );

        // 2. Update Firestore with upload info.
        // For foto_profesional: mark as valid immediately (no OCR needed).
        // For other docs: set 'uploaded' — the Storage trigger validates and updates to 'valid'/'invalid'.
        const isPhoto = documentType === 'foto_profesional';
        await updateCandidateDocumentStatus(candidateId, documentType, {
          id: documentType,
          type: documentType,
          status: isPhoto ? 'valid' : 'uploaded',
          fileName: file.name,
          storagePath,
          downloadUrl,
          uploadedAt: Timestamp.now(),
          ...(isPhoto ? {
            ocrResult: {
              rawText: '',
              extractedData: {},
              confidence: 1,
              validationPassed: true,
              validationErrors: [],
              processedAt: Timestamp.now(),
            },
          } : {}),
        });
      } catch (err) {
        setLocalError('Error al subir el archivo. Intenta de nuevo.');
        console.error(err);
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [candidateId, documentType]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50MB
    disabled: uploading || document.status === 'valid',
    onDropRejected: (fileRejections) => {
      const err = fileRejections[0]?.errors[0];
      if (err?.code === 'file-too-large') {
        setLocalError('El archivo es muy grande. Máximo 50 MB.');
      } else if (err?.code === 'file-invalid-type') {
        setLocalError('Formato no válido. Acepta JPG, PNG o PDF.');
      } else {
        setLocalError('Archivo rechazado. Verifica el formato y tamaño.');
      }
    },
  });

  const isValid = document.status === 'valid';
  const isUploading = uploading || document.status === 'uploaded';

  return (
    <div className={`card p-5 transition-all ${isValid ? 'border-green-200 bg-green-50/30' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {STATUS_ICONS[document.status]}
            <h3 className="font-semibold text-sm text-gray-900">{config.label}</h3>
            {config.required && (
              <span className="text-red-500 text-xs font-medium">*</span>
            )}
          </div>
          <p className="text-xs text-gray-500">{config.description}</p>
          {(documentType === 'constancia_fiscal') && (
            <a
              href="https://satid.sat.gob.mx/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 hover:underline mt-0.5 inline-block"
            >
              ¿No sabes cómo obtenerla? Haz clic aquí →
            </a>
          )}
          {documentType === 'nss' && (
            <a
              href="https://serviciosdigitales.imss.gob.mx/gestionAsegurados-web-externo/asignacionNSS"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 hover:underline mt-0.5 inline-block"
            >
              ¿No sabes cómo obtenerlo? Haz clic aquí →
            </a>
          )}
        </div>
      </div>

      {/* Upload Area */}
      {!isValid && (
        <div
          {...getRootProps()}
          className={`
            mt-3 border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all
            ${isDragActive ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}
            ${isUploading ? 'pointer-events-none opacity-60' : ''}
            ${document.status === 'invalid' ? 'border-red-200' : ''}
          `}
        >
          <input {...getInputProps()} accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png" />

          {isUploading ? (
            <div className="py-2">
              <RefreshCw size={24} className="mx-auto text-primary-500 animate-spin mb-2" />
              <p className="text-sm text-gray-600 mb-2">
                {document.status === 'uploaded'
                ? (documentType === 'foto_profesional' ? 'Procesando foto...' : 'Validando con OCR...')
                : `Subiendo... ${uploadProgress}%`}
              </p>
              {uploading && (
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="py-2">
              <Upload size={24} className="mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">
                {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra o haz clic para subir'}
              </p>
              <p className="text-xs text-gray-400 mt-1">PDF, JPG o PNG · Máx. 50 MB</p>
            </div>
          )}
        </div>
      )}

      {/* Uploaded file info */}
      {document.fileName && document.status !== 'pending' && (
        <div className={`mt-3 flex items-center gap-3 p-3 rounded-lg ${
          isValid ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'
        }`}>
          <File size={16} className={isValid ? 'text-green-600' : 'text-gray-500'} />
          <span className="text-xs text-gray-700 flex-1 truncate">{document.fileName}</span>
          {document.downloadUrl && (
            <a
              href={document.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:text-primary-700"
            >
              <Eye size={16} />
            </a>
          )}
        </div>
      )}

      {/* OCR Result */}
      {document.status === 'valid' && document.ocrResult && (
        <div className="mt-3 p-3 bg-green-50 border border-green-100 rounded-lg">
          <p className="text-xs font-medium text-green-700">Documento validado correctamente</p>
        </div>
      )}

      {/* Error: invalid doc */}
      {document.status === 'invalid' && (
        <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg space-y-2">
          <p className="text-xs font-medium text-red-700">
            Tu documento fue rechazado. Por favor revisa los motivos y sube uno nuevo:
          </p>
          {document.ocrResult?.validationErrors && document.ocrResult.validationErrors.length > 0 ? (
            <ul className="text-xs text-red-600 list-disc pl-4 space-y-1">
              {document.ocrResult.validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-red-600">
              {document.rejectionReason ?? 'El documento no cumple los requisitos. Asegúrate de que sea legible, esté completo y corresponda al tipo solicitado.'}
            </p>
          )}
        </div>
      )}

      {/* Local error */}
      {localError && (
        <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
          <XCircle size={12} /> {localError}
        </p>
      )}
    </div>
  );
}
