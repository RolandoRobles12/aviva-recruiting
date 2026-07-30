import { useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, RefreshCw, RotateCcw } from 'lucide-react';
import {
  analyzePsychometricBank,
  resetPsychometricNorms,
  type PsychometricBankWarning,
  type PsychometricItemAnalysis,
  type PsychometricNormSummary,
  type PsychometricScaleAnalysis,
} from '../../services/functions';
import { PSYCHOMETRIC_SCALE_LABELS } from '../../types';

type Analysis = {
  sessionsAnalyzed: number;
  sessionsExcluded: number;
  scales: PsychometricScaleAnalysis[];
  items: PsychometricItemAnalysis[];
  generatedAtIso: string;
};

interface Report {
  analysis: Analysis;
  warnings: PsychometricBankWarning[];
  norms: PsychometricNormSummary[];
  thresholds: { provisional: number; stable: number };
  sessionsRead: number;
  truncated: boolean;
}

function labelFor(scale: string): string {
  return PSYCHOMETRIC_SCALE_LABELS[scale as keyof typeof PSYCHOMETRIC_SCALE_LABELS] ?? scale;
}

/** Conventional reading of an internal-consistency coefficient. */
function alphaVerdict(alpha: number | null): { text: string; className: string } {
  if (alpha === null) return { text: 'sin estimar', className: 'text-gray-400' };
  if (alpha >= 0.8) return { text: 'buena', className: 'text-green-600' };
  if (alpha >= 0.7) return { text: 'aceptable', className: 'text-green-600' };
  if (alpha >= 0.6) return { text: 'limitada', className: 'text-amber-600' };
  return { text: 'insuficiente', className: 'text-red-600' };
}

const NORM_STATUS_COPY: Record<PsychometricNormSummary['status'], { label: string; className: string }> = {
  sin_datos: { label: 'Aún insuficiente', className: 'text-gray-500' },
  provisional: { label: 'Provisional', className: 'text-amber-600' },
  estable: { label: 'Estable', className: 'text-green-600' },
};

