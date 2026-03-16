import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { FileText, Plus, Edit2, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import {
  getContractTemplates,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
} from '../services/contractTemplates';
import { RichTextEditor } from '../components/offer/RichTextEditor';
import type { ContractTemplate } from '../types';

type FormValues = {
  name: string;
  positionKeywordsRaw: string;
};

const DEFAULT_BODY = `<p>Contrato individual de trabajo que celebran por una parte <strong>Aviva Financial S.A. de C.V. SOFOM ENR</strong>, en lo sucesivo "La Empresa", y por otra parte <strong>{{firstName}} {{lastName}}</strong>, en lo sucesivo "El Trabajador".</p>

<h2>I. Declaraciones</h2>
<p>La Empresa declara ser una persona moral constituida conforme a las leyes mexicanas.</p>
<p>El Trabajador declara llamarse <strong>{{firstName}} {{lastName}}</strong>, ser de nacionalidad mexicana y tener capacidad legal para celebrar el presente contrato.</p>

<h2>II. Cláusulas</h2>
<p><strong>PRIMERA.</strong> El Trabajador se obliga a prestar sus servicios personales subordinados a La Empresa en el puesto de <strong>{{position}}</strong>.</p>
<p><strong>SEGUNDA.</strong> La duración del presente contrato será por tiempo indeterminado, iniciando el <strong>{{startDate}}</strong>.</p>
<p><strong>TERCERA.</strong> El Trabajador percibirá un salario bruto mensual de <strong>{{salary}}</strong>, pagadero de forma quincenal.</p>
<p><strong>CUARTA.</strong> El horario de trabajo será el que La Empresa determine conforme a las necesidades del servicio.</p>
<p><strong>QUINTA.</strong> El Trabajador gozará de las prestaciones de ley y las adicionales que La Empresa otorgue.</p>

<p>Leído que fue el presente contrato, lo firman las partes en señal de conformidad.</p>

<p><strong>Fecha:</strong> {{date}}</p>`;

export function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);

  const { register, handleSubmit, reset } = useForm<FormValues>();

  const load = async () => {
    setLoading(true);
    const data = await getContractTemplates();
    setTemplates(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setBodyHtml(DEFAULT_BODY);
    reset({ name: '', positionKeywordsRaw: '' });
    setShowForm(true);
  };

  const openEdit = (t: ContractTemplate) => {
    setEditingId(t.id);
    setBodyHtml(t.bodyHtml);
    reset({
      name: t.name,
      positionKeywordsRaw: (t.positionKeywords ?? []).join(', '),
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
      bodyHtml,
    };
    if (editingId) {
      await updateContractTemplate(editingId, payload);
    } else {
      await createContractTemplate(payload);
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este template de contrato?')) return;
    setDeletingId(id);
    await deleteContractTemplate(id);
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
            <h2 className="text-base font-semibold text-gray-900">Templates de Contrato</h2>
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
              <p className="text-gray-500 text-sm">No hay templates de contrato todavía.</p>
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

                  {expandedId === t.id && (
                    <div className="border-t border-gray-50 px-5 py-4 bg-gray-50">
                      <p className="text-xs text-gray-400 font-medium mb-1">Contenido (HTML)</p>
                      <div
                        className="prose prose-sm max-w-none text-gray-600 bg-white rounded-lg p-4 border border-gray-100 text-xs"
                        dangerouslySetInnerHTML={{ __html: t.bodyHtml }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Full-screen modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl flex flex-col" style={{ height: '92vh' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <input
                  {...register('name', { required: true })}
                  placeholder="Nombre del template, ej: Contrato Promotor de Crédito"
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

              {/* Info banner */}
              <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 shrink-0 flex items-start gap-3">
                <span className="text-blue-500 mt-0.5 shrink-0 text-sm">i</span>
                <p className="text-xs text-blue-800 leading-relaxed">
                  <strong>Contratos digitales con FES.</strong> Cuando un candidato llega al stage "Contrato" en Viterbit,
                  el sistema busca el template correcto por las <strong>keywords</strong> del puesto. El candidato recibe
                  un enlace para revisar y firmar digitalmente con evidencia criptográfica SHA-256.
                </p>
              </div>

              {/* Two-column body */}
              <div className="flex flex-1 overflow-hidden">

                {/* Left sidebar */}
                <div className="w-72 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50/40">
                  <div className="p-5 border-b border-gray-100">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
                      <span className="text-sm font-semibold text-gray-800">Keywords del puesto</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3 leading-relaxed ml-8">
                      Palabras que aparezcan en el título del puesto en Viterbit para auto-seleccionar este template.
                    </p>
                    <div className="ml-8">
                      <input
                        {...register('positionKeywordsRaw')}
                        placeholder="promotor, crédito, asesor"
                        className="input-field"
                      />
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                      <span className="text-sm font-semibold text-gray-800">Escribe el contrato</span>
                    </div>
                    <div className="ml-8 space-y-2">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Usa los botones de colores para insertar datos automáticos:
                      </p>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-blue">Nombre</span>
                          <span className="text-gray-500">del candidato</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-purple">Puesto</span>
                          <span className="text-gray-500">del job</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-green">Salario</span>
                          <span className="text-gray-500">del job</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="variable-chip var-rose">Fecha</span>
                          <span className="text-gray-500">de inicio / hoy</span>
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
