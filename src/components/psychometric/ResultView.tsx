import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Info, ShieldAlert, ShieldCheck } from 'lucide-react';
import type {
  PsychometricBand,
  PsychometricBandCutoffs,
  PsychometricNormSource,
  PsychometricPercentileCutoffs,
  PsychometricQuestion,
  PsychometricScaleResult,
  PsychometricScoredScale,
  PsychometricSession,
  PsychometricTrait,
  PsychometricValidity,
  PsychometricValidityFlag,
  PsychometricValidityVerdict,
} from '../../types';
import { PSYCHOMETRIC_SCALE_LABELS, PSYCHOMETRIC_SCORED_SCALES } from '../../types';
import {
  getPsychometricConfig,
  getPsychometricQuestions,
} from '../../services/psychometricQuestions';
import { adaptPsychometricResult, isLegacyResult } from '../../lib/psychometricResult';
import {
  answersForScale,
  controlAnswers,
  type AnsweredQuestion,
  type AnswerTone,
} from '../../lib/psychometricAnswers';

const BAND_META: Record<PsychometricBand, { label: string; chip: string; dot: string; bar: string; ring: string }> = {
  bajo: { label: 'Bajo', chip: 'bg-red-50 text-red-700', dot: 'bg-red-500', bar: 'bg-red-500', ring: '#ef4444' },
  medio: { label: 'Medio', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500', ring: '#f59e0b' },
  alto: { label: 'Alto', chip: 'bg-green-50 text-green-700', dot: 'bg-green-500', bar: 'bg-green-500', ring: '#22c55e' },
};

const VERDICT_META: Record<
  PsychometricValidityVerdict,
  { label: string; className: string; icon: typeof ShieldCheck; summary: string }
> = {
  confiable: {
    label: 'Resultado confiable',
    className: 'bg-green-50 border-green-200 text-green-800',
    icon: ShieldCheck,
    summary: 'Los controles de calidad de respuesta no detectaron problemas.',
  },
  revisar: {
    label: 'Revisar con cautela',
    className: 'bg-amber-50 border-amber-200 text-amber-800',
    icon: AlertTriangle,
    summary: 'Hay señales de que el patrón de respuesta puede no reflejar el perfil real.',
  },
  no_confiable: {
    label: 'Resultado no confiable',
    className: 'bg-red-50 border-red-200 text-red-800',
    icon: ShieldAlert,
    summary:
      'El patrón de respuesta indica que la prueba no se contestó con atención. Se recomienda volver a aplicarla antes de usar estos puntajes.',
  },
};

const VALIDITY_FLAG_COPY: Record<PsychometricValidityFlag, string> = {
  respuestas_incompletas: 'Dejó preguntas sin responder, probablemente por falta de tiempo.',
  control_atencion_fallido:
    'Falló preguntas de control que indican explícitamente qué opción marcar: señal de que no estaba leyendo.',
  patron_repetitivo: 'Marcó la misma opción muchas veces seguidas.',
  baja_variacion: 'Sus respuestas casi no varían entre preguntas distintas.',
  respuestas_muy_rapidas: 'Respondió más rápido de lo que toma leer las preguntas.',
  respuestas_inconsistentes:
    'Contestó de forma contradictoria entre preguntas que miden lo mismo en sentido inverso.',
  inconsistencia_par_impar: 'Las dos mitades de cada escala describen perfiles distintos.',
  escala_infrecuencia_alta:
    'Estuvo de acuerdo con afirmaciones que nadie puede sostener con honestidad (respuesta al azar o sin leer).',
  posible_deseabilidad_social:
    'Su perfil se acerca a "la respuesta ideal" en casi todo: posible intento de dar buena impresión. Los puntajes no se ajustan por esto, pero conviene verificar con entrevista y referencias.',
};

const NORM_SOURCE_COPY: Record<PsychometricNormSource, string> = {
  absoluta: 'Cortes absolutos (aún sin muestra local suficiente)',
  normas_provisionales: 'Percentiles con normas locales provisionales',
  normas_locales: 'Percentiles con normas locales',
};

// Short, job-relevant interpretation per trait+band — helps the recruiter read a
// number as something more actionable than just "medio: 58".
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
  integridad: {
    bajo: 'Tolera atajos y omisiones cuando la meta aprieta. Conviene profundizar en entrevista y referencias.',
    medio: 'Apego razonable a las reglas, con margen para reforzar criterios en casos límite.',
    alto: 'Fuerte apego a procedimientos y transparencia con el cliente.',
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

interface Cutoffs {
  bandCutoffs: PsychometricBandCutoffs;
  percentileCutoffs: PsychometricPercentileCutoffs;
}

const DEFAULT_CUTOFFS: Cutoffs = {
  bandCutoffs: { lowMax: 55, highMin: 75 },
  percentileCutoffs: { lowMaxPercentile: 25, highMinPercentile: 75 },
};

function bandRange(band: PsychometricBand, source: PsychometricNormSource, cutoffs: Cutoffs): string {
  if (source === 'absoluta') {
    const { lowMax, highMin } = cutoffs.bandCutoffs;
    if (band === 'bajo') return `0–${lowMax - 1}`;
    if (band === 'medio') return `${lowMax}–${highMin - 1}`;
    return `${highMin}–100`;
  }
  const { lowMaxPercentile, highMinPercentile } = cutoffs.percentileCutoffs;
  if (band === 'bajo') return `pc <${lowMaxPercentile}`;
  if (band === 'medio') return `pc ${lowMaxPercentile}–${highMinPercentile - 1}`;
  return `pc ≥${highMinPercentile}`;
}

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

const TONE_STYLES: Record<AnswerTone, { text: string; dot: string }> = {
  favorable: { text: 'text-green-700', dot: 'bg-green-500' },
  neutral: { text: 'text-gray-600', dot: 'bg-gray-300' },
  desfavorable: { text: 'text-red-700', dot: 'bg-red-500' },
  sin_responder: { text: 'text-gray-400 italic', dot: 'bg-gray-200' },
};

/** The candidate's own answers, item by item. */
function AnswerList({ items }: { items: AnsweredQuestion[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 py-1">No se aplicaron preguntas de esta escala.</p>;
  }
  return (
    <ul className="space-y-2 py-2">
      {items.map(({ question, answerLabel, scored, max, tone }) => {
        const style = TONE_STYLES[tone];
        return (
          <li key={question.id} className="flex gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${style.dot}`} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-700">
                {question.text}
                {question.type === 'likert' && question.reverseScored && (
                  <span
                    className="ml-1.5 text-gray-400"
                    title="Ítem invertido: estar en desacuerdo es lo favorable"
                  >
                    (invertida)
                  </span>
                )}
              </p>
              <p className={`text-xs font-medium ${style.text}`}>
                {answerLabel}
                {scored !== undefined && question.type === 'sjt' && (
                  <span className="text-gray-400 font-normal"> · {scored} de {max} pts</span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ScaleBar({
  label,
  result,
  interpretation,
  cutoffs,
  items,
  expanded,
  onToggle,
}: {
  label: string;
  result: PsychometricScaleResult;
  interpretation: string;
  cutoffs: Cutoffs;
  items: AnsweredQuestion[] | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const canExpand = result.itemsApplied > 0 || (items?.length ?? 0) > 0;

  const detail = expanded && (
    <div className="pl-3 border-l-2 border-gray-100">
      {items === null ? (
        <p className="text-xs text-gray-400 py-2">Cargando respuestas...</p>
      ) : (
        <AnswerList items={items} />
      )}
    </div>
  );

  if (!result.hasData) {
    return (
      <div className="space-y-1">
        <button
          onClick={canExpand ? onToggle : undefined}
          className={`w-full flex items-center justify-between text-sm gap-2 text-left ${
            canExpand ? 'cursor-pointer' : 'cursor-default'
          }`}
        >
          <span className="flex items-center gap-1 text-gray-700 font-medium">
            {canExpand && (
              <ChevronRight
                size={13}
                className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            )}
            {label}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
            Sin datos
          </span>
        </button>
        <p className="text-xs text-gray-400">
          {result.itemsApplied === 0
            ? 'No se aplicaron ítems de esta escala.'
            : `Solo respondió ${result.itemsAnswered} de ${result.itemsApplied} ítems: insuficiente para reportar un puntaje.`}
        </p>
        {detail}
      </div>
    );
  }

  const meta = BAND_META[result.band];
  return (
    <div className="space-y-1.5">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm gap-2 text-left group"
      >
        <span className="flex items-center gap-1 text-gray-700 font-medium">
          <ChevronRight
            size={13}
            className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="group-hover:text-gray-900">{label}</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-gray-900 font-semibold">{result.normalizedScore}</span>
          {result.percentile !== undefined && (
            <span className="text-xs text-gray-400">pc {result.percentile}</span>
          )}
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {meta.label} ({bandRange(result.band, result.bandSource, cutoffs)})
          </span>
        </div>
      </button>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${meta.bar} transition-all`} style={{ width: `${result.normalizedScore}%` }} />
      </div>
      <p className="text-xs text-gray-500">{interpretation}</p>
      {detail}
    </div>
  );
}

function interpretationFor(scale: PsychometricScoredScale, band: PsychometricBand): string {
  return scale === 'sjt' ? SJT_INTERPRETATION[band] : TRAIT_INTERPRETATION[scale][band];
}

function ValidityPanel({
  validity,
  controls,
}: {
  validity: PsychometricValidity;
  controls: AnsweredQuestion[];
}) {
  const meta = VERDICT_META[validity.verdict];
  const Icon = meta.icon;
  const { indices } = validity;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${meta.className}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Icon size={14} />
        {meta.label}
      </div>
      <p className="text-xs opacity-90">{meta.summary}</p>

      {validity.flags.length > 0 && (
        <ul className="space-y-1 pt-1">
          {validity.flags.map((flag) => (
            <li key={flag} className="text-xs opacity-90">
              • {VALIDITY_FLAG_COPY[flag]}
            </li>
          ))}
        </ul>
      )}

      <details className="text-xs opacity-80">
        <summary className="cursor-pointer">Ver indicadores de calidad de respuesta</summary>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2">
          <Indicator label="Preguntas respondidas" value={`${Math.round(indices.completionRate * 100)}%`} />
          {indices.attentionChecksTotal > 0 && (
            <Indicator
              label="Controles de atención"
              value={`${indices.attentionChecksTotal - indices.attentionChecksFailed}/${indices.attentionChecksTotal} correctos`}
            />
          )}
          <Indicator label="Racha de la misma opción" value={`${indices.longString} seguidas`} />
          {indices.irv !== null && (
            <Indicator label="Variación de respuestas (DE)" value={indices.irv.toFixed(2)} />
          )}
          {indices.medianResponseMs !== null && (
            <Indicator label="Tiempo mediano por pregunta" value={`${(indices.medianResponseMs / 1000).toFixed(1)} s`} />
          )}
          <Indicator
            label="Respuestas demasiado rápidas"
            value={`${Math.round(indices.fastResponseRatio * 100)}%`}
          />
          {indices.keyingInconsistency !== null && (
            <Indicator label="Inconsistencia normal/invertida" value={indices.keyingInconsistency.toFixed(2)} />
          )}
          {indices.evenOddConsistency !== null && (
            <Indicator label="Consistencia par-impar" value={indices.evenOddConsistency.toFixed(2)} />
          )}
          {indices.infrequencyScore !== null && (
            <Indicator label="Escala de infrecuencia" value={`${indices.infrequencyScore}/100`} />
          )}
          {indices.socialDesirabilityScore !== null && (
            <Indicator label="Deseabilidad social" value={`${indices.socialDesirabilityScore}/100`} />
          )}
        </dl>
      </details>

      {/* When a result comes back flagged, the first thing worth reading is what
          the candidate actually put on the control items. */}
      {controls.length > 0 && (
        <details className="text-xs opacity-80">
          <summary className="cursor-pointer">Ver respuestas a las preguntas de control</summary>
          <div className="bg-white/60 rounded-lg px-2 mt-2">
            <AnswerList items={controls} />
          </div>
        </details>
      )}
    </div>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="opacity-70">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function ResultView({ session }: { session: PsychometricSession }) {
  const result = adaptPsychometricResult(session.result);
  const [cutoffs, setCutoffs] = useState<Cutoffs>(DEFAULT_CUTOFFS);
  const [expanded, setExpanded] = useState<PsychometricScoredScale | null>(null);
  const [bank, setBank] = useState<PsychometricQuestion[] | null>(null);

  useEffect(() => {
    getPsychometricConfig().then((cfg) =>
      setCutoffs({ bandCutoffs: cfg.bandCutoffs, percentileCutoffs: cfg.percentileCutoffs })
    );
  }, []);

  // Sessions applied by the current scorer carry their own question snapshot, so
  // nothing else is needed. Older ones only stored ids, and the bank is the only
  // way to recover the wording — fetched once, and only if it is actually needed.
  const needsBank = !session.appliedQuestions?.length;
  useEffect(() => {
    if (!needsBank || bank !== null) return;
    getPsychometricQuestions()
      .then(setBank)
      .catch(() => setBank([]));
  }, [needsBank, bank]);

  const ready = !needsBank || bank !== null;
  const answersByScale = useMemo(() => {
    if (!ready) return null;
    const resolved = bank ?? [];
    return Object.fromEntries(
      PSYCHOMETRIC_SCORED_SCALES.map((scale) => [scale, answersForScale(session, resolved, scale)])
    ) as Record<PsychometricScoredScale, AnsweredQuestion[]>;
  }, [session, bank, ready]);

  const controls = useMemo(
    () => (ready ? controlAnswers(session, bank ?? []) : []),
    [session, bank, ready]
  );

  if (!result) return null;

  const startedAt = session.startedAt?.toDate?.();
  const completedAt = session.completedAt?.toDate?.();
  const elapsedMinutes =
    startedAt && completedAt ? Math.round((completedAt.getTime() - startedAt.getTime()) / 60000) : null;

  return (
    <div className="space-y-5">
      <ValidityPanel validity={result.validity} controls={controls} />

      {isLegacyResult(result) && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 flex gap-2">
          <Info size={14} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">
            Resultado calificado con la versión anterior del instrumento: no incluye la escala de
            integridad, los controles de atención ni la comparación con la muestra de candidatos. No es
            comparable con los resultados nuevos.
          </p>
        </div>
      )}

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
        {result.compositeHasData && (
          <div className="text-right">
            <ScoreRing score={result.compositeScore} band={result.compositeBand} />
            <p className="text-xs text-gray-400 mt-1">
              {bandRange(result.compositeBand, result.compositeBandSource, cutoffs)}
            </p>
          </div>
        )}
      </div>

      {result.compositeHasData ? (
        <div className="-mt-3 space-y-1">
          <p className="text-xs text-gray-500">{COMPOSITE_INTERPRETATION[result.compositeBand]}</p>
          <p className="text-xs text-gray-400">
            {NORM_SOURCE_COPY[result.compositeBandSource]}
            {result.compositePercentile !== undefined && result.normSampleSize > 0
              ? ` · percentil ${result.compositePercentile} sobre ${result.normSampleSize} candidatos`
              : ''}
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-400 -mt-3">
          No hay suficientes respuestas para calcular un score compuesto.
        </p>
      )}

      {/* Scales. Each one opens to show the exact items and what was answered. */}
      <div className="space-y-3 pt-1 border-t border-gray-100">
        <p className="text-xs text-gray-400">Toca una categoría para ver las preguntas y sus respuestas.</p>
        {PSYCHOMETRIC_SCORED_SCALES.map((scale) => {
          const scaleResult = result.scales[scale];
          if (!scaleResult) return null;
          return (
            <ScaleBar
              key={scale}
              label={PSYCHOMETRIC_SCALE_LABELS[scale]}
              result={scaleResult}
              interpretation={interpretationFor(scale, scaleResult.band)}
              cutoffs={cutoffs}
              items={answersByScale?.[scale] ?? null}
              expanded={expanded === scale}
              onToggle={() => setExpanded((current) => (current === scale ? null : scale))}
            />
          );
        })}
      </div>

      <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
        Los puntajes son un apoyo cualitativo en la decisión, no un filtro determinante: úsalos junto con
        la entrevista y las referencias. Mientras la muestra de candidatos sea pequeña, las bandas usan
        cortes absolutos y se etiquetan como tales; al acumular suficientes pruebas pasan a percentiles
        sobre la muestra local. Los cortes, pesos y el estado de las normas se revisan en las pestañas
        "Banco de preguntas" y "Análisis del instrumento".
      </p>
    </div>
  );
}
