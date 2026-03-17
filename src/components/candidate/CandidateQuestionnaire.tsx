import { useState } from 'react';
import { CheckCircle, Save, ChevronRight } from 'lucide-react';
import type { Candidate, FormAnswers, Parentesco } from '../../types';
import { PARENTESCO_LABELS } from '../../types';
import { updateCandidateFormAnswers } from '../../services/candidates';

interface Props {
  candidate: Candidate;
  onComplete: () => void;
}

const PARENTESCO_OPTIONS: Parentesco[] = ['padre_madre', 'hermano', 'esposo', 'hijo'];

export function CandidateQuestionnaire({ candidate, onComplete }: Props) {
  const existing = candidate.formAnswers;
  const [answers, setAnswers] = useState<FormAnswers>(existing ?? {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof FormAnswers>(key: K, value: FormAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCandidateFormAnswers(candidate.id, answers);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndContinue = async () => {
    await handleSave();
    onComplete();
  };

  const alreadySaved = existing != null;

  return (
    <div className="space-y-4">
      {alreadySaved && (
        <div className="card p-3 bg-green-50 border-green-200 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600 shrink-0" />
          <p className="text-sm text-green-800">Tus respuestas ya fueron guardadas. Puedes editarlas si necesitas.</p>
        </div>
      )}

      {/* ── Estado Civil ──────────────────────────────────────────────── */}
      <FieldCard title="Proporciona tu estado civil">
        <RadioGroup
          options={[
            { value: 'soltero', label: 'Soltero/a' },
            { value: 'casado', label: 'Casado/a' },
            { value: 'union_libre', label: 'Unión Libre' },
          ]}
          value={answers.estadoCivil}
          onChange={(v) => update('estadoCivil', v as FormAnswers['estadoCivil'])}
        />
      </FieldCard>

      {/* ── Hijos ─────────────────────────────────────────────────────── */}
      <FieldCard title="¿Tienes hijos?">
        <YesNoButtons value={answers.tieneHijos} onChange={(v) => update('tieneHijos', v)} />
      </FieldCard>

      {/* ── INFONAVIT ────────────────────────────────────────────────── */}
      <FieldCard title="¿Cuentas con crédito INFONAVIT?">
        <YesNoButtons value={answers.tieneInfonavit} onChange={(v) => update('tieneInfonavit', v)} />
        {answers.tieneInfonavit && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            En la sección de documentos se te pedirá subir tu Aviso de Retención.
          </p>
        )}
      </FieldCard>

      {/* ── FONACOT ──────────────────────────────────────────────────── */}
      <FieldCard title="¿Cuentas con un crédito FONACOT?">
        <YesNoButtons value={answers.tieneFonacot} onChange={(v) => update('tieneFonacot', v)} />
        {answers.tieneFonacot && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            En la sección de documentos se te pedirá subir tu estado de cuenta FONACOT.
          </p>
        )}
      </FieldCard>

      {/* ── Talla Playera ────────────────────────────────────────────── */}
      <FieldCard title="Selecciona tu talla de playera">
        <RadioGroup
          options={['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((t) => ({ value: t, label: t }))}
          value={answers.tallaPlayera}
          onChange={(v) => update('tallaPlayera', v as FormAnswers['tallaPlayera'])}
          inline
        />
      </FieldCard>

      {/* ── Sobre ti ─────────────────────────────────────────────────── */}
      <FieldCard title="Cuéntanos un poco sobre ti">
        <textarea
          value={answers.sobreTi ?? ''}
          onChange={(e) => update('sobreTi', e.target.value)}
          rows={3}
          placeholder="Escribe algo sobre ti..."
          className="input-field text-sm resize-none"
        />
      </FieldCard>

      {/* ── Entidad financiera ───────────────────────────────────────── */}
      <FieldCard title="¿Anteriormente has laborado en otra entidad financiera?">
        <YesNoButtons value={answers.trabajoEntidadFinanciera} onChange={(v) => update('trabajoEntidadFinanciera', v)} />
        {answers.trabajoEntidadFinanciera && (
          <input
            type="text"
            value={answers.nombreEntidadFinanciera ?? ''}
            onChange={(e) => update('nombreEntidadFinanciera', e.target.value)}
            placeholder="Nombre de la entidad financiera"
            className="input-field text-sm mt-3"
          />
        )}
      </FieldCard>

      {/* ── Beneficiario ─────────────────────────────────────────────── */}
      <FieldCard title="Beneficiario (mayor de edad y familiar directo)">
        <div className="space-y-3">
          <input
            type="text"
            value={answers.beneficiarioNombre ?? ''}
            onChange={(e) => update('beneficiarioNombre', e.target.value)}
            placeholder="Nombre completo del beneficiario"
            className="input-field text-sm"
          />
          <input
            type="tel"
            value={answers.beneficiarioTelefono ?? ''}
            onChange={(e) => update('beneficiarioTelefono', e.target.value)}
            placeholder="Teléfono del beneficiario"
            className="input-field text-sm"
          />
          <input
            type="email"
            value={answers.beneficiarioCorreo ?? ''}
            onChange={(e) => update('beneficiarioCorreo', e.target.value)}
            placeholder="Correo electrónico del beneficiario"
            className="input-field text-sm"
          />
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Parentesco</label>
            <RadioGroup
              options={PARENTESCO_OPTIONS.map((p) => ({ value: p, label: PARENTESCO_LABELS[p] }))}
              value={answers.beneficiarioParentesco}
              onChange={(v) => update('beneficiarioParentesco', v as Parentesco)}
              inline
            />
          </div>
        </div>
      </FieldCard>

      {/* ── Contacto emergencia 1 ────────────────────────────────────── */}
      <FieldCard title="Primer contacto de emergencia (mayor de edad y familiar directo)">
        <div className="space-y-3">
          <input
            type="text"
            value={answers.contacto1Nombre ?? ''}
            onChange={(e) => update('contacto1Nombre', e.target.value)}
            placeholder="Nombre completo"
            className="input-field text-sm"
          />
          <input
            type="tel"
            value={answers.contacto1Telefono ?? ''}
            onChange={(e) => update('contacto1Telefono', e.target.value)}
            placeholder="Teléfono"
            className="input-field text-sm"
          />
          <input
            type="email"
            value={answers.contacto1Correo ?? ''}
            onChange={(e) => update('contacto1Correo', e.target.value)}
            placeholder="Correo electrónico"
            className="input-field text-sm"
          />
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Parentesco</label>
            <RadioGroup
              options={PARENTESCO_OPTIONS.map((p) => ({ value: p, label: PARENTESCO_LABELS[p] }))}
              value={answers.contacto1Parentesco}
              onChange={(v) => update('contacto1Parentesco', v as Parentesco)}
              inline
            />
          </div>
        </div>
      </FieldCard>

      {/* ── Contacto emergencia 2 ────────────────────────────────────── */}
      <FieldCard title="Segundo contacto de emergencia (mayor de edad y familiar directo)">
        <div className="space-y-3">
          <input
            type="text"
            value={answers.contacto2Nombre ?? ''}
            onChange={(e) => update('contacto2Nombre', e.target.value)}
            placeholder="Nombre completo"
            className="input-field text-sm"
          />
          <input
            type="tel"
            value={answers.contacto2Telefono ?? ''}
            onChange={(e) => update('contacto2Telefono', e.target.value)}
            placeholder="Teléfono"
            className="input-field text-sm"
          />
          <input
            type="email"
            value={answers.contacto2Correo ?? ''}
            onChange={(e) => update('contacto2Correo', e.target.value)}
            placeholder="Correo electrónico"
            className="input-field text-sm"
          />
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Parentesco</label>
            <RadioGroup
              options={PARENTESCO_OPTIONS.map((p) => ({ value: p, label: PARENTESCO_LABELS[p] }))}
              value={answers.contacto2Parentesco}
              onChange={(v) => update('contacto2Parentesco', v as Parentesco)}
              inline
            />
          </div>
        </div>
      </FieldCard>

      {/* ── Action buttons ───────────────────────────────────────────── */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 btn-secondary text-sm flex items-center justify-center gap-2 py-2.5"
        >
          <Save size={15} />
          {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar respuestas'}
        </button>
        <button
          onClick={handleSaveAndContinue}
          disabled={saving}
          className="flex-1 btn-primary text-sm flex items-center justify-center gap-2 py-2.5"
        >
          Guardar y continuar
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Shared form components
   ═══════════════════════════════════════════════════════════════════════════ */

function FieldCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function YesNoButtons({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
          value === true
            ? 'bg-primary-50 border-primary-300 text-primary-700'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        Sí
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
          value === false
            ? 'bg-primary-50 border-primary-300 text-primary-700'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        No
      </button>
    </div>
  );
}

function RadioGroup({ options, value, onChange, inline }: {
  options: { value: string; label: string }[];
  value?: string;
  onChange: (v: string) => void;
  inline?: boolean;
}) {
  return (
    <div className={`${inline ? 'flex flex-wrap gap-2' : 'space-y-2'}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`${inline ? 'px-4' : 'w-full text-left px-4'} py-2 rounded-lg text-sm font-medium border transition-colors ${
            value === opt.value
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
