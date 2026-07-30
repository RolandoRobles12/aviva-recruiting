import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  analyzePsychometricBank,
  resetPsychometricNorms,
  type PsychometricBankWarning,
  type PsychometricItemAnalysis,
  type PsychometricNormSummary,
  type PsychometricScaleAnalysis,
} from '../../services/functions';
import { PSYCHOMETRIC_SCALE_LABELS, PSYCHOMETRIC_SCORED_SCALES } from '../../types';

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

/** Scopes a warning can carry that are not scales. */
const SCOPE_LABELS: Record<string, string> = {
  configuracion: 'Configuración',
  atencion: 'Preguntas de control',
  bandas: 'Bandas de calificación',
  ponderacion: 'Ponderación',
};

function labelFor(scale: string): string {
  return (
    PSYCHOMETRIC_SCALE_LABELS[scale as keyof typeof PSYCHOMETRIC_SCALE_LABELS] ??
    SCOPE_LABELS[scale] ??
    scale
  );
}

// ─── Turning statistics into something a recruiter can act on ─────────────────
//
// This tab used to print a table of α, DE and "n mínimo por par". Those are the
// right numbers, but they answer a question nobody on the recruiting team is
// asking. The three questions they do have are: can I trust these scores, what
// do I have to fix, and can I already compare candidates with each other. Every
// block below answers one of them in words, and the numbers stay available
// behind "ver detalle técnico" for whoever wants them.

type Quality = 'buena' | 'aceptable' | 'ruido' | 'insuficiente' | 'sin_datos';

const QUALITY: Record<
  Quality,
  { label: string; explanation: string; bar: string; text: string; width: string }
> = {
  buena: {
    label: 'Mide bien',
    explanation: 'Las preguntas de esta escala concuerdan entre sí: el puntaje es sólido.',
    bar: 'bg-green-500',
    text: 'text-green-700',
    width: 'w-full',
  },
  aceptable: {
    label: 'Mide correctamente',
    explanation: 'El puntaje es utilizable para apoyar una decisión.',
    bar: 'bg-green-500',
    text: 'text-green-700',
    width: 'w-3/4',
  },
  ruido: {
    label: 'Mide con ruido',
    explanation:
      'El puntaje tiene margen de error: úsalo como orientación, no para separar candidatos parecidos.',
    bar: 'bg-amber-500',
    text: 'text-amber-700',
    width: 'w-1/2',
  },
  insuficiente: {
    label: 'No mide de forma confiable',
    explanation:
      'Las preguntas de esta escala no están midiendo lo mismo. Revisa las que aparecen abajo antes de usarla para decidir.',
    bar: 'bg-red-500',
    text: 'text-red-700',
    width: 'w-1/4',
  },
  sin_datos: {
    label: 'Aún sin evidencia',
    explanation: 'Faltan pruebas aplicadas para poder evaluar esta escala.',
    bar: 'bg-gray-300',
    text: 'text-gray-500',
    width: 'w-0',
  },
};

/** Conventional reading of an internal-consistency coefficient. */
function qualityOf(alpha: number | null): Quality {
  if (alpha === null) return 'sin_datos';
  if (alpha >= 0.8) return 'buena';
  if (alpha >= 0.7) return 'aceptable';
  if (alpha >= 0.6) return 'ruido';
  return 'insuficiente';
}

export interface InstrumentAnalysisTabProps {
  /** Jump to an item's editor in the bank tab. */
  onEditItem?: (questionId: string) => void;
}

