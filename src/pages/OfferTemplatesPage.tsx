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
  benefits: string;
};

const DEFAULT_BODY = `<p>Bienvenido/a <strong>{{firstName}} {{lastName}}</strong>,</p>

<p>Después de escuchar tu historia, tu trayectoria y lo que te mueve, estamos convencidos de que tu talento puede ayudarnos a hacer realidad nuestra misión. Hoy queremos darte un paso más y compartirte nuestra carta oferta.</p>

<h2>I. Posición y organización</h2>
<p><strong>Puesto:</strong> {{departmentProfile}}<br>
<strong>Empresa:</strong> Aviva Financial S.A. de C.V. SOFOM ENR<br>
<strong>Líder:</strong> {{hiringManager}}<br>
<strong>Fecha de inicio:</strong> {{startDate}}</p>

<h2>II. Compensación y beneficios</h2>
<p><strong>Sueldo Bruto:</strong> {{salary}}</p>
<p>{{benefits}}</p>

<p>Esta oferta está sujeta a la satisfactoria entrega y validación de tu documentación de ingreso.</p>

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
    reset({ name: '', positionKeywordsRaw: '', benefits: '' });
    setShowForm(true);
  };

  const openEdit = (t: OfferTemplate) => {
    setEditingId(t.id);
    setBodyHtml(t.bodyHtml);
    reset({
      name: t.name,
      positionKeywordsRaw: (t.positionKeywords ?? []).join(', '),
      benefits: t.benefits ?? '',
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
      benefits: values.benefits.trim(),
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

        {/* Full-screen centered modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl flex flex-col" style={{ height: '92vh' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <input
                  {...register('name', { required: true })}
                  placeholder="Nombre del template, ej: Promotor de Crédito"
                  className="text-lg font-semibold text-gray-900 bg-transparent border-0 outline-none placeholder-gray-300 flex-1 mr-4"
                  autoFocus
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit(onSubmit)}
                    disabled={saving}
                    className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear template'}
                  </button>
                  <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 rounded-lg ml-1">
                    <X size={16} className="text-gray-400" />
                  </button>
                </div>
              </div>

              {/* How it works — compact banner */}
              <div className="bg-primary-50 border-b border-primary-100 px-6 py-3 shrink-0 flex items-start gap-3">
                <span className="text-primary-500 mt-0.5 shrink-0 text-base">💡</span>
                <p className="text-xs text-primary-800 leading-relaxed">
                  <strong>¿Cómo funciona?</strong> Cuando un candidato llega a "Aprobado" en Viterbit, el sistema busca el template
                  correcto por las <strong>keywords</strong> del puesto y envía la carta automáticamente.
                  Los datos del candidato y del puesto se insertan solos — tú solo defines la estructura de la carta.
                </p>
              </div>

              {/* Two-column body */}
              <div className="flex flex-1 overflow-hidden">

                {/* Left sidebar — steps */}
                <div className="w-80 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50/40">

                  {/* Step 1 */}
                  <div className="p-5 border-b border-gray-100">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
                      <span className="text-sm font-semibold text-gray-800">¿Para qué tipo de puesto?</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3 leading-relaxed ml-8">
                      Escribe palabras que aparezcan en el título del puesto en Viterbit. El sistema las usa para elegir este template automáticamente.
                    </p>
                    <div className="ml-8">
                      <input
                        {...register('positionKeywordsRaw')}
                        placeholder="promotor, crédito, asesor"
                        className="input-field"
                      />
                      <p className="text-xs text-gray-400 mt-1.5">
                        Ej: si el puesto es <em>"Promotor Digital de Crédito"</em> → escribe <code className="bg-gray-100 px-1 rounded">promotor, crédito</code>
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-5 border-b border-gray-100">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                      <span className="text-sm font-semibold text-gray-800">Beneficios del puesto</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3 leading-relaxed ml-8">
                      El paquete de beneficios que aplica para este tipo de puesto. Este texto irá donde pongas la variable <span className="variable-chip var-amber inline text-xs">Beneficios</span> en la carta.
                    </p>
                    <div className="ml-8">
                      <textarea
                        {...register('benefits')}
                        rows={7}
                        placeholder={'Seguridad social: IMSS\nPrima vacacional: 25%\nPrima dominical: 25%\nAguinaldo: 15 días\nDías Aviva: 7 días personales al año'}
                        className="input-field resize-none text-xs leading-relaxed"
                      />
                    </div>
                  </div>

                  {/* Step 3 callout */}
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
                      <span className="text-sm font-semibold text-gray-800">Escribe la carta →</span>
                    </div>
                    <div className="ml-8 space-y-2">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Usa los botones de colores del editor para insertar datos que se llenarán solos:
                      </p>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-blue">Nombre</span>
                          <span className="text-gray-500">del candidato</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-purple">Puesto</span>
                          <span className="text-gray-500">del job en Viterbit</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-green">Salario</span>
                          <span className="text-gray-500">del job en Viterbit</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-amber">Beneficios</span>
                          <span className="text-gray-500">que escribiste arriba</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-rose">Fechas</span>
                          <span className="text-gray-500">del job en Viterbit</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right — editor */}
                <div className="flex-1 flex flex-col overflow-hidden p-5">
                  <div className="flex-1 overflow-hidden">
                    <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
                  </div>
                </div>
              </div>
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
