import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { FileText, Plus, Edit2, Trash2, X, ChevronDown, ChevronUp, Upload, FileCode, Eye, AlertCircle, Check, Brain } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import {
  getContractTemplates,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
  uploadContractPdf,
  analyzePdfTemplate,
  analyzeContractVariables,
} from '../services/contractTemplates';
import type { DetectedPlaceholder } from '../services/contractTemplates';
import { RichTextEditor, VARIABLES } from '../components/offer/RichTextEditor';
import type { ContractTemplate, ContractTemplateType, PdfFieldPosition, PdfVariableMapping } from '../types';

type FormValues = {
  name: string;
  positionKeywordsRaw: string;
};

const DEFAULT_BODY = `<p>Contrato individual de trabajo que celebran por una parte <strong>Aviva Financial S.A. de C.V. SOFOM ENR</strong>, representada por Salvador Hernández Díaz de León, en lo sucesivo "La Empresa", y por otra parte <strong>{{firstName}} {{lastName}}</strong>, en lo sucesivo "El Trabajador".</p>

<h2>Declaraciones</h2>
<p>La Empresa declara ser una persona moral constituida conforme a las leyes mexicanas, con domicilio en Calle Varsovia 36, Colonia Juárez, Delegación Cuauhtémoc, CP 06600, CDMX.</p>
<p>El Trabajador declara llamarse <strong>{{firstName}} {{lastName}}</strong> y tener capacidad legal para celebrar el presente contrato.</p>

<h2>Cláusulas</h2>
<p><strong>PRIMERA.</strong> El Trabajador se obliga a prestar sus servicios personales subordinados a La Empresa en el puesto de <strong>{{position}}</strong>, iniciando el <strong>{{startDate}}</strong>.</p>
<p><strong>SEGUNDA.</strong> El Trabajador percibirá un salario bruto mensual de <strong>{{salary}}</strong>, pagadero de forma quincenal.</p>
<p><strong>TERCERA.</strong> El Trabajador se obliga a mantener absoluta confidencialidad sobre la información de La Empresa a la que tenga acceso con motivo de su cargo.</p>

<h2>Firmas</h2>
<p>Leído que fue el presente contrato, ambas partes lo firman en señal de conformidad en la Ciudad de México, el <strong>{{date}}</strong>.</p>

<table style="width:100%; border-collapse:collapse; margin-top:16px;">
<tr>
<td style="width:50%; text-align:center; padding:8px; border:1px solid #ccc; vertical-align:top;">
<p><strong>La Empresa</strong></p>
<p style="margin-top:40px; border-top:1px solid #000; padding-top:6px;"><strong>SALVADOR HERNÁNDEZ DÍAZ DE LEÓN</strong><br>Representante Legal</p>
</td>
<td style="width:50%; text-align:center; padding:8px; border:1px solid #ccc; vertical-align:top;">
<p><strong>El Trabajador</strong></p>
<p style="margin-top:40px; border-top:1px solid #000; padding-top:6px;"><strong>{{firstName}} {{lastName}}</strong><br>Por su propio derecho</p>
</td>
</tr>
</table>`;

