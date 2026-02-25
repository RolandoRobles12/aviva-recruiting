import { useParams } from 'react-router-dom';
import { CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { useCandidateForm } from '../hooks/useCandidateForm';
import { CandidateFormHeader } from '../components/candidate/CandidateFormHeader';
import { DocumentUploadCard } from '../components/candidate/DocumentUploadCard';
import { DOCUMENT_TYPES } from '../types';

export function CandidateFormPage() {
  const { token } = useParams<{ token: string }>();
  const { candidate, loading, error } = useCandidateForm(token);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Cargando tu formulario...</p>
        </div>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-md w-full text-center">
          <AlertTriangle size={40} className="mx-auto text-yellow-400 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Enlace no válido</h2>
          <p className="text-sm text-gray-500">
            {error ?? 'Este enlace no existe o ha expirado.'}
          </p>
          <p className="text-xs text-gray-400 mt-4">
            Si crees que es un error, contacta directamente al reclutador.
          </p>
        </div>
      </div>
    );
  }

  const isApproved = candidate.status === 'approved';
  const isRejected = candidate.status === 'rejected';

  if (isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-md w-full text-center">
          <CheckCircle size={48} className="mx-auto mb-4" style={{ color: '#16b877' }} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">¡Proceso completado!</h2>
          <p className="text-sm text-gray-600">
            Todos tus documentos han sido validados y aprobados. El equipo de Recursos Humanos
            se pondrá en contacto contigo pronto.
          </p>
        </div>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-md w-full text-center">
          <AlertTriangle size={48} className="mx-auto text-red-400 mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Proceso cancelado</h2>
          <p className="text-sm text-gray-600">
            El proceso de contratación ha sido cancelado. Si tienes alguna duda, contacta
            al equipo de reclutamiento.
          </p>
        </div>
      </div>
    );
  }

  const allDone = candidate.completionPercentage === 100;

  return (
    <div className="min-h-screen bg-aviva-fondo">
      <CandidateFormHeader candidate={candidate} />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Instructions */}
        <div className="card p-4 bg-primary-50 border-primary-100">
          <h2 className="text-sm font-semibold text-primary-900 mb-1">
            Instrucciones
          </h2>
          <ul className="text-xs text-primary-800 space-y-1 list-disc list-inside">
            <li>Sube cada documento de forma individual en su sección correspondiente.</li>
            <li>Formatos aceptados: PDF, JPG o PNG (máx. 10 MB por archivo).</li>
            <li>Asegúrate de que el documento sea legible y no esté cortado.</li>
            <li>Después de subir, el sistema validará automáticamente cada documento.</li>
          </ul>
        </div>

        {/* Document Cards */}
        {DOCUMENT_TYPES.map((type) => (
          <DocumentUploadCard
            key={type}
            candidateId={candidate.id}
            documentType={type}
            document={candidate.documents[type] ?? { id: type, type, status: 'pending' }}
          />
        ))}

        {/* Completion message */}
        {allDone && (
          <div className="card p-5 border-green-200 bg-green-50 text-center">
            <Clock size={28} className="mx-auto text-green-500 mb-2" />
            <h3 className="font-semibold text-green-800 mb-1">
              ¡Todos los documentos recibidos!
            </h3>
            <p className="text-sm text-green-700">
              El equipo de reclutamiento está revisando tu expediente. Te notificaremos
              por correo cuando el proceso avance.
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 pb-8">
          Tus documentos están protegidos y solo son accesibles por el equipo de reclutamiento.
        </p>
      </div>
    </div>
  );
}
