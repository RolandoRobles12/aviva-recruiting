// Violence and substance-use risk, shown apart from the profile.
//
// The profile answers "how well does this person fit the role"; this panel
// answers "is there something here that has to be checked before hiring". The
// two are kept visually separate on purpose: a strong composite must never make
// a high risk look acceptable, and a risk alert is not a score to average.
//
// What the recruiter needs from it, in order: the level (score against the
// configured cutoffs, nothing else), the concrete behaviours the candidate
// admitted (critical items, listed apart and without changing the level),
// whether the answers can be trusted at all, and what to ask in the interview to
// confirm or rule it out.

import { useState } from 'react';
import { AlertOctagon, ChevronRight, Lock, ShieldCheck } from 'lucide-react';
import {
  PSYCHOMETRIC_RISK_LABELS,
  PSYCHOMETRIC_RISK_SCALES,
  type PsychometricRiskCutoffs,
  type PsychometricRiskLevel,
  type PsychometricRiskResult,
  type PsychometricRiskScale,
  type PsychometricValidity,
} from '../../types';
import type { AnsweredQuestion, AnswerTone } from '../../lib/psychometricAnswers';
import { resolveOverallRisk, resolveRiskLevel } from '../../lib/psychometricRisk';

const RISK_LEVEL_META: Record<
  PsychometricRiskLevel,
  { label: string; chip: string; dot: string; bar: string }
> = {
  bajo: { label: 'Riesgo bajo', chip: 'bg-green-50 text-green-700', dot: 'bg-green-500', bar: 'bg-green-500' },
  moderado: {
    label: 'Riesgo moderado',
    chip: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
  },
  alto: { label: 'Riesgo alto', chip: 'bg-red-50 text-red-700', dot: 'bg-red-500', bar: 'bg-red-500' },
};

/** Score bar with the two configured cutoffs marked on it. */
function ScoreBar({
  score,
  level,
  cutoffs,
}: {
  score: number;
  level: PsychometricRiskLevel;
  cutoffs: PsychometricRiskCutoffs;
}) {
  return (
    <div className="relative w-full h-2 bg-gray-100 rounded-full">
      <div className={`h-full rounded-full ${RISK_LEVEL_META[level].bar}`} style={{ width: `${Math.max(score, 2)}%` }} />
      {[cutoffs.moderateMin, cutoffs.highMin].map((cut, index) => (
        <span
          key={index}
          className="absolute -top-0.5 h-3 w-px bg-gray-400"
          style={{ left: `${Math.min(Math.max(cut, 0), 100)}%` }}
          title={index === 0 ? `Moderado desde ${cut}` : `Alto desde ${cut}`}
        />
      ))}
    </div>
  );
}

const RISK_INTERPRETATION: Record<PsychometricRiskScale, Record<PsychometricRiskLevel, string>> = {
  riesgo_violencia: {
    bajo: 'No justifica la agresión y reporta manejar el enojo sin llegar a la confrontación.',
    moderado:
      'Justifica en parte la confrontación o reporta dificultad para controlar el enojo. Conviene explorar cómo maneja clientes y compañeros difíciles.',
    alto:
      'Justifica la agresión o la intimidación, o admite episodios de violencia. Es un riesgo relevante en trato con clientes y en cobranza: verifícalo antes de avanzar.',
  },
  riesgo_adicciones: {
    bajo: 'Actitud clara de no mezclar el consumo con el trabajo.',
    moderado:
      'Actitud permisiva hacia el consumo alrededor del trabajo, o lo usa para manejar el estrés. Conviene explorar puntualidad, ausencias y hábitos en entrevista y referencias.',
    alto:
      'Tolera el consumo en horario laboral o admite que ya afectó su trabajo. Es un riesgo relevante para asistencia, seguridad y trato con clientes: verifícalo antes de avanzar.',
  },
};

/**
 * Behavioural interview probes. They ask about conduct at work, never about
 * diagnoses or treatment, which keeps the follow-up job related.
 */
