import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Check,
  AlertTriangle,
  Download,
  Info,
} from 'lucide-react';
import type {
  PsychometricAttentionQuestion,
  PsychometricLikertQuestion,
  PsychometricLikertScale,
  PsychometricQuestion,
  PsychometricSjtQuestion,
  PsychometricTestConfig,
} from '../../types';
import {
  PSYCHOMETRIC_LIKERT_SCALES,
  PSYCHOMETRIC_SCALE_LABELS,
  PSYCHOMETRIC_SCORED_SCALES,
  PSYCHOMETRIC_TRAITS,
  PSYCHOMETRIC_VALIDITY_SCALES,
} from '../../types';
import {
  getPsychometricQuestions,
  savePsychometricQuestions,
  getPsychometricConfig,
  savePsychometricConfig,
  validateBank,
  type BankValidationIssue,
} from '../../services/psychometricQuestions';
import { seedPsychometricBank } from '../../services/functions';

const LIKERT_VALUE_LABELS = [
  '1 · Totalmente en desacuerdo',
  '2 · En desacuerdo',
  '3 · Neutral',
  '4 · De acuerdo',
  '5 · Totalmente de acuerdo',
];

const SJT_SCORE_OPTIONS = [0, 1, 2, 3];

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function QuestionBankTab() {
  const [questions, setQuestions] = useState<PsychometricQuestion[]>([]);
  const [config, setConfig] = useState<PsychometricTestConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getPsychometricQuestions(), getPsychometricConfig()])
      .then(([qs, cfg]) => {
        setQuestions(qs.sort((a, b) => a.order - b.order));
        setConfig(cfg);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Error al cargar el banco de preguntas'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const markDirty = () => {
    setSaved(false);
    setSaveError(null);
  };

  const update = (id: string, patch: Partial<PsychometricQuestion>) => {
    markDirty();
    setQuestions((prev) => prev.map((q) => (q.id === id ? ({ ...q, ...patch } as PsychometricQuestion) : q)));
  };

  /** Moves an item within its own type group, keeping a single global order. */
  const move = (id: string, dir: -1 | 1) => {
    markDirty();
    setQuestions((prev) => {
      const target = prev.find((q) => q.id === id);
      if (!target) return prev;
      const sameType = prev.filter((q) => q.type === target.type);
      const localIdx = sameType.findIndex((q) => q.id === id);
      const swapWith = sameType[localIdx + dir];
      if (!swapWith) return prev;

      const arr = [...prev];
      const a = arr.findIndex((q) => q.id === id);
      const b = arr.findIndex((q) => q.id === swapWith.id);
      [arr[a], arr[b]] = [arr[b], arr[a]];
      return arr.map((q, i) => ({ ...q, order: i }));
    });
  };

  const remove = (id: string) => {
    markDirty();
    setQuestions((prev) => prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const addLikert = (scale: PsychometricLikertScale) => {
    markDirty();
    const newQ: PsychometricLikertQuestion = {
      id: generateId('lik'),
      type: 'likert',
      text: '',
      scale,
      reverseScored: false,
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  const addAttention = () => {
    markDirty();
    const newQ: PsychometricAttentionQuestion = {
      id: generateId('aten'),
      type: 'attention',
      text: 'Para verificar que estás leyendo con calma, selecciona "En desacuerdo" en esta afirmación.',
      expectedValue: 2,
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  const addSjt = () => {
    markDirty();
    const newQ: PsychometricSjtQuestion = {
      id: generateId('sjt'),
      type: 'sjt',
      text: '',
      options: [
        { text: '', score: 3 },
        { text: '', score: 2 },
        { text: '', score: 1 },
        { text: '', score: 0 },
      ],
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  const updateSjtOption = (qId: string, optIdx: number, patch: { text?: string; score?: number }) => {
    markDirty();
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId || q.type !== 'sjt') return q;
        const options = [...q.options];
        options[optIdx] = { ...options[optIdx], ...patch };
        return { ...q, options };
      })
    );
  };

  const addSjtOption = (qId: string) => {
    markDirty();
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qId && q.type === 'sjt' ? { ...q, options: [...q.options, { text: '', score: 0 }] } : q
      )
    );
  };

  const removeSjtOption = (qId: string, optIdx: number) => {
    markDirty();
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qId && q.type === 'sjt'
          ? { ...q, options: q.options.filter((_, i) => i !== optIdx) }
          : q
      )
    );
  };

  const issues = useMemo(
    () => (config ? validateBank(questions, config) : []),
    [questions, config]
  );
  const errors = issues.filter((issue) => issue.level === 'error');

  const handleSave = async () => {
    if (!config) return;
    if (errors.length > 0) {
      setSaveError('Corrige los errores marcados antes de guardar.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await savePsychometricQuestions(questions);
      await savePsychometricConfig(config);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async (mode: 'append' | 'replace') => {
    if (mode === 'replace' && !window.confirm('Esto reemplaza todo el banco actual por el banco base. ¿Continuar?')) {
      return;
    }
    setSeeding(true);
    setSeedMessage(null);
    try {
      const { data } = await seedPsychometricBank({ mode, applyConfig: mode === 'replace' });
      setSeedMessage(
        `Banco base cargado: ${data.added} preguntas agregadas, ${data.skipped} ya existían. Total: ${data.total}.`
      );
      load();
    } catch (err) {
      setSeedMessage(err instanceof Error ? err.message : 'No se pudo cargar el banco base.');
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200">
        Error al cargar el banco de preguntas: {loadError}
      </div>
    );
  }

  const likertQuestions = questions.filter((q): q is PsychometricLikertQuestion => q.type === 'likert');
  const attentionQuestions = questions.filter((q): q is PsychometricAttentionQuestion => q.type === 'attention');
  const sjtQuestions = questions.filter((q): q is PsychometricSjtQuestion => q.type === 'sjt');

  const countFor = (scale: PsychometricLikertScale) => {
    const items = likertQuestions.filter((q) => q.scale === scale && q.enabled);
    return { total: items.length, reversed: items.filter((q) => q.reverseScored).length };
  };

  const issueFor = (id: string) => issues.filter((issue) => issue.questionId === id);

  return (
    <div className="space-y-6 max-w-3xl">
      {questions.length === 0 && (
        <div className="card p-4 space-y-3 border-primary-200 bg-primary-50/40">
          <div className="flex gap-2">
            <Info size={16} className="text-primary-600 shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 space-y-1">
              <p className="font-medium text-gray-900">El banco está vacío</p>
              <p>
                Puedes cargar el banco base: 5 rasgos con 14 ítems cada uno (mitad invertidos), escalas de
                validez, controles de atención y 14 escenarios de juicio situacional, redactados para los
                puestos de crédito, venta y cobranza. Después puedes editar, desactivar o agregar lo que
                necesites.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleSeed('append')}
            disabled={seeding}
            className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2"
          >
            <Download size={14} /> {seeding ? 'Cargando...' : 'Cargar banco base'}
          </button>
        </div>
      )}

      {seedMessage && <div className="card p-3 text-xs text-gray-600">{seedMessage}</div>}

      {/* Coverage summary — the thing that actually determines whether a score is
          interpretable, so it sits above the item list. */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Cobertura del banco</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PSYCHOMETRIC_LIKERT_SCALES.map((scale) => {
            const { total, reversed } = countFor(scale);
            const applied =
              config && config.questionCounts.likertPerTrait > 0 && PSYCHOMETRIC_TRAITS.includes(scale as never)
                ? Math.min(config.questionCounts.likertPerTrait, total)
                : total;
            const thin = PSYCHOMETRIC_TRAITS.includes(scale as never) && applied < 6;
            return (
              <div key={scale} className="text-xs">
                <p className="text-gray-500">{PSYCHOMETRIC_SCALE_LABELS[scale]}</p>
                <p className={thin ? 'text-amber-600 font-medium' : 'text-gray-900 font-medium'}>
                  {total} activos · {reversed} invertidos
                </p>
              </div>
            );
          })}
          <div className="text-xs">
            <p className="text-gray-500">Escenarios SJT</p>
            <p className="text-gray-900 font-medium">{sjtQuestions.filter((q) => q.enabled).length} activos</p>
          </div>
          <div className="text-xs">
            <p className="text-gray-500">Controles de atención</p>
            <p className="text-gray-900 font-medium">{attentionQuestions.filter((q) => q.enabled).length} activos</p>
          </div>
        </div>
        {questions.length > 0 && (
          <button
            onClick={() => handleSeed('append')}
            disabled={seeding}
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <Download size={12} /> {seeding ? 'Cargando...' : 'Completar con el banco base (no sobrescribe lo existente)'}
          </button>
        )}
      </div>

      <IssueList issues={issues.filter((issue) => !issue.questionId)} />

      {/* Personality items, grouped by scale */}
      {PSYCHOMETRIC_LIKERT_SCALES.map((scale) => {
        const items = likertQuestions.filter((q) => q.scale === scale);
        const isValidityScale = (PSYCHOMETRIC_VALIDITY_SCALES as string[]).includes(scale);
        return (
          <div key={scale} className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{PSYCHOMETRIC_SCALE_LABELS[scale]}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {isValidityScale
                    ? scale === 'deseabilidad_social'
                      ? 'Afirmaciones deseables pero improbables. No suman al perfil: solo alertan de un posible intento de dar buena impresión.'
                      : 'Afirmaciones que nadie puede sostener con honestidad. Estar de acuerdo indica que no se está leyendo.'
                    : 'Escala 1 (Totalmente en desacuerdo) a 5 (Totalmente de acuerdo). Mezcla ítems normales e invertidos.'}
                </p>
              </div>
              <button
                onClick={() => addLikert(scale)}
                className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2 shrink-0"
              >
                <Plus size={14} /> Agregar
              </button>
            </div>

            {items.map((q, idx) => (
              <div key={q.id} className="card p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={q.text}
                      onChange={(e) => update(q.id, { text: e.target.value })}
                      placeholder="Texto de la afirmación"
                      className="input-field text-sm w-full"
                    />
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        value={q.scale}
                        onChange={(e) => update(q.id, { scale: e.target.value as PsychometricLikertScale })}
                        className="input-field text-xs py-1.5 w-auto"
                      >
                        {PSYCHOMETRIC_LIKERT_SCALES.map((s) => (
                          <option key={s} value={s}>{PSYCHOMETRIC_SCALE_LABELS[s]}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={q.reverseScored}
                          onChange={(e) => update(q.id, { reverseScored: e.target.checked })}
                          className="rounded"
                        />
                        Invertida
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={q.enabled}
                          onChange={(e) => update(q.id, { enabled: e.target.checked })}
                          className="rounded"
                        />
                        Activa
                      </label>
                    </div>
                    <IssueList issues={issueFor(q.id)} compact />
                  </div>
                  <ItemControls
                    onUp={() => move(q.id, -1)}
                    onDown={() => move(q.id, 1)}
                    onRemove={() => remove(q.id)}
                    disableUp={idx === 0}
                    disableDown={idx === items.length - 1}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* Attention checks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Controles de atención</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              El texto indica qué opción marcar. Es la señal más directa de que alguien no está leyendo:
              fallar dos marca el resultado como no confiable.
            </p>
          </div>
          <button onClick={addAttention} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2 shrink-0">
            <Plus size={14} /> Agregar
          </button>
        </div>

        {attentionQuestions.map((q, idx) => (
          <div key={q.id} className="card p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <textarea
                  value={q.text}
                  onChange={(e) => update(q.id, { text: e.target.value })}
                  placeholder="Instrucción (debe decir explícitamente qué opción elegir)"
                  rows={2}
                  className="input-field text-sm w-full"
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="text-xs text-gray-600 flex items-center gap-1.5">
                    Respuesta esperada
                    <select
                      value={q.expectedValue}
                      onChange={(e) => update(q.id, { expectedValue: Number(e.target.value) })}
                      className="input-field text-xs py-1.5 w-auto"
                    >
                      {LIKERT_VALUE_LABELS.map((label, i) => (
                        <option key={i} value={i + 1}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={q.enabled}
                      onChange={(e) => update(q.id, { enabled: e.target.checked })}
                      className="rounded"
                    />
                    Activo
                  </label>
                </div>
                <IssueList issues={issueFor(q.id)} compact />
              </div>
              <ItemControls
                onUp={() => move(q.id, -1)}
                onDown={() => move(q.id, 1)}
                onRemove={() => remove(q.id)}
                disableUp={idx === 0}
                disableDown={idx === attentionQuestions.length - 1}
              />
            </div>
          </div>
        ))}
      </div>

      {/* SJT scenarios */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Escenarios de juicio situacional (SJT)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Ordena las opciones por efectividad: el puntaje más alto es la mejor respuesta. El máximo de
              cada escenario se toma de su propia opción más alta, así que puedes usar escalas 0-2 o 0-3.
            </p>
          </div>
          <button onClick={addSjt} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2 shrink-0">
            <Plus size={14} /> Agregar
          </button>
        </div>

        {sjtQuestions.map((q, idx) => (
          <div key={q.id} className="card p-4 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <textarea
                  value={q.text}
                  onChange={(e) => update(q.id, { text: e.target.value })}
                  placeholder="Escenario"
                  rows={2}
                  className="input-field text-sm w-full"
                />
                <input
                  type="text"
                  value={q.competency ?? ''}
                  onChange={(e) => update(q.id, { competency: e.target.value })}
                  placeholder="Competencia evaluada (opcional, solo informativa)"
                  className="input-field text-xs py-1.5 w-full"
                />
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex gap-1.5 items-center">
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => updateSjtOption(q.id, oi, { text: e.target.value })}
                      placeholder={`Opción ${oi + 1}`}
                      className="input-field text-xs py-1.5 flex-1"
                    />
                    <select
                      value={opt.score}
                      onChange={(e) => updateSjtOption(q.id, oi, { score: Number(e.target.value) })}
                      className="input-field text-xs py-1.5 w-20"
                    >
                      {SJT_SCORE_OPTIONS.map((score) => (
                        <option key={score} value={score}>{score} pts</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeSjtOption(q.id, oi)}
                      disabled={q.options.length <= 2}
                      className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => addSjtOption(q.id)} className="text-xs text-primary-600 hover:text-primary-700">
                    + Agregar opción
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={q.enabled}
                      onChange={(e) => update(q.id, { enabled: e.target.checked })}
                      className="rounded"
                    />
                    Activo
                  </label>
                </div>
                <IssueList issues={issueFor(q.id)} compact />
              </div>
              <ItemControls
                onUp={() => move(q.id, -1)}
                onDown={() => move(q.id, 1)}
                onRemove={() => remove(q.id)}
                disableUp={idx === 0}
                disableDown={idx === sjtQuestions.length - 1}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Weights & bands */}
      {config && (
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Ponderación del score compuesto</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Los pesos se normalizan entre sí, no tienen que sumar 1. Una escala sin datos suficientes se
              excluye y su peso se reparte entre las demás.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PSYCHOMETRIC_SCORED_SCALES.map((scale) => (
              <label key={scale} className="text-xs text-gray-600 space-y-1">
                {PSYCHOMETRIC_SCALE_LABELS[scale]}
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={config.weights[scale]}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, weights: { ...config.weights, [scale]: Number(e.target.value) } });
                  }}
                  className="input-field text-xs py-1.5 w-full"
                />
              </label>
            ))}
          </div>

          <div className="pt-3 border-t border-gray-100 space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-gray-900">Bandas con normas locales</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Cuando ya hay suficientes pruebas aplicadas, la banda se calcula por percentil frente a los
                demás candidatos. Es la forma correcta de leer un puntaje de autorreporte: en términos
                absolutos casi todos se agrupan en el tercio alto.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="text-xs text-gray-600 space-y-1">
                "Bajo" hasta percentil &lt;
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={config.percentileCutoffs.lowMaxPercentile}
                  onChange={(e) => {
                    markDirty();
                    setConfig({
                      ...config,
                      percentileCutoffs: {
                        ...config.percentileCutoffs,
                        lowMaxPercentile: Number(e.target.value),
                      },
                    });
                  }}
                  className="input-field text-xs py-1.5 w-24"
                />
              </label>
              <label className="text-xs text-gray-600 space-y-1">
                "Alto" desde percentil &gt;=
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={config.percentileCutoffs.highMinPercentile}
                  onChange={(e) => {
                    markDirty();
                    setConfig({
                      ...config,
                      percentileCutoffs: {
                        ...config.percentileCutoffs,
                        highMinPercentile: Number(e.target.value),
                      },
                    });
                  }}
                  className="input-field text-xs py-1.5 w-24"
                />
              </label>
              <label className="flex items-end gap-1.5 text-xs text-gray-600 cursor-pointer pb-1.5">
                <input
                  type="checkbox"
                  checked={config.useLocalNorms}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, useLocalNorms: e.target.checked });
                  }}
                  className="rounded"
                />
                Usar normas locales cuando alcancen
              </label>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-gray-900">Cortes absolutos (respaldo)</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Se usan mientras la muestra local no alcanza, y el resultado se etiqueta como tal.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="text-xs text-gray-600 space-y-1">
                Banda "bajo" hasta (score &lt;)
                <input
                  type="number"
                  value={config.bandCutoffs.lowMax}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, bandCutoffs: { ...config.bandCutoffs, lowMax: Number(e.target.value) } });
                  }}
                  className="input-field text-xs py-1.5 w-24"
                />
              </label>
              <label className="text-xs text-gray-600 space-y-1">
                Banda "alto" desde (score &gt;=)
                <input
                  type="number"
                  value={config.bandCutoffs.highMin}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, bandCutoffs: { ...config.bandCutoffs, highMin: Number(e.target.value) } });
                  }}
                  className="input-field text-xs py-1.5 w-24"
                />
              </label>
              <label className="text-xs text-gray-600 space-y-1">
                Tiempo límite (minutos)
                <input
                  type="number"
                  value={config.timeLimitMinutes}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, timeLimitMinutes: Number(e.target.value) });
                  }}
                  className="input-field text-xs py-1.5 w-24"
                />
              </label>
              <label className="text-xs text-gray-600 space-y-1">
                Mínimo de ítems por escala
                <input
                  type="number"
                  min={1}
                  value={config.minItemsPerScale}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, minItemsPerScale: Number(e.target.value) });
                  }}
                  className="input-field text-xs py-1.5 w-24"
                />
              </label>
            </div>
            <p className="text-xs text-gray-400">
              Con estos cortes absolutos: <span className="text-red-600 font-medium">Bajo 0–{config.bandCutoffs.lowMax - 1}</span>,{' '}
              <span className="text-amber-600 font-medium">Medio {config.bandCutoffs.lowMax}–{config.bandCutoffs.highMin - 1}</span>,{' '}
              <span className="text-green-600 font-medium">Alto {config.bandCutoffs.highMin}–100</span>.
            </p>
          </div>
        </div>
      )}

      {/* Question sampling per session */}
      {config && (
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Preguntas aplicadas por sesión</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              En 0 (todas) se aplican todas las preguntas activas. Con un número, cada sesión toma esa
              cantidad del banco: los ítems por rasgo se eligen balanceando normales e invertidos.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <CountField
              label="Ítems Likert por rasgo"
              hint={`Disponibles: ${PSYCHOMETRIC_TRAITS.map((t) => countFor(t).total).join(' / ')}`}
              value={config.questionCounts.likertPerTrait}
              onChange={(likertPerTrait) => {
                markDirty();
                setConfig({ ...config, questionCounts: { ...config.questionCounts, likertPerTrait } });
              }}
            />
            <CountField
              label="Escenarios SJT"
              hint={`Disponibles: ${sjtQuestions.filter((q) => q.enabled).length}`}
              value={config.questionCounts.sjt}
              onChange={(sjt) => {
                markDirty();
                setConfig({ ...config, questionCounts: { ...config.questionCounts, sjt } });
              }}
            />
            <CountField
              label="Ítems de deseabilidad social"
              hint={`Disponibles: ${countFor('deseabilidad_social').total}`}
              value={config.questionCounts.deseabilidadSocial}
              onChange={(deseabilidadSocial) => {
                markDirty();
                setConfig({ ...config, questionCounts: { ...config.questionCounts, deseabilidadSocial } });
              }}
            />
            <CountField
              label="Ítems de infrecuencia"
              hint={`Disponibles: ${countFor('infrecuencia').total}`}
              value={config.questionCounts.infrecuencia}
              onChange={(infrecuencia) => {
                markDirty();
                setConfig({ ...config, questionCounts: { ...config.questionCounts, infrecuencia } });
              }}
            />
            <CountField
              label="Controles de atención"
              hint={`Disponibles: ${attentionQuestions.filter((q) => q.enabled).length}`}
              value={config.questionCounts.atencion}
              onChange={(atencion) => {
                markDirty();
                setConfig({ ...config, questionCounts: { ...config.questionCounts, atencion } });
              }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        <button
          onClick={handleSave}
          disabled={saving || errors.length > 0}
          className="btn-primary text-sm flex items-center gap-2 px-4 py-2 disabled:opacity-50"
        >
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

function CountField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs text-gray-600 space-y-1">
      {label} (0 = todos)
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-field text-xs py-1.5 w-full"
      />
      <span className="block text-gray-400">{hint}</span>
    </label>
  );
}

function ItemControls({
  onUp,
  onDown,
  onRemove,
  disableUp,
  disableDown,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  disableUp: boolean;
  disableDown: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <button onClick={onUp} disabled={disableUp} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
        <ChevronUp size={14} />
      </button>
      <button onClick={onDown} disabled={disableDown} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
        <ChevronDown size={14} />
      </button>
      <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function IssueList({ issues, compact }: { issues: BankValidationIssue[]; compact?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <ul className={compact ? 'space-y-0.5' : 'card p-3 space-y-1 bg-amber-50 border-amber-200'}>
      {issues.map((issue, index) => (
        <li
          key={index}
          className={`text-xs flex items-start gap-1.5 ${
            issue.level === 'error' ? 'text-red-600' : 'text-amber-700'
          }`}
        >
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
