import { useState, useEffect } from 'react';
import { Check, Info, Mail } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { useSettings } from '../hooks/useSettings';
import type { EmailTemplatesSettings } from '../types';

type TemplateKey = 'invitation' | 'reminder' | 'offer' | 'contract';

const TEMPLATE_META: Record<TemplateKey, {
  title: string;
  headerText: string;
  ctaText: string;
  headerColor: string;
  footerNote: string;
}> = {
  invitation: {
    title: 'Correo de invitación',
    headerText: '¡Bienvenido a Aviva!',
    ctaText: 'Subir mi documentación →',
    headerColor: '#16b877',
    footerNote: '* Los documentos requeridos y el botón de acción se agregan automáticamente',
  },
  reminder: {
    title: 'Recordatorio de documentos',
    headerText: 'Documentos Pendientes',
    ctaText: 'Completar documentación →',
    headerColor: '#f59e0b',
    footerNote: '* El listado de documentos pendientes se agrega automáticamente',
  },
  offer: {
    title: 'Correo de carta oferta',
    headerText: 'Tu Carta Oferta está lista',
    ctaText: 'Ver mi carta oferta →',
    headerColor: '#16b877',
    footerNote: '* El enlace para revisar y firmar la carta oferta se agrega automáticamente',
  },
  contract: {
    title: 'Correo de contrato',
    headerText: 'Tu Contrato está listo',
    ctaText: 'Revisar y firmar contrato →',
    headerColor: '#16b877',
    footerNote: '* El enlace para revisar y firmar el contrato se agrega automáticamente',
  },
};

export function EmailTemplatesPage() {
  const { emailTemplates, saving, savedKey, saveEmailTemplates, loading } = useSettings();
  const [selected, setSelected] = useState<TemplateKey>('invitation');
  const [local, setLocal] = useState<EmailTemplatesSettings>(emailTemplates);

  useEffect(() => { setLocal(emailTemplates); }, [emailTemplates]);

  const current = local[selected];
  const meta = TEMPLATE_META[selected];

  const update = (field: 'subject' | 'bodyText', value: string) => {
    setLocal(prev => ({ ...prev, [selected]: { ...prev[selected], [field]: value } }));
  };

  const handleSave = () => {
    saveEmailTemplates(local);
  };

  const saved = savedKey === 'emails';

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Mail size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Correos</h2>
          </div>
          <div className="flex gap-1 flex-wrap">
            {(Object.keys(TEMPLATE_META) as TemplateKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selected === key
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {TEMPLATE_META[key].title}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Editor */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Asunto del correo
                  </label>
                  <input
                    type="text"
                    value={current.subject}
                    onChange={(e) => update('subject', e.target.value)}
                    className="input-field text-sm"
                  />
                  <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1">
                    <Info size={11} />
                    Usa{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{position}'}</code>
                    {' '}para el puesto del candidato
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Mensaje principal
                  </label>
                  <textarea
                    value={current.bodyText}
                    onChange={(e) => update('bodyText', e.target.value)}
                    rows={6}
                    placeholder="Escribe el mensaje que recibirá el candidato..."
                    className="input-field text-sm resize-none"
                  />
                  <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1">
                    <Info size={11} />
                    Usa{' '}
                    <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>
                    {' '}para el nombre del candidato
                  </p>
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex items-center gap-2"
                >
                  {saved ? (
                    <><Check size={15} /> Guardado</>
                  ) : saving ? (
                    'Guardando...'
                  ) : (
                    'Guardar plantilla'
                  )}
                </button>
              </div>

              {/* Live preview */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Vista previa
                </p>
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div
                    className="px-6 py-5 text-center"
                    style={{ backgroundColor: meta.headerColor }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.2)' }}
                    >
                      <span className="text-white font-bold text-lg">A</span>
                    </div>
                    <p className="text-white font-bold text-base">{meta.headerText}</p>
                    <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
                      Proceso de ingreso · Puesto ejemplo
                    </p>
                  </div>

                  <div className="bg-white px-6 py-5">
                    <p className="text-gray-700 text-sm mb-2">
                      Hola <strong>Juan</strong>,
                    </p>
                    <p className="text-gray-500 text-xs leading-relaxed mb-4">
                      {current.bodyText || <em>Sin mensaje</em>}
                    </p>
                    <div className="text-center">
                      <span
                        className="inline-block px-5 py-2.5 rounded-lg text-white text-xs font-semibold"
                        style={{ backgroundColor: meta.headerColor }}
                      >
                        {meta.ctaText}
                      </span>
                    </div>
                  </div>

                  <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 text-center">
                    <p className="text-gray-400 text-xs">
                      © {new Date().getFullYear()} Aviva · Equipo de Reclutamiento
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {meta.footerNote}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