const INTERVIEW_PROBES: Record<PsychometricRiskScale, { entrevista: string[]; referencias: string }> = {
  riesgo_violencia: {
    entrevista: [
      'Cuéntame de la última vez que un cliente o un compañero te hizo enojar mucho. ¿Qué hiciste exactamente?',
      '¿Algún conflicto en un trabajo anterior terminó en una discusión fuerte o en algo físico? ¿Qué pasó y cómo se resolvió?',
      'Visitas a un cliente con atraso y te insulta frente a su familia. ¿Qué haces?',
    ],
    referencias: 'Pregunta cómo manejaba los conflictos con clientes y compañeros, y si tuvo algún reporte o sanción por ello.',
  },
  riesgo_adicciones: {
    entrevista: [
      '¿Alguna vez faltaste o llegaste tarde por algo que pasó la noche anterior? ¿Cómo lo manejaste?',
      'En tu trabajo anterior, ¿qué reglas había sobre el alcohol en comidas o eventos? ¿Qué opinas de ellas?',
      'Después de una semana muy pesada, ¿qué haces para desestresarte?',
    ],
    referencias: 'Pregunta por su asistencia y puntualidad (sobre todo inicios de semana) y si hubo algún incidente por consumo.',
  },
};

const TONE_STYLES: Record<AnswerTone, string> = {
  favorable: 'text-green-700',
  neutral: 'text-gray-600',
  desfavorable: 'text-red-700',
  sin_responder: 'text-gray-400 italic',
};

function ItemList({ items }: { items: AnsweredQuestion[] }) {
  return (
    <ul className="space-y-2 py-2">
      {items.map(({ question, answerLabel, tone }) => (
        <li key={question.id} className="text-xs">
          <p className="text-gray-700">
            {question.text}
            {question.type === 'likert' && question.reverseScored && (
              <span className="ml-1.5 text-gray-400" title="Afirmación protectora: estar de acuerdo es lo favorable">
                (protectora)
              </span>
            )}
            {question.type === 'likert' && question.critical && (
              <span className="ml-1.5 text-red-500" title="Conducta concreta: si la admite se lista aparte para confirmarla">
                (crítica)
              </span>
            )}
          </p>
          <p className={`font-medium ${TONE_STYLES[tone]}`}>{answerLabel}</p>
        </li>
      ))}
    </ul>
  );
}

