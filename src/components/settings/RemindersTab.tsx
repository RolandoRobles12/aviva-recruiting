import { useState, useEffect } from 'react';
import { Check, Info } from 'lucide-react';
import type { ReminderSettings } from '../../types';

interface Props {
  settings: ReminderSettings;
  saving: boolean;
  saved: boolean;
  onSave: (s: ReminderSettings) => void;
}

export function RemindersTab({ settings, saving, saved, onSave }: Props) {
  const [local, setLocal] = useState(settings);

  useEffect(() => { setLocal(settings); }, [settings]);

  const intervalDays = Math.max(1, Math.round(local.intervalHours / 24));

  return (
    <div className="max-w-lg">
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
        {/* Enable toggle */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-gray-900">Recordatorios automáticos</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Envía emails automáticos a candidatos con documentos pendientes cada día a las 9:00 AM
            </p>
          </div>
          <button
            onClick={() => setLocal(prev => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 mt-0.5 ${
              local.enabled ? 'bg-primary-500' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                local.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className={`space-y-5 transition-opacity ${!local.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {/* Interval */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Días entre recordatorios
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={30}
                value={intervalDays}
                onChange={(e) =>
                  setLocal(prev => ({
                    ...prev,
                    intervalHours: Math.max(1, parseInt(e.target.value) || 1) * 24,
                  }))
                }
                className="input-field w-24 text-sm"
              />
              <span className="text-sm text-gray-500">días</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Mínimo 1 día entre cada recordatorio por candidato
            </p>
          </div>

          {/* Max reminders */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Máximo de recordatorios por candidato
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={20}
                value={local.maxReminders}
                onChange={(e) =>
                  setLocal(prev => ({
                    ...prev,
                    maxReminders: Math.max(1, parseInt(e.target.value) || 1),
                  }))
                }
                className="input-field w-24 text-sm"
              />
              <span className="text-sm text-gray-500">recordatorios</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Después de este límite no se enviarán más recordatorios automáticos
            </p>
          </div>
        </div>

        {/* Info */}
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-lg p-3">
          <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 leading-relaxed">
            Los recordatorios automáticos se procesan cada día a las <strong>9:00 AM</strong> hora
            de la CDMX. Los recordatorios manuales desde el panel del candidato no están limitados
            por esta configuración.
          </p>
        </div>

        <button
          onClick={() => onSave(local)}
          disabled={saving}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saved ? (
            <><Check size={15} /> Guardado</>
          ) : saving ? (
            'Guardando...'
          ) : (
            'Guardar configuración'
          )}
        </button>
      </div>
    </div>
  );
}
