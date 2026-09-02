import { useState } from 'react';
import { Bell, Settings, Link, Clock, Wrench, HelpCircle, Palette } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { RemindersTab } from '../components/settings/RemindersTab';
import { GmailConnectionTab } from '../components/settings/GmailConnectionTab';
import { LinkDurationTab } from '../components/settings/LinkDurationTab';
import { QuestionsTab } from '../components/settings/QuestionsTab';
import { BrandingTab } from '../components/settings/BrandingTab';
import { useSettings } from '../hooks/useSettings';
import {
  backfillCandidateDocuments,
  backfillCandidatePlaza,
  runPerformanceChecksNow,
  recalculatePerformanceStatuses,
} from '../services/functions';
import type { PerformanceRecalcChange } from '../services/functions';

const STAGE_LABELS: Record<string, string> = {
  contract_signed: 'Contrato firmado',
  email_pending: 'Correo pendiente',
  email_ready: 'Correo listo',
  induction: 'Onboarding',
  onboarding_iniciado: 'Onboarding Iniciado',
  promotor_exitoso: 'Promotor Exitoso',
  bajo_desempeno: 'Bajo Desempeño',
};

const stageLabel = (status: string) => STAGE_LABELS[status] ?? status;

type Tab = 'gmail' | 'reminders' | 'links' | 'questions' | 'branding' | 'admin';

const TABS: { id: Tab; label: string; Icon: typeof Link }[] = [
  { id: 'gmail', label: 'Conexión Gmail', Icon: Link },
  { id: 'reminders', label: 'Recordatorios', Icon: Bell },
  { id: 'links', label: 'Duración de enlaces', Icon: Clock },
  { id: 'questions', label: 'Preguntas del formulario', Icon: HelpCircle },
  { id: 'branding', label: 'Marca', Icon: Palette },
  { id: 'admin', label: 'Admin', Icon: Wrench },
];

function AdminTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [runningPlaza, setRunningPlaza] = useState(false);
  const [plazaResult, setPlazaResult] = useState<string | null>(null);
  const [runningPerf, setRunningPerf] = useState(false);
  const [perfResult, setPerfResult] = useState<string | null>(null);
  const [runningRecalc, setRunningRecalc] = useState<'dry' | 'real' | null>(null);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const [recalcChanges, setRecalcChanges] = useState<PerformanceRecalcChange[]>([]);
  const [simulated, setSimulated] = useState(false);

  const handleRecalc = async (dryRun: boolean) => {
    setRunningRecalc(dryRun ? 'dry' : 'real');
    setRecalcResult(null);
    setRecalcChanges([]);
    try {
      const res = await recalculatePerformanceStatuses({ dryRun });
      setRecalcResult(res.data.message);
      setRecalcChanges(res.data.cambios);
      // Applying is only unlocked by a simulation, so nobody moves candidates
      // in bulk without having seen the list first.
      setSimulated(dryRun);
    } catch (err) {
      setRecalcResult(err instanceof Error ? err.message : 'Error desconocido');
      setSimulated(false);
    } finally {
      setRunningRecalc(null);
    }
  };

  const handleRunPerformance = async () => {
    setRunningPerf(true);
    setPerfResult(null);
    try {
      const res = await runPerformanceChecksNow({});
      setPerfResult(res.data.message);
    } catch (err) {
      setPerfResult(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunningPerf(false);
    }
  };

  const handlePlazaBackfill = async () => {
    setRunningPlaza(true);
    setPlazaResult(null);
    try {
      const res = await backfillCandidatePlaza({});
      setPlazaResult(res.data.message);
    } catch (err) {
      setPlazaResult(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunningPlaza(false);
    }
  };

  const handleBackfill = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await backfillCandidateDocuments({});
      setResult(res.data.message);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-sm font-semibold text-gray-800">Mantenimiento</h3>
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Completar documentos faltantes</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Agrega los tipos de documento que falten en candidatos existentes sin sobreescribir los actuales.
          </p>
        </div>
        <button
          onClick={handleBackfill}
          disabled={running}
          className="flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors disabled:opacity-60"
        >
          {running ? 'Procesando...' : 'Ejecutar backfill'}
        </button>
        {result && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{result}</p>
        )}
      </div>
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Completar plaza y ciudad</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Trae de Viterbit la plaza (external_id de la vacante) y la ciudad de su dirección
            para los candidatos que aún no las tienen. Alimenta el Dashboard de operación.
          </p>
        </div>
        <button
          onClick={handlePlazaBackfill}
          disabled={runningPlaza}
          className="flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors disabled:opacity-60"
        >
          {runningPlaza ? 'Procesando...' : 'Ejecutar backfill'}
        </button>
        {plazaResult && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{plazaResult}</p>
        )}
      </div>
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Evaluar desempeño ahora</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Para promotores que nunca fueron evaluados: programa sus cortes de 15 y 30 días si
            faltan, completa la fecha de ingreso, cuenta sus solicitudes en HubSpot y aplica el
            resultado en el momento — Promotor Exitoso en Viterbit o Bajo Desempeño — sin esperar
            al corte diario de las 09:00. Usa el mismo proceso que ese corte, así que no re-evalúa
            a nadie que ya tenga veredicto.
          </p>
        </div>
        <button
          onClick={handleRunPerformance}
          disabled={runningPerf}
          className="flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors disabled:opacity-60"
        >
          {runningPerf ? 'Evaluando...' : 'Evaluar ahora'}
        </button>
        {perfResult && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{perfResult}</p>
        )}
      </div>
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Recalcular desempeño a 30 días</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Solo para quienes ya tienen veredicto: corrige el pasado, no pone al día.
            Vuelve a contar los deals de cada candidato ya evaluado en su ventana real
            (fecha de ingreso + 30 días) y actualiza su etapa: Promotor Exitoso o Bajo Desempeño.
            No modifica a quienes ya están en Promotor Exitoso ni a los descalificados.
            Simula primero: la ventana correcta solo puede bajar un conteo, así que el
            recálculo tiende a mover gente hacia Bajo Desempeño.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRecalc(true)}
            disabled={runningRecalc !== null}
            className="flex items-center gap-2 bg-white text-gray-700 border border-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            {runningRecalc === 'dry' ? 'Simulando...' : 'Simular'}
          </button>
          <button
            onClick={() => handleRecalc(false)}
            disabled={runningRecalc !== null || !simulated}
            title={simulated ? undefined : 'Corre la simulación primero'}
            className="flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 transition-colors disabled:opacity-60"
          >
            {runningRecalc === 'real' ? 'Aplicando...' : 'Aplicar cambios'}
          </button>
        </div>
        {recalcResult && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{recalcResult}</p>
        )}
        {recalcChanges.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Candidato</th>
                    <th className="px-3 py-2 font-medium">Etapa</th>
                    <th className="px-3 py-2 font-medium text-right">Deals</th>
                    <th className="px-3 py-2 font-medium text-right">Meta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recalcChanges.map((ch) => (
                    <tr key={ch.candidateId} className="text-gray-700">
                      <td className="px-3 py-2">
                        <p className="font-medium">{ch.nombre || ch.candidateId}</p>
                        <p className="text-gray-400">{ch.perfil}</p>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-gray-400">{stageLabel(ch.statusAnterior)}</span>
                        <span className="mx-1 text-gray-300">→</span>
                        <span
                          className={
                            ch.statusNuevo === 'promotor_exitoso' ? 'text-green-600' : 'text-red-600'
                          }
                        >
                          {stageLabel(ch.statusNuevo)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        <span className="text-gray-400">{ch.dealsAntes ?? '—'}</span>
                        <span className="mx-1 text-gray-300">→</span>
                        <span className="font-medium">{ch.dealsDespues}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{ch.meta}</td>
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

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('gmail');
  const {
    reminderSettings,
    linkDuration,
    loading,
    saving,
    savedKey,
    saveReminders,
    saveLinkDuration,
  } = useSettings();

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={18} className="text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Configuración</h2>
          </div>
          <div className="flex gap-1 flex-wrap">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:block">{label}</span>
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
            <>
              {activeTab === 'gmail' && <GmailConnectionTab />}
              {activeTab === 'reminders' && (
                <RemindersTab
                  settings={reminderSettings}
                  saving={saving}
                  saved={savedKey === 'reminders'}
                  onSave={saveReminders}
                />
              )}
              {activeTab === 'links' && (
                <LinkDurationTab
                  settings={linkDuration}
                  saving={saving}
                  saved={savedKey === 'links'}
                  onSave={saveLinkDuration}
                />
              )}
              {activeTab === 'questions' && <QuestionsTab />}
              {activeTab === 'branding' && <BrandingTab />}
              {activeTab === 'admin' && <AdminTab />}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
