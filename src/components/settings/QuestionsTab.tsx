import { useEffect, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Save, Check, GripVertical } from 'lucide-react';
import type { FormQuestion, QuestionType } from '../../types';
import { getFormQuestions, saveFormQuestions } from '../../services/formQuestions';

const TYPE_LABELS: Record<QuestionType, string> = {
  text: 'Texto corto',
  textarea: 'Texto largo',
  yes_no: 'Sí / No',
  radio: 'Opción múltiple (radio)',
  select: 'Desplegable',
};

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function QuestionsTab() {
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getFormQuestions()
      .then((qs) => setQuestions(qs.sort((a, b) => a.order - b.order)))
      .finally(() => setLoading(false));
  }, []);

  const update = (id: string, patch: Partial<FormQuestion>) => {
    setSaved(false);
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const addQuestion = () => {
    setSaved(false);
    const newQ: FormQuestion = {
      id: generateId(),
      label: '',
      type: 'text',
      required: false,
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  const remove = (id: string) => {
    setSaved(false);
    setQuestions((prev) => prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const move = (id: string, dir: -1 | 1) => {
    setSaved(false);
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr.map((q, i) => ({ ...q, order: i }));
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveFormQuestions(questions);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const updateOption = (qId: string, optIdx: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId) return q;
        const opts = [...(q.options ?? [])];
        opts[optIdx] = value;
        return { ...q, options: opts };
      })
    );
    setSaved(false);
  };

  const addOption = (qId: string) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === qId ? { ...q, options: [...(q.options ?? []), ''] } : q))
    );
    setSaved(false);
  };

  const removeOption = (qId: string, optIdx: number) => {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId) return q;
        const opts = (q.options ?? []).filter((_, i) => i !== optIdx);
        return { ...q, options: opts };
      })
    );
    setSaved(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Preguntas del formulario</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Estas preguntas se muestran al candidato al completar su formulario.
          </p>
        </div>
        <button onClick={addQuestion} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2">
          <Plus size={14} />
          Agregar pregunta
        </button>
      </div>

      {questions.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-400">
          No hay preguntas. Haz clic en "Agregar pregunta" para crear una.
        </div>
      )}

      {questions.map((q, idx) => (
        <div key={q.id} className="card p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-start gap-2">
            <GripVertical size={16} className="text-gray-300 mt-1 shrink-0" />

            <div className="flex-1 space-y-2">
              {/* Label */}
              <input
                type="text"
                value={q.label}
                onChange={(e) => update(q.id, { label: e.target.value })}
                placeholder="Texto de la pregunta"
                className="input-field text-sm"
              />

              {/* Type + required + enabled */}
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={q.type}
                  onChange={(e) => update(q.id, { type: e.target.value as QuestionType, options: undefined })}
                  className="input-field text-xs py-1.5 w-auto"
                >
                  {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>

                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => update(q.id, { required: e.target.checked })}
                    className="rounded"
                  />
                  Obligatorio
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

              {/* Options for radio/select */}
              {(q.type === 'radio' || q.type === 'select') && (
                <div className="space-y-1.5 pl-1">
                  <p className="text-xs text-gray-400 font-medium">Opciones:</p>
                  {(q.options ?? []).map((opt, oi) => (
                    <div key={oi} className="flex gap-1.5 items-center">
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => updateOption(q.id, oi, e.target.value)}
                        placeholder={`Opción ${oi + 1}`}
                        className="input-field text-xs py-1.5 flex-1"
                      />
                      <button
                        onClick={() => removeOption(q.id, oi)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addOption(q.id)}
                    className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                  >
                    <Plus size={12} /> Agregar opción
                  </button>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-1 shrink-0">
              <button
                onClick={() => move(q.id, -1)}
                disabled={idx === 0}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={() => move(q.id, 1)}
                disabled={idx === questions.length - 1}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronDown size={14} />
              </button>
              <button
                onClick={() => remove(q.id)}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary text-sm flex items-center gap-2 px-4 py-2"
      >
        {saved ? <Check size={15} /> : <Save size={15} />}
        {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar preguntas'}
      </button>
    </div>
  );
}