export function InstrumentAnalysisTab() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    analyzePsychometricBank({})
      .then(({ data }) => setReport(data as Report))
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo generar el análisis.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleResetNorms = async () => {
    if (
      !window.confirm(
        'Esto borra la muestra de normas locales y las bandas volverán a cortes absolutos hasta acumular nuevas pruebas. ¿Continuar?'
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      await resetPsychometricNorms({});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron reiniciar las normas.');
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200 space-y-2">
        <p>{error}</p>
        <button onClick={load} className="text-xs underline">Intentar de nuevo</button>
      </div>
    );
  }

  if (!report) return null;

  const { analysis, warnings, norms, thresholds } = report;
  const problemItems = analysis.items.filter((item) => item.issues.length > 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <BarChart3 size={15} className="text-primary-600" /> Análisis del instrumento
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {analysis.sessionsAnalyzed} sesiones completadas analizadas
            {analysis.sessionsExcluded > 0 && `, ${analysis.sessionsExcluded} excluidas por respuesta no confiable`}.
            {report.truncated && ' Se leyó el máximo de sesiones por consulta.'}
          </p>
        </div>
        <button onClick={load} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 shrink-0">
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>

      {/* Configuration problems that make scores uninterpretable */}
      {warnings.length > 0 && (
        <div className="card p-4 space-y-2">
          <h4 className="text-xs font-semibold text-gray-900">Revisión de configuración</h4>
          <ul className="space-y-1">
            {warnings.map((warning, index) => (
              <li
                key={index}
                className={`text-xs flex items-start gap-1.5 ${
                  warning.level === 'error' ? 'text-red-600' : 'text-amber-700'
                }`}
              >
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium">{labelFor(warning.scope)}:</span> {warning.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reliability per scale */}
      <div className="card p-4 space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Consistencia interna por escala</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Alfa de Cronbach sobre las sesiones acumuladas. Como cada sesión aplica una muestra distinta de
            ítems, se estima por pares de ítems: la columna "n mínimo por par" indica cuánta evidencia
            sostiene el número.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-100">
                <th className="py-1.5 pr-3 font-medium">Escala</th>
                <th className="py-1.5 pr-3 font-medium">Ítems</th>
                <th className="py-1.5 pr-3 font-medium">n</th>
                <th className="py-1.5 pr-3 font-medium">Media</th>
                <th className="py-1.5 pr-3 font-medium">DE</th>
                <th className="py-1.5 pr-3 font-medium">α</th>
                <th className="py-1.5 pr-3 font-medium">n mín. por par</th>
              </tr>
            </thead>
            <tbody>
              {analysis.scales.map((scale) => {
                const verdict = alphaVerdict(scale.alpha);
                return (
                  <tr key={scale.scale} className="border-b border-gray-50 align-top">
                    <td className="py-1.5 pr-3 text-gray-900">
                      {labelFor(scale.scale)}
                      {scale.notes.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {scale.notes.map((note, index) => (
                            <li key={index} className="text-gray-400">{note}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-600">
                      {scale.itemsAnalyzed}/{scale.itemsInBank}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-600">{scale.n}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{scale.mean ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{scale.sd ?? '—'}</td>
                    <td className={`py-1.5 pr-3 font-medium ${verdict.className}`}>
                      {scale.alpha ?? '—'} <span className="font-normal">({verdict.text})</span>
                    </td>
                    <td className="py-1.5 pr-3 text-gray-400">{scale.minPairwiseN ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Local norms */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-semibold text-gray-900">Muestra de normas locales</h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Las bandas pasan a percentiles desde {thresholds.provisional} pruebas confiables (provisional) y
              se consideran estables desde {thresholds.stable}.
            </p>
          </div>
          <button
            onClick={handleResetNorms}
            disabled={resetting}
            className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1 shrink-0"
          >
            <RotateCcw size={12} /> {resetting ? 'Reiniciando...' : 'Reiniciar normas'}
          </button>
        </div>
        {norms.length === 0 ? (
          <p className="text-xs text-gray-400">
            Todavía no hay pruebas confiables acumuladas: las bandas usan cortes absolutos.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {norms.map((norm) => {
              const status = NORM_STATUS_COPY[norm.status];
              return (
                <div key={norm.key} className="text-xs">
                  <p className="text-gray-500">{norm.key === 'composite' ? 'Score compuesto' : labelFor(norm.key)}</p>
                  <p className="text-gray-900 font-medium">
                    n = {norm.n} · media {norm.mean ?? '—'} · DE {norm.sd ?? '—'}
                  </p>
                  <p className={status.className}>{status.label}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Items worth reviewing */}
      <div className="card p-4 space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Ítems a revisar ({problemItems.length})</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Correlación ítem-total corregida: qué tanto cada ítem coincide con el resto de su escala. Un ítem
            con correlación baja ocupa tiempo de la prueba sin aportar información — reformúlalo o
            desactívalo desde "Banco de preguntas".
          </p>
        </div>
        {problemItems.length === 0 ? (
          <p className="text-xs text-gray-400">
            Ningún ítem presenta problemas con la evidencia disponible.
          </p>
        ) : (
          <div className="space-y-2">
            {problemItems.map((item) => (
              <div key={item.id} className="border-b border-gray-50 pb-2 last:border-0">
                <p className="text-xs text-gray-900">{item.text}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {item.scale ? labelFor(item.scale) : 'Control de atención'}
                  {item.reverseScored ? ' · invertido' : ''} · n = {item.n}
                  {item.mean !== null && ` · media ${item.mean}`}
                  {item.sd !== null && ` · DE ${item.sd}`}
                  {item.itemTotalCorrelation !== null && ` · r = ${item.itemTotalCorrelation}`}
                  {item.passRate !== undefined && ` · aciertos ${Math.round(item.passRate * 100)}%`}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {item.issues.map((issue, index) => (
                    <li key={index} className="text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Análisis generado el {new Date(analysis.generatedAtIso).toLocaleString('es-MX')}. Las sesiones marcadas
        como no confiables se excluyen de todos los cálculos: incluirlas atenúa las correlaciones y hace
        parecer malos a ítems que funcionan bien.
      </p>
    </div>
  );
}