export function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);

  // PDF template state
  const [templateType, setTemplateType] = useState<ContractTemplateType>('html');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfStoragePath, setPdfStoragePath] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfAnalysis, setPdfAnalysis] = useState<{
    pageCount: number;
    pageDimensions: Array<{ width: number; height: number }>;
    detectedFields: PdfFieldPosition[];
    hasAcroForm: boolean;
    fileSize: number;
  } | null>(null);
  const [pdfAnalyzing, setPdfAnalyzing] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [signatureFields, setSignatureFields] = useState<PdfFieldPosition[]>([]);
  const [initialsOnEveryPage, setInitialsOnEveryPage] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // AI variable analysis
  const [variableMappings, setVariableMappings] = useState<PdfVariableMapping[]>([]);
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<DetectedPlaceholder[]>([]);
  const [analyzingVars, setAnalyzingVars] = useState(false);
  const [varAnalysisError, setVarAnalysisError] = useState<string | null>(null);

  const { register, handleSubmit, reset } = useForm<FormValues>();

  const load = async () => {
    setLoading(true);
    const data = await getContractTemplates();
    setTemplates(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetFormState = () => {
    setTemplateType('html');
    setPdfFile(null);
    setPdfStoragePath(null);
    setPdfUrl(null);
    setPdfAnalysis(null);
    setPdfPageCount(0);
    setSignatureFields([]);
    setInitialsOnEveryPage(true);
    setPdfError(null);
    setVariableMappings([]);
    setDetectedPlaceholders([]);
    setVarAnalysisError(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setBodyHtml(DEFAULT_BODY);
    resetFormState();
    reset({ name: '', positionKeywordsRaw: '' });
    setShowForm(true);
  };

  const openEdit = (t: ContractTemplate) => {
    setEditingId(t.id);
    setBodyHtml(t.bodyHtml);
    setTemplateType(t.templateType || 'html');
    setPdfStoragePath(t.pdfStoragePath || null);
    setPdfUrl(t.pdfUrl || null);
    setPdfPageCount(t.pdfPageCount || 0);
    setSignatureFields(t.signatureFields || []);
    setInitialsOnEveryPage(t.initialsOnEveryPage ?? true);
    setPdfAnalysis(null);
    setPdfError(null);
    setPdfFile(null);
    setVariableMappings(t.variableMappings || []);
    setDetectedPlaceholders([]);
    setVarAnalysisError(null);
    reset({
      name: t.name,
      positionKeywordsRaw: (t.positionKeywords ?? []).join(', '),
    });
    setShowForm(true);
  };

  const handlePdfUpload = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf') {
      setPdfError('Solo se aceptan archivos PDF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setPdfError('El archivo PDF no debe exceder 20 MB.');
      return;
    }

    setPdfError(null);
    setPdfFile(file);
    setPdfUploading(true);

    try {
      const { storagePath, downloadUrl } = await uploadContractPdf(file, file.name);
      setPdfStoragePath(storagePath);
      setPdfUrl(downloadUrl);

      // Analyze the PDF
      setPdfAnalyzing(true);
      const analysis = await analyzePdfTemplate(storagePath);
      setPdfAnalysis(analysis);
      setPdfPageCount(analysis.pageCount);
      setSignatureFields(analysis.detectedFields);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Error al subir el PDF');
    } finally {
      setPdfUploading(false);
      setPdfAnalyzing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handlePdfUpload(file);
  }, [handlePdfUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePdfUpload(file);
  }, [handlePdfUpload]);

  const handleAnalyzeVars = useCallback(async () => {
    if (!pdfStoragePath) return;
    setAnalyzingVars(true);
    setVarAnalysisError(null);
    try {
      const result = await analyzeContractVariables(pdfStoragePath);
      setDetectedPlaceholders(result.placeholders);
      setVariableMappings(result.variableMappings);
    } catch (err) {
      setVarAnalysisError(err instanceof Error ? err.message : 'Error al analizar variables');
    } finally {
      setAnalyzingVars(false);
    }
  }, [pdfStoragePath]);

  const updateVarMapping = (index: number, variable: string) => {
    setVariableMappings((prev) => prev.map((m, i) => (i === index ? { ...m, variable } : m)));
  };

  const removeField = (fieldId: string) => {
    setSignatureFields((prev) => prev.filter((f) => f.id !== fieldId));
  };

  const updateField = (fieldId: string, updates: Partial<PdfFieldPosition>) => {
    setSignatureFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, ...updates } : f))
    );
  };

  const addField = (type: PdfFieldPosition['type']) => {
    const newField: PdfFieldPosition = {
      id: `manual_${Date.now()}`,
      type,
      pageIndex: 0,
      x: 56,
      y: type === 'signature' ? 120 : 40,
      width: type === 'signature' ? 200 : type === 'initials' ? 50 : 150,
      height: type === 'signature' ? 60 : 25,
      label: type === 'signature' ? 'Firma' : type === 'initials' ? 'Iniciales' : type === 'date' ? 'Fecha' : 'Texto',
      required: true,
    };
    setSignatureFields((prev) => [...prev, newField]);
  };

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    const keywords = values.positionKeywordsRaw
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    const payload: Omit<ContractTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
      name: values.name.trim(),
      positionKeywords: keywords,
      templateType,
      bodyHtml: templateType === 'html' ? bodyHtml : '',
      pdfUrl: templateType === 'pdf' ? pdfUrl || undefined : undefined,
      pdfStoragePath: templateType === 'pdf' ? pdfStoragePath || undefined : undefined,
      pdfPageCount: templateType === 'pdf' ? pdfPageCount : undefined,
      pdfFileSize: templateType === 'pdf' && pdfAnalysis ? pdfAnalysis.fileSize : undefined,
      signatureFields: templateType === 'pdf' ? signatureFields : undefined,
      variableMappings: templateType === 'pdf' && variableMappings.length > 0 ? variableMappings : undefined,
      initialsOnEveryPage,
      initialsPosition: undefined,
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

  const fieldTypeLabel = (type: PdfFieldPosition['type']) => {
    switch (type) {
      case 'signature': return 'Firma';
      case 'initials': return 'Iniciales';
      case 'date': return 'Fecha';
      case 'text': return 'Texto';
    }
  };

  const fieldTypeColor = (type: PdfFieldPosition['type']) => {
    switch (type) {
      case 'signature': return 'bg-rose-100 text-rose-700';
      case 'initials': return 'bg-blue-100 text-blue-700';
      case 'date': return 'bg-amber-100 text-amber-700';
      case 'text': return 'bg-gray-100 text-gray-700';
    }
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
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        (t.templateType || 'html') === 'pdf' ? 'bg-rose-50' : 'bg-blue-50'
                      }`}>
                        {(t.templateType || 'html') === 'pdf' ? (
                          <Upload size={14} className="text-rose-500" />
                        ) : (
                          <FileCode size={14} className="text-blue-500" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{t.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            (t.templateType || 'html') === 'pdf' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
                          }`}>
                            {(t.templateType || 'html') === 'pdf' ? `PDF · ${t.pdfPageCount || '?'} pág.` : 'HTML'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {t.positionKeywords?.length ? t.positionKeywords.join(', ') : 'Sin keywords'}
                          </span>
                          {t.initialsOnEveryPage && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-600">
                              Iniciales en cada hoja
                            </span>
                          )}
                        </div>
                      </div>
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
                      {(t.templateType || 'html') === 'pdf' ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-400 font-medium">PDF Template</p>
                            {t.pdfUrl && (
                              <a
                                href={t.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary-600 font-medium hover:underline flex items-center gap-1"
                              >
                                <Eye size={12} /> Ver PDF
                              </a>
                            )}
                          </div>
                          {t.signatureFields && t.signatureFields.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-500 font-medium mb-1">Campos detectados:</p>
                              <div className="flex flex-wrap gap-1">
                                {t.signatureFields.map((f) => (
                                  <span key={f.id} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${fieldTypeColor(f.type)}`}>
                                    {fieldTypeLabel(f.type)} · pág. {f.pageIndex + 1}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-gray-400 font-medium mb-1">Contenido (HTML)</p>
                          <div
                            className="prose prose-sm max-w-none text-gray-600 bg-white rounded-lg p-4 border border-gray-100 text-xs"
                            dangerouslySetInnerHTML={{ __html: t.bodyHtml }}
                          />
                        </>
                      )}
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
                    disabled={saving || (templateType === 'pdf' && !pdfStoragePath)}
                    className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear template'}
                  </button>
                  <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 rounded-lg ml-1">
                    <X size={16} className="text-gray-400" />
                  </button>
                </div>
              </div>

              {/* Template type selector */}
              <div className="bg-gray-50 border-b border-gray-100 px-6 py-3 shrink-0 flex items-center gap-3">
                <span className="text-xs text-gray-500 font-medium">Tipo de template:</span>
                <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setTemplateType('html')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      templateType === 'html'
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <FileCode size={13} />
                    Editor HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateType('pdf')}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      templateType === 'pdf'
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Upload size={13} />
                    Importar PDF
                  </button>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={initialsOnEveryPage}
                      onChange={(e) => setInitialsOnEveryPage(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-xs text-gray-600 font-medium">Iniciales en cada hoja</span>
                  </label>
                </div>
              </div>

              {/* Info banner */}
              <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 shrink-0 flex items-start gap-3">
                <span className="text-blue-500 mt-0.5 shrink-0 text-sm">i</span>
                <p className="text-xs text-blue-800 leading-relaxed">
                  {templateType === 'pdf' ? (
                    <>
                      <strong>Importar PDF.</strong> Sube un contrato en PDF y el sistema detectará automáticamente
                      los campos de firma e iniciales. El candidato firmará digitalmente con evidencia criptográfica SHA-256,
                      y sus iniciales aparecerán en cada hoja del contrato.
                    </>
                  ) : (
                    <>
                      <strong>Contratos digitales con FES.</strong> Cuando un candidato llega al stage "Contrato" en Viterbit,
                      el sistema busca el template correcto por las <strong>keywords</strong> del puesto. El candidato recibe
                      un enlace para revisar y firmar digitalmente con evidencia criptográfica SHA-256.
                    </>
                  )}
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

                  {templateType === 'pdf' && (
                    <div className="p-5 border-b border-gray-100">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                        <span className="text-sm font-semibold text-gray-800">Campos detectados</span>
                      </div>
                      <div className="ml-8 space-y-2">
                        {pdfAnalysis && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                              <Check size={12} />
                              {pdfAnalysis.pageCount} página{pdfAnalysis.pageCount > 1 ? 's' : ''} detectada{pdfAnalysis.pageCount > 1 ? 's' : ''}
                            </div>
                            {pdfAnalysis.hasAcroForm && (
                              <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                <Check size={12} />
                                Formulario AcroForm detectado
                              </div>
                            )}
                          </div>
                        )}

                        {signatureFields.length > 0 ? (
                          <div className="space-y-1.5">
                            {signatureFields.map((f) => (
                              <div key={f.id} className="flex items-center justify-between bg-white rounded-lg p-2 border border-gray-100">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${fieldTypeColor(f.type)}`}>
                                    {fieldTypeLabel(f.type)}
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    Pág. {f.pageIndex + 1}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeField(f.id)}
                                  className="p-0.5 text-gray-300 hover:text-red-500 transition-colors"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : !pdfAnalyzing && pdfStoragePath ? (
                          <p className="text-xs text-gray-400">No se detectaron campos. Agrégalos manualmente.</p>
                        ) : null}

                        {pdfStoragePath && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            <button
                              type="button"
                              onClick={() => addField('signature')}
                              className="text-[10px] font-medium px-2 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                            >
                              + Firma
                            </button>
                            <button
                              type="button"
                              onClick={() => addField('initials')}
                              className="text-[10px] font-medium px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                            >
                              + Iniciales
                            </button>
                            <button
                              type="button"
                              onClick={() => addField('date')}
                              className="text-[10px] font-medium px-2 py-1 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                            >
                              + Fecha
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {templateType === 'pdf' ? '3' : '2'}
                      </span>
                      <span className="text-sm font-semibold text-gray-800">
                        {templateType === 'pdf' ? 'Configuración' : 'Escribe el contrato'}
                      </span>
                    </div>
                    <div className="ml-8 space-y-2">
                      {templateType === 'html' ? (
                        <>
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
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500 leading-relaxed">
                            El sistema coloca automáticamente las iniciales del candidato en cada hoja
                            y la firma digital en los campos marcados.
                          </p>
                          <div className="space-y-1.5 text-xs mt-3">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full bg-rose-400 shrink-0" />
                              <span className="text-gray-600"><strong>Firma:</strong> firma digital del candidato</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
                              <span className="text-gray-600"><strong>Iniciales:</strong> siglas en cada hoja</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
                              <span className="text-gray-600"><strong>Fecha:</strong> fecha de firma</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right — editor / PDF upload */}
                <div className="flex-1 flex flex-col overflow-hidden p-5">
                  {templateType === 'html' ? (
                    <div className="flex-1 overflow-hidden">
                      <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto space-y-4">
                      {/* PDF Upload Area */}
                      {!pdfStoragePath ? (
                        <div
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={handleDrop}
                          className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
                            pdfUploading
                              ? 'border-primary-300 bg-primary-50'
                              : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                          }`}
                        >
                          {pdfUploading ? (
                            <div className="flex flex-col items-center gap-3">
                              <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                              <p className="text-sm text-primary-600 font-medium">Subiendo y analizando PDF...</p>
                            </div>
                          ) : (
                            <>
                              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Upload size={28} className="text-gray-400" />
                              </div>
                              <p className="text-gray-700 font-medium mb-1">Arrastra tu contrato PDF aquí</p>
                              <p className="text-gray-400 text-sm mb-4">o haz clic para seleccionar un archivo</p>
                              <label className="inline-flex items-center gap-2 bg-primary-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors cursor-pointer">
                                <Upload size={15} />
                                Seleccionar PDF
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  onChange={handleFileInput}
                                  className="hidden"
                                />
                              </label>
                              <p className="text-xs text-gray-400 mt-3">Máximo 20 MB. Se detectarán campos de firma automáticamente.</p>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* PDF uploaded — show info */}
                          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                <Check size={18} className="text-green-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-green-800">PDF cargado exitosamente</p>
                                <p className="text-xs text-green-600">
                                  {pdfFile?.name || 'Archivo PDF'} · {pdfPageCount} página{pdfPageCount > 1 ? 's' : ''}
                                  {pdfAnalysis ? ` · ${(pdfAnalysis.fileSize / 1024).toFixed(0)} KB` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {pdfUrl && (
                                <a
                                  href={pdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Eye size={13} /> Ver PDF
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setPdfStoragePath(null);
                                  setPdfUrl(null);
                                  setPdfFile(null);
                                  setPdfAnalysis(null);
                                  setSignatureFields([]);
                                  setPdfPageCount(0);
                                }}
                                className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                              >
                                Cambiar PDF
                              </button>
                            </div>
                          </div>

                          {/* Analyzing indicator */}
                          {pdfAnalyzing && (
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                              <p className="text-sm text-blue-700 font-medium">Analizando PDF y detectando campos de firma...</p>
                            </div>
                          )}

                          {/* AI variable analysis */}
                          {!analyzingVars && detectedPlaceholders.length === 0 && variableMappings.length === 0 && (
                            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <Brain size={18} className="text-purple-600 shrink-0" />
                                <div>
                                  <p className="text-sm font-medium text-purple-800">Detectar variables con IA</p>
                                  <p className="text-xs text-purple-600 mt-0.5">Claude identifica cada *** del contrato y lo mapea a la variable correcta</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleAnalyzeVars}
                                className="px-4 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors whitespace-nowrap shrink-0"
                              >
                                Analizar con IA
                              </button>
                            </div>
                          )}

                          {analyzingVars && (
                            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center gap-3">
                              <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin shrink-0" />
                              <div>
                                <p className="text-sm text-purple-700 font-medium">Claude está analizando el contrato...</p>
                                <p className="text-xs text-purple-500 mt-0.5">Esto puede tardar 30–60 segundos</p>
                              </div>
                            </div>
                          )}

                          {varAnalysisError && !analyzingVars && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                              <AlertCircle size={18} className="text-red-500 shrink-0" />
                              <p className="text-sm text-red-700">{varAnalysisError}</p>
                            </div>
                          )}

                          {/* Detected placeholders table */}
                          {detectedPlaceholders.length > 0 && (
                            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Brain size={14} className="text-purple-600" />
                                  <h3 className="text-sm font-semibold text-gray-800">Variables detectadas</h3>
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                                    {detectedPlaceholders.length}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleAnalyzeVars}
                                  className="text-xs text-purple-600 font-medium hover:underline disabled:opacity-50"
                                  disabled={analyzingVars}
                                >
                                  Re-analizar
                                </button>
                              </div>
                              <div className="divide-y divide-gray-50">
                                {detectedPlaceholders.map((ph, idx) => (
                                  <div key={idx} className="px-5 py-3 flex items-start gap-3">
                                    <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                      {ph.occurrence}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] text-gray-500 italic leading-snug line-clamp-2" title={ph.context}>
                                        «{ph.context}»
                                      </p>
                                      <p className="text-[10px] text-gray-400 mt-0.5">pág. {ph.pageIndex + 1}</p>
                                    </div>
                                    <select
                                      value={variableMappings[idx]?.variable || ''}
                                      onChange={(e) => updateVarMapping(idx, e.target.value)}
                                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 shrink-0 max-w-[170px]"
                                    >
                                      <option value="">— Sin variable —</option>
                                      {VARIABLES.map((v) => (
                                        <option key={v.id} value={v.id}>{v.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Saved mappings (edit mode, no fresh analysis) */}
                          {variableMappings.length > 0 && detectedPlaceholders.length === 0 && !analyzingVars && (
                            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Brain size={14} className="text-purple-600" />
                                  <h3 className="text-sm font-semibold text-gray-800">Variables configuradas</h3>
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                                    {variableMappings.length}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleAnalyzeVars}
                                  className="text-xs text-purple-600 font-medium hover:underline"
                                >
                                  Re-analizar con IA
                                </button>
                              </div>
                              <div className="divide-y divide-gray-50">
                                {variableMappings.map((m, idx) => (
                                  <div key={idx} className="px-5 py-3 flex items-center gap-3">
                                    <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                                      {idx + 1}
                                    </span>
                                    <span className="flex-1 text-xs text-gray-400 italic">
                                      {VARIABLES.find((v) => v.id === m.variable)?.description?.split('.')[0] || `Placeholder #${idx + 1}`}
                                    </span>
                                    <select
                                      value={m.variable || ''}
                                      onChange={(e) => updateVarMapping(idx, e.target.value)}
                                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 shrink-0 max-w-[170px]"
                                    >
                                      <option value="">— Sin variable —</option>
                                      {VARIABLES.map((v) => (
                                        <option key={v.id} value={v.id}>{v.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Field editor */}
                          {signatureFields.length > 0 && (
                            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-gray-800">Campos de firma e iniciales</h3>
                                <p className="text-xs text-gray-400">{signatureFields.length} campo{signatureFields.length > 1 ? 's' : ''}</p>
                              </div>
                              <div className="divide-y divide-gray-50">
                                {signatureFields.map((field) => (
                                  <div key={field.id} className="px-5 py-3 flex items-center gap-3">
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${fieldTypeColor(field.type)}`}>
                                      {fieldTypeLabel(field.type)}
                                    </span>
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      <label className="text-[10px] text-gray-400 shrink-0">Pág:</label>
                                      <input
                                        type="number"
                                        min={1}
                                        max={pdfPageCount}
                                        value={field.pageIndex + 1}
                                        onChange={(e) => updateField(field.id, { pageIndex: Math.max(0, parseInt(e.target.value) - 1) || 0 })}
                                        className="w-12 text-xs border border-gray-200 rounded px-1.5 py-1 text-center"
                                      />
                                      <label className="text-[10px] text-gray-400 shrink-0">X:</label>
                                      <input
                                        type="number"
                                        value={Math.round(field.x)}
                                        onChange={(e) => updateField(field.id, { x: parseInt(e.target.value) || 0 })}
                                        className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 text-center"
                                      />
                                      <label className="text-[10px] text-gray-400 shrink-0">Y:</label>
                                      <input
                                        type="number"
                                        value={Math.round(field.y)}
                                        onChange={(e) => updateField(field.id, { y: parseInt(e.target.value) || 0 })}
                                        className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 text-center"
                                      />
                                      <label className="text-[10px] text-gray-400 shrink-0">W:</label>
                                      <input
                                        type="number"
                                        value={Math.round(field.width)}
                                        onChange={(e) => updateField(field.id, { width: parseInt(e.target.value) || 50 })}
                                        className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 text-center"
                                      />
                                      <label className="text-[10px] text-gray-400 shrink-0">H:</label>
                                      <input
                                        type="number"
                                        value={Math.round(field.height)}
                                        onChange={(e) => updateField(field.id, { height: parseInt(e.target.value) || 25 })}
                                        className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 text-center"
                                      />
                                    </div>
                                    <input
                                      type="text"
                                      value={field.label || ''}
                                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                                      placeholder="Etiqueta"
                                      className="w-32 text-xs border border-gray-200 rounded px-2 py-1"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeField(field.id)}
                                      className="p-1 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* PDF Preview */}
                          {pdfUrl && (
                            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                              <div className="px-5 py-3 border-b border-gray-100">
                                <h3 className="text-sm font-semibold text-gray-800">Vista previa del PDF</h3>
                              </div>
                              <div className="p-2">
                                <iframe
                                  src={pdfUrl}
                                  className="w-full rounded-lg border border-gray-100"
                                  style={{ height: '500px' }}
                                  title="PDF Preview"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {pdfError && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                          <AlertCircle size={18} className="text-red-500 shrink-0" />
                          <p className="text-sm text-red-700">{pdfError}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
