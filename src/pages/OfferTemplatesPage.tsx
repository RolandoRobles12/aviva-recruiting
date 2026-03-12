import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { FileText, Plus, Edit2, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import {
  getOfferTemplates,
  createOfferTemplate,
  updateOfferTemplate,
  deleteOfferTemplate,
} from '../services/offerTemplates';
import { RichTextEditor } from '../components/offer/RichTextEditor';
import type { OfferTemplate } from '../types';

type FormValues = {
  name: string;
  positionKeywordsRaw: string;
  salary: string;
  benefits: string;
  startDate: string;
};

const DEFAULT_BODY = `<p>Estimado/a <strong>{{firstName}} {{lastName}}</strong>,</p>

<p>Nos complace hacerte una oferta formal de empleo para el puesto de <strong>{{position}}</strong> en Aviva.</p>

<p><strong>Condiciones de la oferta:</strong></p>
<ul>
  <li>Puesto: {{position}}</li>
  <li>Salario mensual bruto: {{salary}}</li>
  <li>Beneficios: {{benefits}}</li>
  <li>Fecha estimada de inicio: {{startDate}}</li>
</ul>

<p>Esta oferta está sujeta a la satisfactoria entrega y validación de tu documentación de ingreso.</p>

<p>Si tienes alguna pregunta, no dudes en contactar a tu reclutador.</p>

<p>Atentamente,<br><strong>Equipo de Reclutamiento · Aviva</strong></p>`;

export function OfferTemplatesPage() {
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>();

  const load = async () => {
    setLoading(true);
    const data = await getOfferTemplates();
    setTemplates(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setBodyHtml(DEFAULT_BODY);
    reset({
      name: '',
      positionKeywordsRaw: '',
      salary: '',
      benefits: '',
      startDate: 'a convenir',
    });
    setShowForm(true);
  };

  const openEdit = (t: OfferTemplate) => {
    setEditingId(t.id);
    setBodyHtml(t.bodyHtml);
    reset({
      name: t.name,
      positionKeywordsRaw: (t.positionKeywords ?? []).join(', '),
      salary: t.salary,
      benefits: t.benefits,
      startDate: t.startDate,
    });
    setShowForm(true);
  };

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    const keywords = values.positionKeywordsRaw
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const payload = {
      name: values.name.trim(),
      positionKeywords: keywords,
      salary: values.salary.trim(),
      benefits: values.benefits.trim(),
      startDate: values.startDate.trim(),
      bodyHtml,
    };
    if (editingId) {
      await updateOfferTemplate(editingId, payload);
    } else {
      await createOfferTemplate(payload);
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este template de carta oferta?')) return;
    setDeletingId(id);
    await deleteOfferTemplate(id);
    setDeletingId(null);
    load();
  };

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Templates de Carta Oferta</h2>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            <Plus size={15} />
            Nuevo template
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                <FileText size={22} className="text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm">No hay templates todavía.</p>
              <button onClick={openCreate} className="mt-3 text-primary-600 text-sm font-medium hover:underline">
                Crear el primero
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl">
              {templates.map((t) => (
                <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{t.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t.positionKeywords?.length ? `Keywords: ${t.positionKeywords.join(', ')}` : 'Sin keywords'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                        title="Ver contenido"
                      >
                        {expandedId === t.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                      <button
                        onClick={() => openEdit(t)}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deletingId === t.id}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Eliminar"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedId === t.id && (
                    <div className="border-t border-gray-50 px-5 py-4 bg-gray-50 space-y-3">
                      <Row label="Salario" value={t.salary} />
                      <Row label="Fecha de inicio" value={t.startDate} />
                      <Row label="Beneficios" value={t.benefits} />
                      <div>
                        <p className="text-xs text-gray-400 font-medium mb-1">Contenido (HTML)</p>
                        <div
                          className="prose prose-sm max-w-none text-gray-600 bg-white rounded-lg p-4 border border-gray-100 text-xs"
                          dangerouslySetInnerHTML={{ __html: t.bodyHtml }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Slide-over form */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/30" onClick={() => setShowForm(false)} />
            <div className="w-full max-w-2xl bg-white shadow-xl flex flex-col h-full overflow-hidden">
              {/* Form header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">
                  {editingId ? 'Editar template' : 'Nuevo template'}
                </h3>
                <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X size={16} className="text-gray-500" />
                </button>
              </div>

              {/* Form body */}
              <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-5">
                <Field label="Nombre del template" error={errors.name?.message}>
                  <input
                    {...register('name', { required: 'Requerido' })}
                    placeholder="Ej: Promotor de Crédito"
                    className="input-field"
                  />
                </Field>

                <Field label="Keywords de posición (separados por coma)" hint="Se usarán para encontrar automáticamente el template correcto según el título del puesto en Viterbit.">
                  <input
                    {...register('positionKeywordsRaw')}
                    placeholder="promotor, crédito, asesor"
                    className="input-field"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Salario" error={errors.salary?.message}>
                    <input
                      {...register('salary', { required: 'Requerido' })}
                      placeholder="$12,000 MXN mensuales brutos"
                      className="input-field"
                    />
                  </Field>
                  <Field label="Fecha de inicio">
                    <input
                      {...register('startDate')}
                      placeholder="a convenir"
                      className="input-field"
                    />
                  </Field>
                </div>

                <Field label="Beneficios" error={errors.benefits?.message}>
                  <textarea
                    {...register('benefits', { required: 'Requerido' })}
                    rows={3}
                    placeholder="Seguro de gastos médicos, vales de despensa, fondo de ahorro..."
                    className="input-field resize-none"
                  />
                </Field>

                <Field label="Contenido de la carta">
                  <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
                </Field>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving} className="flex-1 bg-primary-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50">
                    {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear template'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1.5 leading-relaxed">{hint}</p>}
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <p className="text-sm text-gray-700">{value || '—'}</p>
    </div>
  );
}
