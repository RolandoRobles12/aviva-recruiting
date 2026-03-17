import { useState, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { LinkDurationSettings } from '../../types';

interface Props {
  settings: LinkDurationSettings;
  saving: boolean;
  saved: boolean;
  onSave: (settings: LinkDurationSettings) => void;
}

export function LinkDurationTab({ settings, saving, saved, onSave }: Props) {
  const [form, setForm] = useState(settings);

  useEffect(() => setForm(settings), [settings]);

  const handleSave = () => onSave(form);

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Duración de enlaces</h3>
        <p className="text-sm text-gray-500">
          Configura cuántos días son válidos los enlaces que se envían a los candidatos.
        </p>
      </div>

      <div className="space-y-4">
        <DurationField
          label="Formulario de documentos"
          description="Tiempo que el candidato tiene para subir sus documentos"
          value={form.formDays}
          onChange={(v) => setForm({ ...form, formDays: v })}
        />
        <DurationField
          label="Carta oferta"
          description="Tiempo que el candidato tiene para firmar la carta oferta"
          value={form.offerDays}
          onChange={(v) => setForm({ ...form, offerDays: v })}
        />
        <DurationField
          label="Contrato"
          description="Tiempo que el candidato tiene para firmar el contrato"
          value={form.contractDays}
          onChange={(v) => setForm({ ...form, contractDays: v })}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary flex items-center justify-center gap-2 text-sm py-2 px-6"
      >
        {saving ? (
          <Loader2 size={14} className="animate-spin" />
        ) : saved ? (
          <Check size={14} />
        ) : null}
        {saved ? 'Guardado' : saving ? 'Guardando...' : 'Guardar'}
      </button>
    </div>
  );
}

function DurationField({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <p className="text-xs text-gray-400 mt-0.5 mb-3">{description}</p>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={1}
          max={90}
          value={value}
          onChange={(e) => onChange(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))}
          className="input-field w-20 text-center text-sm"
        />
        <span className="text-sm text-gray-500">días</span>
      </div>
    </div>
  );
}
