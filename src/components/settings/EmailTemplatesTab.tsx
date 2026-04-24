import { useState, useEffect } from 'react';
import { Check, Info } from 'lucide-react';
import type { EmailTemplatesSettings } from '../../types';
import { getBrandingSettings } from '../../services/settings';

interface Props {
  templates: EmailTemplatesSettings;
  saving: boolean;
  saved: boolean;
  onSave: (t: EmailTemplatesSettings) => void;
}

type TemplateKey = 'invitation' | 'reminder' | 'offer' | 'contract';

const TEMPLATE_META: Record<TemplateKey, {
  title: string;
  headerText: string;
  ctaText: string;
  headerColor: string;
}> = {
  invitation: {
    title: 'Correo de invitación',
    headerText: '¡Bienvenido a Aviva!',
    ctaText: 'Subir mi documentación →',
    headerColor: '#16b877',
  },
  reminder: {
    title: 'Recordatorio de documentos',
    headerText: 'Documentos Pendientes',
    ctaText: 'Completar documentación →',
    headerColor: '#f59e0b',
  },
  offer: {
    title: 'Carta oferta',
    headerText: '¡Tienes una oferta!',
    ctaText: 'Ver carta oferta →',
    headerColor: '#16b877',
  },
  contract: {
    title: 'Contrato',
    headerText: 'Tu contrato está listo',
    ctaText: 'Firmar contrato →',
    headerColor: '#6366f1',
  },
};

export function EmailTemplatesTab({ templates, saving, saved, onSave }: Props) {
  const [selected, setSelected] = useState<TemplateKey>('invitation');
  const [local, setLocal] = useState(templates);
  const [logoUrl, setLogoUrl] = useState<string | undefined>();

  useEffect(() => { setLocal(templates); }, [templates]);
  useEffect(() => { getBrandingSettings().then((s) => setLogoUrl(s.logoUrl)); }, []);

  const current = local[selected];
  const meta = TEMPLATE_META[selected];

  const update = (field: 'subject' | 'bodyText', value: string) => {
    setLocal(prev => ({ ...prev, [selected]: { ...prev[selected], [field]: value } }));
  };

  return (
    <div className="max-w-5xl">
      {/* Template selector */}
      <div className="flex gap-2 mb-6">
        {(Object.keys(TEMPLATE_META) as TemplateKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              selected === key
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {TEMPLATE_META[key].title}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            onClick={() => onSave(local)}
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
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="h-8 max-w-[140px] object-contain mx-auto mb-2"
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.2)' }}
                >
                  <span className="text-white font-bold text-lg">A</span>
                </div>
              )}
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
                  style={{ backgroundColor: '#16b877' }}
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
            * Los documentos requeridos y el botón de acción se agregan automáticamente
          </p>
        </div>
      </div>
    </div>
  );
}
