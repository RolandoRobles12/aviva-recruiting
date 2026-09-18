import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  listHubspotRoles,
  syncHubspotUserRoles,
  type HubspotRole,
  type HubspotRoleSyncEntry,
} from '../../services/functions';
import { getHubspotSettings, saveHubspotSettings } from '../../services/settings';

const STATUS_LABELS: Record<HubspotRoleSyncEntry['status'], string> = {
  assigned: 'Rol aplicado',
  would_assign: 'Sin rol — se le aplicaría',
  already_set: 'Ya tenía rol',
  not_configured: 'Sin rol configurado',
  user_not_found: 'Sin usuario en HubSpot',
  skipped_super_admin: 'Súper administrador — sin cambios',
  error: 'Error',
};

/**
 * Picks the HubSpot role every new promotor account is created with.
 *
 * A user created without a role lands on HubSpot's minimum access — ve solo sus
 * propios contactos y negocios — which is why accounts were arriving without
 * the permissions they need. The role ids only exist inside HubSpot, so they
 * are read from the portal instead of typed by hand.
 */
export function HubspotTab() {
  const [roles, setRoles] = useState<HubspotRole[]>([]);
  const [roleId, setRoleId] = useState('');
  const [primaryTeamId, setPrimaryTeamId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [syncing, setSyncing] = useState<'dry' | 'real' | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncEntries, setSyncEntries] = useState<HubspotRoleSyncEntry[]>([]);
  const [simulated, setSimulated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const stored = await getHubspotSettings();
      setRoleId(stored.roleId);
      setPrimaryTeamId(stored.primaryTeamId);
      const res = await listHubspotRoles({});
      setRoles(res.data.roles);
      // The function reports what the backend actually resolves, including the
      // deploy-param fallback, so an unsaved-but-configured role still shows.
      if (!stored.roleId && res.data.roleId) setRoleId(res.data.roleId);
      if (!stored.primaryTeamId && res.data.primaryTeamId) setPrimaryTeamId(res.data.primaryTeamId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudieron leer los roles de HubSpot.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveHubspotSettings({ roleId, primaryTeamId: primaryTeamId.trim() });
      setSaved(true);
      // Applying to existing accounts must be re-simulated against the new role.
      setSimulated(false);
      setSyncEntries([]);
      setSyncMessage('');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (dryRun: boolean) => {
    setSyncing(dryRun ? 'dry' : 'real');
    setSyncMessage('');
    setSyncEntries([]);
    try {
      const res = await syncHubspotUserRoles({ dryRun });
      setSyncMessage(res.data.message);
      setSyncEntries(res.data.details);
      setSimulated(dryRun);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Error desconocido');
      setSimulated(false);
    } finally {
      setSyncing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={15} className="animate-spin" />
        Leyendo roles de HubSpot...
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Permisos en HubSpot</h3>
        <p className="text-sm text-gray-500">
          Rol con el que se crean las cuentas de los promotores. Si se deja vacío, HubSpot les da
          su acceso mínimo —ver solo sus propios contactos y negocios—, así que aquí debe quedar el
          rol que incluye <span className="font-medium">ver todos los contactos y negocios</span>.
        </p>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{loadError}</p>
            <button onClick={() => void load()} className="mt-1 font-medium underline">
              Reintentar
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700">Rol para cuentas nuevas</label>
          <p className="text-xs text-gray-400 mt-0.5 mb-3">
            La lista viene del portal de HubSpot.
          </p>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="input-field w-full text-sm"
          >
            <option value="">Sin rol (permisos mínimos de HubSpot)</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.id})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Equipo principal</label>
          <p className="text-xs text-gray-400 mt-0.5 mb-3">
            ID del equipo al que se agregan las cuentas nuevas. Déjalo vacío para no asignar equipo.
          </p>
          <input
            type="text"
            value={primaryTeamId}
            onChange={(e) => setPrimaryTeamId(e.target.value)}
            placeholder="11727817"
            className="input-field w-full text-sm"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary flex items-center justify-center gap-2 text-sm py-2 px-6"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
        {saved ? 'Guardado' : saving ? 'Guardando...' : 'Guardar'}
      </button>

      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <ShieldCheck size={15} className="text-primary-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-700">Aplicar el rol a cuentas ya creadas</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Revisa las cuentas de HubSpot que ya se provisionaron y le pone el rol a las que se
              quedaron sin ninguno. A quien ya tiene un rol no se le toca, así que nadie pierde
              permisos. Simula primero para ver a quién afectaría.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleSync(true)}
            disabled={syncing !== null}
            className="flex items-center gap-2 bg-white text-gray-700 border border-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            {syncing === 'dry' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {syncing === 'dry' ? 'Simulando...' : 'Simular'}
          </button>
          <button
            onClick={() => void handleSync(false)}
            disabled={syncing !== null || !simulated}
            title={simulated ? undefined : 'Corre la simulación primero'}
            className="flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors disabled:opacity-60"
          >
            {syncing === 'real' ? 'Aplicando...' : 'Aplicar rol'}
          </button>
        </div>
        {syncMessage && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            {syncMessage}
          </p>
        )}
        {syncEntries.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Cuenta</th>
                    <th className="px-3 py-2 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {syncEntries.map((entry) => (
                    <tr key={entry.candidateId} className="text-gray-700">
                      <td className="px-3 py-2">
                        <p className="font-medium">{entry.name || entry.candidateId}</p>
                        <p className="text-gray-400">{entry.email}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={entry.status === 'error' ? 'text-red-600' : 'text-gray-600'}>
                          {STATUS_LABELS[entry.status]}
                        </span>
                        {entry.error && <p className="text-red-500 mt-0.5">{entry.error}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