function RiskScaleCard({
  scale,
  risk,
  items,
  validity,
  cutoffs,
}: {
  scale: PsychometricRiskScale;
  risk: PsychometricRiskResult | undefined;
  items: AnsweredQuestion[] | null;
  validity: PsychometricValidity;
  cutoffs: PsychometricRiskCutoffs;
}) {
  const [showItems, setShowItems] = useState(false);
  const label = PSYCHOMETRIC_RISK_LABELS[scale];

  if (!risk || risk.itemsApplied === 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm gap-2">
          <span className="text-gray-700 font-medium">{label}</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">No evaluado</span>
        </div>
        <p className="text-xs text-gray-400">
          Esta prueba se aplicó sin preguntas de esta escala (el banco aún no las tenía).
        </p>
      </div>
    );
  }

  const level = resolveRiskLevel(risk, cutoffs);
  const endorsed = new Set(risk.criticalEndorsed);
  const admitted = (items ?? []).filter((item) => endorsed.has(item.question.id));
  const admittedCount = risk.criticalEndorsed.length;
  // Admitted behaviours do not change the level, but they are exactly what an
  // interview should confirm, so the guidance shows for them too.
  const needsFollowUp = level === 'moderado' || level === 'alto' || admittedCount > 0;
  const socialDesirability = validity.flags.includes('posible_deseabilidad_social');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm gap-2">
        <span className="text-gray-700 font-medium">{label}</span>
        {level === null ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Sin datos</span>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-gray-900 font-semibold">{risk.normalizedScore}</span>
            {risk.percentile !== undefined && (
              <span className="text-xs text-gray-400" title="Posición frente a otros candidatos; no define el nivel">
                pc {risk.percentile}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${RISK_LEVEL_META[level].chip}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${RISK_LEVEL_META[level].dot}`} />
              {RISK_LEVEL_META[level].label}
            </span>
          </div>
        )}
      </div>

      {level === null ? (
        <p className="text-xs text-gray-400">
          Solo respondió {risk.itemsAnswered} de {risk.itemsApplied} preguntas: insuficiente para calcular el nivel de
          este riesgo.
        </p>
      ) : (
        <>
          <ScoreBar score={risk.normalizedScore} level={level} cutoffs={cutoffs} />
          <p className="text-xs text-gray-400">
            Moderado desde {cutoffs.moderateMin}, alto desde {cutoffs.highMin}.
          </p>
          <p className="text-xs text-gray-500">
            {level === 'bajo' && admittedCount > 0
              ? 'El puntaje de la escala es bajo, pero admitió conductas concretas que conviene confirmar en entrevista.'
              : RISK_INTERPRETATION[scale][level]}
          </p>
        </>
      )}

      {admittedCount > 0 && (
        <div className="rounded-md bg-red-50 border border-red-100 px-2.5 py-2 space-y-1">
          <p className="text-xs font-semibold text-red-800">
            Admitió {admittedCount === 1 ? 'una conducta concreta' : `${admittedCount} conductas concretas`}:
          </p>
          {items === null ? (
            <p className="text-xs text-red-700">Cargando...</p>
          ) : (
            <ul className="space-y-1">
              {admitted.map(({ question, answerLabel }) => (
                <li key={question.id} className="text-xs text-red-800">
                  • {question.text} <span className="font-medium">({answerLabel})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-red-700/80">No cambian el nivel de riesgo: confírmalas en la entrevista.</p>
        </div>
      )}

      {level === 'bajo' && socialDesirability && (
        <p className="text-xs text-amber-700">
          Contestó buscando dar buena impresión: un riesgo bajo aquí puede no reflejar la realidad. Vale la pena
          confirmarlo con referencias.
        </p>
      )}

      {needsFollowUp && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer text-gray-700 font-medium">Qué verificar en entrevista y referencias</summary>
          <ul className="list-disc list-inside space-y-1 pt-1.5">
            {INTERVIEW_PROBES[scale].entrevista.map((probe) => (
              <li key={probe}>{probe}</li>
            ))}
          </ul>
          <p className="pt-1.5">
            <span className="font-medium">Referencias:</span> {INTERVIEW_PROBES[scale].referencias}
          </p>
        </details>
      )}

      <button
        onClick={() => setShowItems((open) => !open)}
        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <ChevronRight size={12} className={`transition-transform ${showItems ? 'rotate-90' : ''}`} />
        {showItems ? 'Ocultar respuestas' : 'Ver todas sus respuestas'}
      </button>
      {showItems && (
        <div className="pl-3 border-l-2 border-gray-100">
          {items === null ? <p className="text-xs text-gray-400 py-2">Cargando respuestas...</p> : <ItemList items={items} />}
        </div>
      )}
    </div>
  );
}

export function RiskPanel({
  risks,
  validity,
  itemsByScale,
  cutoffs,
}: {
  risks: Partial<Record<PsychometricRiskScale, PsychometricRiskResult>> | undefined;
  validity: PsychometricValidity;
  itemsByScale: Record<PsychometricRiskScale, AnsweredQuestion[]> | null;
  /** Current config cutoffs: levels are resolved against these, not the stored ones. */
  cutoffs: PsychometricRiskCutoffs;
}) {
  const overallRisk = resolveOverallRisk(risks, cutoffs);
  const alert = overallRisk === 'alto' || overallRisk === 'moderado';
  const unreliable = validity.verdict === 'no_confiable';

  const frame = !risks
    ? 'border-gray-200 bg-gray-50'
    : overallRisk === 'alto'
      ? 'border-red-200 bg-red-50/40'
      : overallRisk === 'moderado'
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-gray-200';

  return (
    <div className={`rounded-lg border p-3 space-y-3 ${frame}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
        {alert ? (
          <AlertOctagon size={14} className={overallRisk === 'alto' ? 'text-red-600' : 'text-amber-600'} />
        ) : (
          <ShieldCheck size={14} className="text-gray-500" />
        )}
        Riesgos: violencia y consumo de sustancias
      </div>

      {!risks ? (
        <p className="text-xs text-gray-500">
          Esta prueba se aplicó antes de incluir las escalas de riesgo. Para evaluarlas, genera un enlace nuevo.
        </p>
      ) : (
        <>
          {unreliable && (
            <p className="text-xs text-red-700">
              El resultado no es confiable: no interpretes estos niveles hasta volver a aplicar la prueba. Las
              conductas admitidas sí vale la pena explorarlas en entrevista.
            </p>
          )}
          {PSYCHOMETRIC_RISK_SCALES.map((scale) => (
            <RiskScaleCard
              key={scale}
              scale={scale}
              risk={risks[scale]}
              items={itemsByScale?.[scale] ?? null}
              validity={validity}
              cutoffs={cutoffs}
            />
          ))}
        </>
      )}

      <p className="text-xs text-gray-400 flex gap-1.5 pt-2 border-t border-gray-100">
        <Lock size={12} className="shrink-0 mt-0.5" />
        <span>
          No es un diagnóstico ni sustituye un examen toxicológico: mide actitudes y conductas que el candidato
          reporta. Úsalo para orientar la entrevista y las referencias, no como único motivo de rechazo. Es
          información sensible: no la compartas fuera del proceso de selección.
        </span>
      </p>
    </div>
  );
}
