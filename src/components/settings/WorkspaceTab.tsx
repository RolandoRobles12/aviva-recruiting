import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  Loader2,
  Plus,
  PlugZap,
  TableProperties,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  getWorkspaceIntegrationSettings,
  saveWorkspaceIntegrationSettings,
  testWorkspaceConnection,
  type DriveCheck,
  type DriveDestination,
  type SheetCheck,
  type SheetDestination,
  type WorkspaceField,
  type WorkspaceSettings,
} from '../../services/functions';

/**
 * Where the expediente and the onboarding row are sent: any number of Drive
 * folders and spreadsheets. This used to be hardcoded in the functions, so
 * changing a folder, a spreadsheet or even a tab meant a deploy.
 *
 * Everything is validated and normalized server-side (pasted URLs included),
 * and "Probar conexión" checks the unsaved state against Google without
 * writing anything, so a change can be verified before it is saved.
 */

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function driveUrl(id: string): string | null {
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? `https://drive.google.com/drive/folders/${id}` : null;
}

function sheetUrl(dest: SheetDestination): string | null {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(dest.spreadsheetId)) return null;
  const gid = dest.sheetGid !== null ? `#gid=${dest.sheetGid}` : '';
  return `https://docs.google.com/spreadsheets/d/${dest.spreadsheetId}/edit${gid}`;
}