export function InstrumentAnalysisTab({ onEditItem }: InstrumentAnalysisTabProps = {}) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

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
        'Esto borra la comparación acumulada entre candidatos. Las bandas volverán a cortes fijos hasta juntar pruebas nuevas. ¿Continuar?'
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

  // The recruiter's view covers the five traits plus the scenarios; the two
  // response-style scales only matter to whoever maintains the instrument, so
  // they live in the technical detail.
  const reportedScales = analysis.scales.filter((scale) =>
    (PSYCHOMETRIC_SCORED_SCALES as string[]).includes(scale.scale)
  );

  const problemItems = analysis.items.filter((item) => item.issues.length > 0);
  const blockingProblems = warnings.filter((warning) => warning.level === 'error');
  const unreliableScales = reportedScales.filter((scale) => qualityOf(scale.alpha) === 'insuficiente');
  const measuringScales = reportedScales.filter((scale) =>
    ['buena', 'aceptable'].includes(qualityOf(scale.alpha))
  );

  const compositeNorm = norms.find((norm) => norm.key === 'composite');
  const normCount = compositeNorm?.n ?? 0;

  const noData = analysis.sessionsAnalyzed === 0;
  const needsAttention = blockingProblems.length > 0 || unreliableScales.length > 0;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <BarChart3 size={15} className="text-primary-600" /> Análisis del instrumento
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Qué tan bien está funcionando la prueba, con base en lo que han respondido los candidatos.
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 shrink-0"
        >
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>

      {/* ── Question 1: can I trust this? ── */}
      <div
        className={`card p-4 border ${
          noData
            ? 'border-gray-200'
            : needsAttention
              ? 'border-amber-200 bg-amber-50/40'
              : 'border-green-200 bg-green-50/40'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {noData ? (
            <HelpCircle size={18} className="text-gray-400 shrink-0 mt-0.5" />
          ) : needsAttention ? (
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-gray-900">
              {noData
                ? 'Todavía no hay pruebas para analizar'
                : needsAttention
                  ? 'La prueba necesita atención'
                  : 'La prueba está funcionando bien'}
            </p>
            {noData ? (
              <p className="text-xs text-gray-600">
                En cuanto los candidatos empiecen a responder, aquí verás si la prueba está midiendo bien
                y qué preguntas conviene ajustar.
              </p>
            ) : (
              <ul className="text-xs text-gray-600 space-y-1">
                <li>
                  Se analizaron <strong>{analysis.sessionsAnalyzed} pruebas</strong>.
                  {analysis.sessionsExcluded > 0 && (
                    <>
                      {' '}
                      Se dejaron fuera {analysis.sessionsExcluded} porque el candidato respondió sin
                      leer y no reflejan su perfil.
                    </>
                  )}
                </li>
                <li>
                  <strong>
                    {measuringScales.length} de {reportedScales.length}
                  </strong>{' '}
                  partes de la prueba miden de forma confiable.
                </li>
                {unreliableScales.length > 0 && (
                  <li className="text-amber-700">
                    {unreliableScales.length === 1
                      ? `"${labelFor(unreliableScales[0].scale)}" no está midiendo de forma confiable.`
                      : `${unreliableScales.length} partes no están midiendo de forma confiable.`}
                  </li>
                )}
                {blockingProblems.length > 0 && (
                  <li className="text-red-700">
                    Hay {blockingProblems.length}{' '}
                    {blockingProblems.length === 1 ? 'problema' : 'problemas'} de configuración que
                    impiden calificar bien.
                  </li>
                )}
                {problemItems.length > 0 && (
                  <li>
                    {problemItems.length}{' '}
                    {problemItems.length === 1 ? 'pregunta conviene revisarla' : 'preguntas conviene revisarlas'}.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── Question 2: what do I have to fix? ── */}
      {warnings.length > 0 && (
        <div className="card p-4 space-y-2">
          <h4 className="text-xs font-semibold text-gray-900">Cosas por arreglar</h4>
          <p className="text-xs text-gray-500">
            Se corrigen desde la pestaña "Banco de preguntas".
          </p>
          <ul className="space-y-1 pt-1">
            {warnings.map((warning, index) => (
              <li
                key={index}
                className={`text-xs flex items-start gap-1.5 ${
                  warning.level === 'error' ? 'text-red-700' : 'text-amber-700'
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

      {/* ── How well does each part measure? ── */}
      <div className="card p-4 space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Qué tan bien mide cada parte</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Una escala "mide bien" cuando sus preguntas concuerdan entre sí: quien responde alto en una
            responde alto en las demás. Si no concuerdan, el puntaje de esa escala no es de fiar.
          </p>
        </div>

        <div className="space-y-3 pt-1">
          {reportedScales.map((scale) => {
            const quality = qualityOf(scale.alpha);
            const meta = QUALITY[quality];
            const preliminary =
              quality !== 'sin_datos' && scale.n > 0 && scale.n < 30;

            return (
              <div key={scale.scale} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-700 font-medium">{labelFor(scale.scale)}</span>
                  <span className={`text-xs font-medium ${meta.text}`}>
                    {meta.label}
                    {preliminary && <span className="text-gray-400 font-normal"> · preliminar</span>}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${meta.bar} ${meta.width}`} />
                </div>
                <p className="text-xs text-gray-500">
                  {quality === 'sin_datos' && scale.n > 0
                    ? `Se necesitan más pruebas aplicadas para evaluarla (van ${scale.n}).`
                    : meta.explanation}
                </p>
                {scale.scale === 'sjt' && quality !== 'sin_datos' && (
                  <p className="text-xs text-gray-400">
                    En los escenarios esta medida suele salir más baja de lo que corresponde, porque cada
                    uno evalúa una situación distinta. Tómala con holgura.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Question 3: can I already compare candidates? ── */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
              <Users size={13} className="text-primary-600" /> Comparación entre candidatos
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Un puntaje de personalidad solo dice algo comparado con el de otros candidatos. Al juntar
              suficientes pruebas, el sistema deja de usar cortes fijos y empieza a decir en qué lugar
              queda cada persona frente al resto.
            </p>
          </div>
          {normCount > 0 && (
            <button
              onClick={handleResetNorms}
              disabled={resetting}
              className="text-xs text-gray-400 hover:text-red-600 flex items-center gap-1 shrink-0"
              title="Borra la comparación acumulada y vuelve a empezar"
            >
              <RotateCcw size={12} /> {resetting ? 'Reiniciando...' : 'Reiniciar'}
            </button>
          )}
        </div>

        <NormProgress count={normCount} thresholds={thresholds} />
      </div>

      {/* ── Items worth reviewing ── */}
      <div className="card p-4 space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">
            Preguntas que conviene revisar ({problemItems.length})
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Preguntas que ocupan tiempo de la prueba sin aportar información: porque casi todos las
            responden igual, o porque quien las contesta alto no coincide con el resto de su escala.
          </p>
        </div>
        {problemItems.length === 0 ? (
          <p className="text-xs text-gray-400">
            {analysis.sessionsAnalyzed === 0
              ? 'Se evaluarán en cuanto haya pruebas respondidas.'
              : 'Ninguna pregunta presenta problemas con la información disponible.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {problemItems.map((item) => (
              <div key={item.id} className="border-b border-gray-50 pb-2.5 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-900">{item.text}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {item.scale ? labelFor(item.scale) : 'Control de atención'}
                      {item.reverseScored ? ' · invertida' : ''} · respondida por {item.n} candidatos
                    </p>
                  </div>
                  {onEditItem && (
                    <button
                      onClick={() => onEditItem(item.id)}
                      className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 shrink-0"
                      title="Abrir esta pregunta en el banco"
                    >
                      <PencilLine size={11} /> Editar
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
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

      {/* ── The numbers, for whoever wants them ── */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setShowTechnical((value) => !value)}
          className="w-full flex items-center gap-2 p-4 text-left hover:bg-gray-50"
        >
          <ChevronRight
            size={15}
            className={`text-gray-400 transition-transform ${showTechnical ? 'rotate-90' : ''}`}
          />
          <span className="text-xs font-semibold text-gray-900">Detalle técnico</span>
          <span className="text-xs text-gray-400">
            alfa de Cronbach, medias, desviaciones y tamaños de muestra
          </span>
        </button>

        {showTechnical && (
          <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                Alfa de Cronbach sobre las sesiones acumuladas. Como cada sesión aplica una muestra
                distinta de ítems, se estima con las covarianzas por pares de ítems; "n mín. por par"
                indica cuánta evidencia sostiene el número.
              </p>
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
                    {analysis.scales.map((scale) => (
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
                        <td className={`py-1.5 pr-3 font-medium ${QUALITY[qualityOf(scale.alpha)].text}`}>
                          {scale.alpha ?? '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-gray-400">{scale.minPairwiseN ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2 pt-3 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-700">Muestra normativa por escala</p>
              {norms.length === 0 ? (
                <p className="text-xs text-gray-400">Sin observaciones acumuladas.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {norms.map((norm) => (
                    <div key={norm.key} className="text-xs">
                      <p className="text-gray-500">
                        {norm.key === 'composite' ? 'Score compuesto' : labelFor(norm.key)}
                      </p>
                      <p className="text-gray-900 font-medium">
                        n = {norm.n} · media {norm.mean ?? '—'} · DE {norm.sd ?? '—'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {problemItems.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-700">Estadísticos de los ítems marcados</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 text-left border-b border-gray-100">
                        <th className="py-1.5 pr-3 font-medium">Ítem</th>
                        <th className="py-1.5 pr-3 font-medium">n</th>
                        <th className="py-1.5 pr-3 font-medium">Media</th>
                        <th className="py-1.5 pr-3 font-medium">DE</th>
                        <th className="py-1.5 pr-3 font-medium">r ítem-total</th>
                        <th className="py-1.5 pr-3 font-medium">Aciertos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemItems.map((item) => (
                        <tr key={item.id} className="border-b border-gray-50">
                          <td className="py-1.5 pr-3 text-gray-700 max-w-xs truncate" title={item.text}>
                            {item.text}
                          </td>
                          <td className="py-1.5 pr-3 text-gray-600">{item.n}</td>
                          <td className="py-1.5 pr-3 text-gray-600">{item.mean ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-600">{item.sd ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-600">
                            {item.itemTotalCorrelation ?? '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-gray-600">
                            {item.passRate !== undefined ? `${Math.round(item.passRate * 100)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Actualizado el {new Date(analysis.generatedAtIso).toLocaleString('es-MX')}. Las pruebas marcadas
        como no confiables se dejan fuera de todos los cálculos: incluirlas haría parecer malas a
        preguntas que funcionan bien.
      </p>
    </div>
  );
}

/**
 * The norm sample as progress toward a goal. "n = 45 · media 72.3 · DE 8.1"
 * told a recruiter nothing; "45 de 100" tells them exactly where they stand.
 */
function NormProgress({
  count,
  thresholds,
}: {
  count: number;
  thresholds: { provisional: number; stable: number };
}) {
  const pct = Math.min(100, Math.round((count / thresholds.stable) * 100));
  const stage = count >= thresholds.stable ? 'estable' : count >= thresholds.provisional ? 'provisional' : 'inicial';

  const copy = {
    inicial: {
      title: `Faltan ${thresholds.provisional - count} pruebas para empezar a comparar`,
      body: `Por ahora los resultados usan cortes fijos, y así aparecen etiquetados en el reporte de cada candidato. Al llegar a ${thresholds.provisional} pruebas confiables el sistema empieza a comparar entre candidatos.`,
      color: 'bg-gray-400',
    },
    provisional: {
      title: 'Ya se compara entre candidatos, de forma provisional',
      body: `Los resultados ya dicen en qué lugar queda cada persona frente al resto. Con ${thresholds.stable} pruebas la comparación se vuelve estable; faltan ${thresholds.stable - count}.`,
      color: 'bg-amber-500',
    },
    estable: {
      title: 'La comparación entre candidatos es estable',
      body: 'Los resultados ubican a cada candidato frente a una muestra suficiente de aspirantes al mismo tipo de puesto.',
      color: 'bg-green-500',
    },
  }[stage];

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">{copy.title}</p>
        <p className="text-xs text-gray-500 shrink-0">
          <strong className="text-gray-900">{count}</strong> de {thresholds.stable}
        </p>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden relative">
        <div className={`h-full rounded-full ${copy.color} transition-all`} style={{ width: `${pct}%` }} />
        {/* Marker for the point where comparison switches on. */}
        <div
          className="absolute top-0 bottom-0 w-px bg-gray-400"
          style={{ left: `${(thresholds.provisional / thresholds.stable) * 100}%` }}
          title={`${thresholds.provisional} pruebas`}
        />
      </div>
      <p className="text-xs text-gray-500">{copy.body}</p>
    </div>
  );
}
