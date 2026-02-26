import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { DocumentSettings, DocumentType } from '../../types';
import { DOCUMENT_TYPES } from '../../types';

interface Props {
  settings: DocumentSettings;
  saving: boolean;
  saved: boolean;
  onSave: (s: DocumentSettings) => void;
}

export function DocumentsTab({ settings, saving, saved, onSave }: Props) {
  const [local, setLocal] = useState(settings);
  const [expanded, setExpanded] = useState<DocumentType | null>(null);

  useEffect(() => { setLocal(settings); }, [settings]);

  const update = (type: DocumentType, field: 'label' | 'description', value: string) => {
    setLocal(prev => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  };

  const toggleRequired = (type: DocumentType) => {
    setLocal(prev => ({ ...prev, [type]: { ...prev[type], required: !prev[type].required } }));
  };

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-5">
        Configura los nombres y descripciones de los documentos que se muestran a los candidatos en
        su formulario de ingreso.
      </p>

      <div className="space-y-2 mb-6">
        {DOCUMENT_TYPES.map((type) => {
          const doc = local[type];
          const isExpanded = expanded === type;

          return (
            <div key={type} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Row header */}
              <div className="flex items-center px-4 py-3.5">
                {/* Required toggle */}
                <button
                  onClick={() => toggleRequired(type)}
                  title={doc.required ? 'Marcar como opcional' : 'Marcar como requerido'}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mr-3 ${
                    doc.required ? 'bg-primary-500' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                      doc.required ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>

                {/* Label + badge */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{doc.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {doc.required ? 'Requerido' : 'Opcional'}
                  </p>
                </div>

                {/* Expand button */}
                <button
                  onClick={() => setExpanded(isExpanded ? null : type)}
                  className="ml-3 text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              {/* Expanded edit fields */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Nombre del documento
                    </label>
                    <input
                      type="text"
                      value={doc.label}
                      onChange={(e) => update(type, 'label', e.target.value)}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Descripción (instrucciones para el candidato)
                    </label>
                    <textarea
                      value={doc.description}
                      onChange={(e) => update(type, 'description', e.target.value)}
                      rows={2}
                      className="input-field text-sm resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
          'Guardar configuración de documentos'
        )}
      </button>
    </div>
  );
}