function StatusLine({ ok, warn = false, message }: { ok: boolean; warn?: boolean; message: string }) {
  const tone = !ok ? 'text-red-700' : warn ? 'text-amber-700' : 'text-green-700';
  const Icon = !ok ? XCircle : warn ? AlertTriangle : CheckCircle2;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${tone}`}>
      <Icon size={13} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </p>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  );
}

// ─── Drive ────────────────────────────────────────────────────────────────────

function DriveCard({
  dest,
  check,
  onChange,
  onPrimary,
  onRemove,
}: {
  dest: DriveDestination;
  check?: DriveCheck;
  onChange: (patch: Partial<DriveDestination>) => void;
  onPrimary: () => void;
  onRemove: () => void;
}) {
  const url = driveUrl(dest.folderId);
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
      <div className="flex gap-2">
        <input
          value={dest.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Nombre (p. ej. Expedientes)"
          className="input-field text-sm flex-1"
        />
        <button onClick={onRemove} className="text-gray-400 hover:text-red-600 px-1" title="Quitar este Drive">
          <Trash2 size={15} />
        </button>
      </div>
      <input
        value={dest.folderId}
        onChange={(e) => onChange({ folderId: e.target.value })}
        placeholder="Pega el enlace de la carpeta de Drive"
        className="input-field text-xs w-full font-mono"
      />
      <div className="flex flex-wrap items-center gap-4">
        <Toggle label="Activo" checked={dest.enabled} onChange={(enabled) => onChange({ enabled })} />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="La carpeta que se enlaza en la app y en la columna Expediente">
          <input type="radio" checked={dest.primary} onChange={onPrimary} disabled={!dest.enabled} />
          Principal
        </label>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">
            Abrir carpeta
          </a>
        )}
      </div>
      {check && (
        <StatusLine ok={check.ok} message={check.folderName ? `${check.folderName}: ${check.message}` : check.message} />
      )}
    </div>
  );
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

function SheetCheckDetail({
  check,
  dest,
  fields,
  onMap,
}: {
  check: SheetCheck;
  dest: SheetDestination;
  fields: WorkspaceField[];
  onMap: (fieldKey: string, header: string) => void;
}) {
  const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const mappedOverrides = Object.entries(dest.headerMap);

  return (
    <div className="space-y-2">
      <StatusLine
        ok={check.ok}
        warn={check.columnMode === 'posicion' && check.positionMismatches.length > 0}
        message={`${check.spreadsheetTitle ? `${check.spreadsheetTitle} › ${check.tabTitle ?? ''}: ` : ''}${check.message}`}
      />

      {check.columnMode === 'posicion' && check.positionMismatches.length > 0 && (
        <details className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2">
          <summary className="cursor-pointer font-medium">
            {check.positionMismatches.length} columna(s) no parecen coincidir con el orden fijo
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {check.positionMismatches.map((m) => (
              <li key={m.column}>
                Columna {m.column + 1}: dice "{m.header || '(vacía)'}", se escribe <strong>{m.expected}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}

      {check.headers.length > 0 && (
        <details className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2" open={check.columnMode === 'encabezados' && check.unmatched.length > 0}>
          <summary className="cursor-pointer font-medium text-gray-700">
            Acomodo por encabezado: {check.matched.length} de {check.matched.length + check.unmatched.length} datos
            tienen columna
            {check.columnMode === 'posicion' ? ' (vista previa: la hoja sigue en orden fijo)' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {check.unmatched.length > 0 && (
              <div className="space-y-1">
                <p className="text-gray-500">
                  Sin columna (no se escriben). Si la hoja sí tiene la columna con otro título, elígela:
                </p>
                {check.unmatched.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <span className={`w-48 shrink-0 ${check.missingRequired.includes(field.key) ? 'text-red-700 font-medium' : ''}`}>
                      {field.label}
                      {check.missingRequired.includes(field.key) ? ' (obligatorio)' : ''}
                    </span>
                    <select
                      value=""
                      onChange={(e) => e.target.value && onMap(field.key, e.target.value)}
                      className="input-field text-xs py-1 flex-1"
                    >
                      <option value="">— sin columna —</option>
                      {check.unmappedHeaders.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {mappedOverrides.length > 0 && (
              <div className="space-y-1">
                <p className="text-gray-500">Columnas elegidas a mano:</p>
                {mappedOverrides.map(([key, header]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span>
                      {label(key)} → "{header}"
                    </span>
                    <button onClick={() => onMap(key, '')} className="text-gray-400 hover:text-red-600" title="Quitar">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {check.unmappedHeaders.length > 0 && (
              <p className="text-gray-400">
                Columnas de la hoja que no se tocan: {check.unmappedHeaders.join(' · ')}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function SheetCard({
  dest,
  check,
  fields,
  onChange,
  onRemove,
}: {
  dest: SheetDestination;
  check?: SheetCheck;
  fields: WorkspaceField[];
  onChange: (patch: Partial<SheetDestination>) => void;
  onRemove: () => void;
}) {
  const url = sheetUrl(dest);
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
      <div className="flex gap-2">
        <input
          value={dest.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Nombre (p. ej. Base MASTER)"
          className="input-field text-sm flex-1"
        />
        <button onClick={onRemove} className="text-gray-400 hover:text-red-600 px-1" title="Quitar esta hoja">
          <Trash2 size={15} />
        </button>
      </div>
      <input
        value={dest.spreadsheetId}
        // A pasted link carries the tab's gid; the stored one is cleared so the
        // server takes the new one from the link.
        onChange={(e) => onChange({ spreadsheetId: e.target.value, ...(e.target.value.includes('gid=') ? { sheetGid: null } : {}) })}
        placeholder="Pega el enlace de la hoja, abierta en la pestaña correcta"
        className="input-field text-xs w-full font-mono"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-600 space-y-1">
          Pestaña
          <input
            value={dest.sheetTitle}
            onChange={(e) => onChange({ sheetTitle: e.target.value })}
            placeholder={dest.sheetGid !== null ? 'Se identifica por el enlace' : 'Nombre de la pestaña'}
            className="input-field text-xs w-full"
          />
          <span className="block text-gray-400">
            {dest.sheetGid !== null
              ? `gid ${dest.sheetGid}: se encuentra aunque le cambien el nombre.`
              : 'Sin gid: pega el enlace abierto en la pestaña para que sobreviva a cambios de nombre.'}
          </span>
        </label>
        <label className="text-xs text-gray-600 space-y-1">
          Cómo se acomodan los datos
          <select
            value={dest.columnMode}
            onChange={(e) => onChange({ columnMode: e.target.value as SheetDestination['columnMode'] })}
            className="input-field text-xs w-full"
          >
            <option value="encabezados">Por encabezado (recomendado)</option>
            <option value="posicion">Orden fijo de 61 columnas</option>
          </select>
          <span className="block text-gray-400">
            {dest.columnMode === 'encabezados'
              ? 'Cada dato va bajo la columna con su título; mover o agregar columnas no los recorre.'
              : 'Escribe siempre en el mismo orden: insertar una columna recorre los datos.'}
          </span>
        </label>
      </div>
      {dest.columnMode === 'posicion' && (
        <label className="text-xs text-gray-600 flex items-center gap-2">
          Escribir solo las primeras
          <input
            type="number"
            min={1}
            max={61}
            value={dest.maxColumns ?? ''}
            onChange={(e) => onChange({ maxColumns: e.target.value ? Number(e.target.value) : null })}
            placeholder="61"
            className="input-field text-xs w-20"
          />
          columnas (el resto las maneja la hoja)
        </label>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Toggle label="Activa" checked={dest.enabled} onChange={(enabled) => onChange({ enabled })} />
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">
            Abrir hoja
          </a>
        )}
      </div>
      {check && (
        <SheetCheckDetail
          check={check}
          dest={dest}
          fields={fields}
          onMap={(fieldKey, header) => {
            const headerMap = { ...dest.headerMap };
            if (header) headerMap[fieldKey] = header;
            else delete headerMap[fieldKey];
            onChange({ headerMap });
          }}
        />
      )}
    </div>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export function WorkspaceTab() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [fields, setFields] = useState<WorkspaceField[]>([]);
  const [serviceAccountEmail, setServiceAccountEmail] = useState('');
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [driveChecks, setDriveChecks] = useState<Record<string, DriveCheck>>({});
  const [sheetChecks, setSheetChecks] = useState<Record<string, SheetCheck>>({});
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await getWorkspaceIntegrationSettings({});
      setSettings(res.data.settings);
      setFields(res.data.fields);
      setServiceAccountEmail(res.data.serviceAccountEmail);
      setDirty(false);
    } catch (err) {
      setLoadError(errorMessage(err, 'No se pudo leer la configuración.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (next: WorkspaceSettings) => {
    setSettings(next);
    setDirty(true);
    setSaved(false);
  };

  const patchDrive = (index: number, patch: Partial<DriveDestination>) =>
    settings && update({ ...settings, drives: settings.drives.map((d, i) => (i === index ? { ...d, ...patch } : d)) });
  const patchSheet = (index: number, patch: Partial<SheetDestination>) =>
    settings && update({ ...settings, sheets: settings.sheets.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  const handleTest = async () => {
    if (!settings) return;
    setTesting(true);
    setTestError('');
    try {
      const res = await testWorkspaceConnection({ settings });
      setDriveChecks(Object.fromEntries(res.data.drives.map((c) => [c.id, c])));
      setSheetChecks(Object.fromEntries(res.data.sheets.map((c) => [c.id, c])));
      if (res.data.serviceAccountEmail) setServiceAccountEmail(res.data.serviceAccountEmail);
    } catch (err) {
      setTestError(errorMessage(err, 'No se pudo probar la conexión.'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await saveWorkspaceIntegrationSettings({ settings });
      setSettings(res.data.settings);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(errorMessage(err, 'No se pudo guardar.'));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 max-w-2xl">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div>
          <p>{loadError}</p>
          <button onClick={() => void load()} className="mt-1 font-medium underline">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={15} className="animate-spin" /> Leyendo configuración...
      </div>
    );
  }

  const enabledDrives = settings.drives.filter((d) => d.enabled);
  const enabledSheets = settings.sheets.filter((s) => s.enabled);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Drive y Google Sheets</h3>
        <p className="text-sm text-gray-500">
          Al firmar el contrato, el expediente del candidato se copia a cada carpeta de Drive activa y se
          agrega su fila a cada hoja activa. Si una hoja ya tiene la referencia del candidato, no se
          duplica.
        </p>
      </div>

      {serviceAccountEmail && (
        <div className="text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 space-y-1">
          <p>
            Comparte cada carpeta y cada hoja con esta cuenta como <strong>Editor</strong>:
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-white border border-blue-100 rounded px-1.5 py-0.5 break-all">{serviceAccountEmail}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(serviceAccountEmail);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-blue-700 hover:text-blue-900 shrink-0"
              title="Copiar"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
      )}

      {/* Drive */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
            <FolderOpen size={14} className="text-green-600" /> Carpetas de Drive
          </h4>
          <button
            onClick={() =>
              update({
                ...settings,
                drives: [
                  ...settings.drives,
                  { id: newId('drive'), label: '', folderId: '', enabled: true, primary: enabledDrives.length === 0 },
                ],
              })
            }
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <Plus size={13} /> Agregar carpeta
          </button>
        </div>
        <p className="text-xs text-gray-400">
          Dentro de cada una se crea una carpeta por candidato. La <strong>principal</strong> es la que se enlaza
          en la app y se escribe en la columna "Expediente".
        </p>
        {settings.drives.length === 0 && (
          <p className="text-xs text-amber-700">Sin carpetas: los expedientes no se copiarán a Drive.</p>
        )}
        {settings.drives.map((dest, index) => (
          <DriveCard
            key={dest.id}
            dest={dest}
            check={driveChecks[dest.id]}
            onChange={(patch) => patchDrive(index, patch)}
            onPrimary={() =>
              update({ ...settings, drives: settings.drives.map((d, i) => ({ ...d, primary: i === index })) })
            }
            onRemove={() => update({ ...settings, drives: settings.drives.filter((_, i) => i !== index) })}
          />
        ))}
      </div>

      {/* Sheets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
            <TableProperties size={14} className="text-emerald-600" /> Hojas de Google Sheets
          </h4>
          <button
            onClick={() =>
              update({
                ...settings,
                sheets: [
                  ...settings.sheets,
                  {
                    id: newId('hoja'),
                    label: '',
                    spreadsheetId: '',
                    sheetGid: null,
                    sheetTitle: '',
                    columnMode: 'encabezados',
                    maxColumns: null,
                    headerMap: {},
                    enabled: true,
                  },
                ],
              })
            }
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <Plus size={13} /> Agregar hoja
          </button>
        </div>
        {settings.sheets.length === 0 && (
          <p className="text-xs text-amber-700">Sin hojas: no se agregará ninguna fila.</p>
        )}
        {settings.sheets.map((dest, index) => (
          <SheetCard
            key={dest.id}
            dest={dest}
            check={sheetChecks[dest.id]}
            fields={fields}
            onChange={(patch) => patchSheet(index, patch)}
            onRemove={() => update({ ...settings, sheets: settings.sheets.filter((_, i) => i !== index) })}
          />
        ))}
      </div>

      {(testError || saveError) && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <p>{testError || saveError}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => void handleTest()}
          disabled={testing || (enabledDrives.length === 0 && enabledSheets.length === 0)}
          className="flex items-center gap-2 bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
          {testing ? 'Probando...' : 'Probar conexión'}
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="btn-primary flex items-center justify-center gap-2 text-sm py-2 px-6 disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? 'Guardado' : saving ? 'Guardando...' : 'Guardar'}
        </button>
        <p className="text-xs text-gray-400">
          "Probar conexión" revisa lo que está en pantalla sin escribir nada. Los cambios aplican al siguiente
          candidato (hasta 1 minuto después de guardar).
        </p>
      </div>
    </div>
  );
}
