import { useEffect, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Save, Check } from 'lucide-react';
import type {
  PsychometricQuestion,
  PsychometricLikertQuestion,
  PsychometricSjtQuestion,
  PsychometricTestConfig,
  PsychometricTrait,
} from '../../types';
import { PSYCHOMETRIC_TRAIT_LABELS, PSYCHOMETRIC_TRAITS } from '../../types';
import {
  getPsychometricQuestions,
  savePsychometricQuestions,
  getPsychometricConfig,
  savePsychometricConfig,
} from '../../services/psychometricQuestions';

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

  useEffect(() => {
    Promise.all([getPsychometricQuestions(), getPsychometricConfig()])
      .then(([qs, cfg]) => {
        setQuestions(qs.sort((a, b) => a.order - b.order));
        setConfig(cfg);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Error al cargar el banco de preguntas'))
      .finally(() => setLoading(false));
  }, []);

  const markDirty = () => setSaved(false);

  const update = (id: string, patch: Partial<PsychometricQuestion>) => {
    markDirty();
    setQuestions((prev) => prev.map((q) => (q.id === id ? ({ ...q, ...patch } as PsychometricQuestion) : q)));
  };

  const move = (id: string, dir: -1 | 1) => {
    markDirty();
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr.map((q, i) => ({ ...q, order: i }));
    });
  };

  const remove = (id: string) => {
    markDirty();
    setQuestions((prev) => prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const addLikert = () => {
    markDirty();
    const newQ: PsychometricLikertQuestion = {
      id: generateId('lik'),
      type: 'likert',
      text: '',
      trait: 'responsabilidad',
      reverseScored: false,
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
      options: [{ text: '', score: 0 }, { text: '', score: 1 }, { text: '', score: 2 }],
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePsychometricQuestions(questions);
      if (config) await savePsychometricConfig(config);
      setSaved(true);
    } finally {
      setSaving(false);
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
  const sjtQuestions = questions.filter((q): q is PsychometricSjtQuestion => q.type === 'sjt');

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Personality items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Preguntas de personalidad (Likert)</h3>
            <p className="text-xs text-gray-500 mt-0.5">Escala 1 (Totalmente en desacuerdo) a 5 (Totalmente de acuerdo).</p>
          </div>
          <button onClick={addLikert} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2">
            <Plus size={14} /> Agregar
          </button>
        </div>

        {likertQuestions.map((q, idx) => (
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
                    value={q.trait}
                    onChange={(e) => update(q.id, { trait: e.target.value as PsychometricTrait })}
                    className="input-field text-xs py-1.5 w-auto"
                  >
                    {PSYCHOMETRIC_TRAITS.map((t) => (
                      <option key={t} value={t}>{PSYCHOMETRIC_TRAIT_LABELS[t]}</option>
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
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => move(q.id, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => move(q.id, 1)} disabled={idx === likertQuestions.length - 1} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                  <ChevronDown size={14} />
                </button>
                <button onClick={() => remove(q.id)} className="p-1 text-gray-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* SJT scenarios */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Escenarios de juicio situacional (SJT)</h3>
            <p className="text-xs text-gray-500 mt-0.5">Cada opción tiene un puntaje de 0 (menos deseable) a 2 (más deseable).</p>
          </div>
          <button onClick={addSjt} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2">
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
                      <option value={0}>0 pts</option>
                      <option value={1}>1 pt</option>
                      <option value={2}>2 pts</option>
                    </select>
                  </div>
                ))}
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
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => move(q.id, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => move(q.id, 1)} disabled={idx === sjtQuestions.length - 1} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                  <ChevronDown size={14} />
                </button>
                <button onClick={() => remove(q.id)} className="p-1 text-gray-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Weights & bands */}
      {config && (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Ponderación del score compuesto</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PSYCHOMETRIC_TRAITS.map((trait) => (
              <label key={trait} className="text-xs text-gray-600 space-y-1">
                {PSYCHOMETRIC_TRAIT_LABELS[trait]}
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={config.weights[trait]}
                  onChange={(e) => {
                    markDirty();
                    setConfig({ ...config, weights: { ...config.weights, [trait]: Number(e.target.value) } });
                  }}
                  className="input-field text-xs py-1.5 w-full"
                />
              </label>
            ))}
            <label className="text-xs text-gray-600 space-y-1">
              Juicio situacional
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={config.weights.sjt}
                onChange={(e) => {
                  markDirty();
                  setConfig({ ...config, weights: { ...config.weights, sjt: Number(e.target.value) } });
                }}
                className="input-field text-xs py-1.5 w-full"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 pt-2 border-t border-gray-100">
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
          </div>
          <p className="text-xs text-gray-400 pt-1">
            Con estos cortes: <span className="text-red-600 font-medium">Bajo 0–{config.bandCutoffs.lowMax - 1}</span>,{' '}
            <span className="text-amber-600 font-medium">Medio {config.bandCutoffs.lowMax}–{config.bandCutoffs.highMin - 1}</span>,{' '}
            <span className="text-green-600 font-medium">Alto {config.bandCutoffs.highMin}–100</span>.
          </p>
        </div>
      )}

      {/* Question sampling per session */}
      {config && (
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Preguntas aplicadas por sesión</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              En 0 (todas) se aplican todas las preguntas habilitadas. Si defines un número, cada sesión toma
              esa cantidad al azar del banco — útil para acortar la prueba o variarla entre candidatos.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="text-xs text-gray-600 space-y-1">
              Ítems Likert por rasgo (0 = todos)
              <input
                type="number"
                min={0}
                value={config.questionCounts.likertPerTrait}
                onChange={(e) => {
                  markDirty();
                  setConfig({
                    ...config,
                    questionCounts: { ...config.questionCounts, likertPerTrait: Number(e.target.value) },
                  });
                }}
                className="input-field text-xs py-1.5 w-24"
              />
              <span className="block text-gray-400">
                Disponibles: {PSYCHOMETRIC_TRAITS.map((t) => likertQuestions.filter((q) => q.trait === t && q.enabled).length).join('/')} por rasgo
              </span>
            </label>
            <label className="text-xs text-gray-600 space-y-1">
              Escenarios SJT (0 = todos)
              <input
                type="number"
                min={0}
                value={config.questionCounts.sjt}
                onChange={(e) => {
                  markDirty();
                  setConfig({ ...config, questionCounts: { ...config.questionCounts, sjt: Number(e.target.value) } });
                }}
                className="input-field text-xs py-1.5 w-24"
              />
              <span className="block text-gray-400">
                Disponibles: {sjtQuestions.filter((q) => q.enabled).length}
              </span>
            </label>
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary text-sm flex items-center gap-2 px-4 py-2"
      >
        {saved ? <Check size={15} /> : <Save size={15} />}
        {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar cambios'}
      </button>
    </div>
  );
}
