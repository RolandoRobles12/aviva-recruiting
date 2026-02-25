import { CheckCircle } from 'lucide-react';
import type { Candidate } from '../../types';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  candidate: Candidate;
}

export function CandidateFormHeader({ candidate: c }: Props) {
  const allDone = c.completionPercentage === 100;

  return (
    <div className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Logo / Brand */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">A</span>
            </div>
            <span className="text-sm font-semibold text-gray-700">Aviva · Proceso de Ingreso</span>
          </div>
          {allDone && (
            <div className="flex items-center gap-1 text-green-600 text-sm font-medium">
              <CheckCircle size={16} />
              Completado
            </div>
          )}
        </div>

        {/* Candidate info */}
        <div className="mb-2">
          <h1 className="text-base font-semibold text-gray-900">
            Hola, {c.firstName} 👋
          </h1>
          <p className="text-xs text-gray-500">Posición: {c.position}</p>
        </div>

        {/* Progress */}
        <ProgressBar percentage={c.completionPercentage} />
        <p className="text-xs text-gray-400 mt-1">
          {c.completionPercentage === 100
            ? 'Todos los documentos han sido recibidos. El equipo los está revisando.'
            : `${c.completionPercentage}% completado · Sube todos los documentos para continuar`}
        </p>
      </div>
    </div>
  );
}
