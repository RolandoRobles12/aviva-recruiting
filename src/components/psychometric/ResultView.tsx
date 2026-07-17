import type { PsychometricBand, PsychometricSession, PsychometricTrait, PsychometricTraitResult } from '../../types';
import { PSYCHOMETRIC_TRAIT_LABELS, PSYCHOMETRIC_TRAITS } from '../../types';

const BAND_META: Record<PsychometricBand, { label: string; chip: string; dot: string; bar: string; ring: string }> = {
  bajo: { label: 'Bajo', chip: 'bg-red-50 text-red-700', dot: 'bg-red-500', bar: 'bg-red-500', ring: '#ef4444' },
  medio: { label: 'Medio', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500', ring: '#f59e0b' },
  alto: { label: 'Alto', chip: 'bg-green-50 text-green-700', dot: 'bg-green-500', bar: 'bg-green-500', ring: '#22c55e' },
};

// Short, job-relevant interpretation per trait+band — helps the recruiter
// read a number as something more actionable than just "medio: 58".
const TRAIT_INTERPRETATION: Record<PsychometricTrait, Record<PsychometricBand, string>> = {
  responsabilidad: {
    bajo: 'Puede necesitar seguimiento más cercano para cumplir plazos y mantener el orden.',
    medio: 'Cumple de forma consistente en la mayoría de los casos.',
    alto: 'Alta constancia y disciplina en el cumplimiento de tareas.',
  },
  estabilidad_emocional: {
    bajo: 'Puede mostrar mayor sensibilidad al estrés o al rechazo en piso de venta.',
    medio: 'Maneja la presión de forma razonable en la mayoría de las situaciones.',
    alto: 'Buen manejo del estrés y recuperación rápida ante contratiempos.',
  },
  extraversion: {
    bajo: 'Puede preferir tareas con menor exposición social o de prospección activa.',
    medio: 'Cómodo con el contacto social en un nivel moderado.',
    alto: 'Alta iniciativa social y comodidad en la prospección de clientes.',
  },
  amabilidad: {
    bajo: 'Prioriza sus propios intereses; puede necesitar reforzar la orientación de servicio.',
    medio: 'Buen equilibrio entre servicio al cliente y firmeza.',
    alto: 'Fuerte orientación de servicio y empatía con el cliente.',
  },
};

const SJT_INTERPRETATION: Record<PsychometricBand, string> = {
  bajo: 'Sus respuestas ante escenarios de venta/cobranza se alejan de la práctica recomendada.',
  medio: 'Juicio situacional razonable, con oportunidad de reforzar algunos escenarios.',
  alto: 'Buen juicio práctico ante situaciones típicas de venta y cobranza.',
};

const COMPOSITE_INTERPRETATION: Record<PsychometricBand, string> = {
  bajo: 'Perfil con áreas de oportunidad relevantes para el puesto.',
  medio: 'Perfil dentro del rango esperado para el puesto.',
  alto: 'Perfil alineado con los rasgos deseados para el puesto.',
};

function ScoreRing({ score, band }: { score: number; band: PsychometricBand }) {
  const color = BAND_META[band].ring;
  return (
    <div
      className="relative w-20 h-20 rounded-full shrink-0"
      style={{ background: `conic-gradient(${color} ${score * 3.6}deg, #e5e7eb 0deg)` }}
    >
      <div className="absolute inset-[6px] bg-white rounded-full flex items-center justify-center">
        <span className="text-xl font-bold text-gray-900">{score}</span>
      </div>
    </div>
  );
}

function TraitBar({
  label,
  result,
  interpretation,
}: {
  label: string;
  result: PsychometricTraitResult;
  interpretation: string;
}) {
  const meta = BAND_META[result.band];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-700 font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-gray-900 font-semibold">{result.normalizedScore}</span>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </div>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${meta.bar} transition-all`} style={{ width: `${result.normalizedScore}%` }} />
      </div>
      <p className="text-xs text-gray-500">{interpretation}</p>
    </div>
  );
}

export function ResultView({ session }: { session: PsychometricSession }) {
  const result = session.result;
  if (!result) return null;

  const startedAt = session.startedAt?.toDate?.();
  const completedAt = session.completedAt?.toDate?.();
  const elapsedMinutes =
    startedAt && completedAt ? Math.round((completedAt.getTime() - startedAt.getTime()) / 60000) : null;

  return (
    <div className="space-y-5">
      {/* Header: candidate + composite gauge */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{session.candidateName}</p>
          <p className="text-xs text-gray-500 truncate">{session.candidateEmail}</p>
          {elapsedMinutes !== null && (
            <p className="text-xs text-gray-400 mt-1">
              Completada en {elapsedMinutes} de {session.timeLimitMinutes} min
              {completedAt ? ` · ${completedAt.toLocaleDateString('es-MX')}` : ''}
            </p>
          )}
        </div>
        <ScoreRing score={result.compositeScore} band={result.compositeBand} />
      </div>
      <p className="text-xs text-gray-500 -mt-3">{COMPOSITE_INTERPRETATION[result.compositeBand]}</p>

      {/* Traits */}
      <div className="space-y-3 pt-1 border-t border-gray-100">
        {PSYCHOMETRIC_TRAITS.map((trait) => (
          <TraitBar
            key={trait}
            label={PSYCHOMETRIC_TRAIT_LABELS[trait]}
            result={result.traits[trait]}
            interpretation={TRAIT_INTERPRETATION[trait][result.traits[trait].band]}
          />
        ))}
        <TraitBar
          label="Juicio situacional"
          result={result.sjt}
          interpretation={SJT_INTERPRETATION[result.sjt.band]}
        />
      </div>

      <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
        Prueba piloto interna: los puntajes son relativos a esta primera versión del instrumento y aún no
        cuentan con validación estadística sobre una muestra amplia de candidatos. Úsalos como apoyo
        cualitativo en la decisión, no como filtro determinante.
      </p>
    </div>
  );
}
