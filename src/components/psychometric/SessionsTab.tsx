import { useEffect, useState } from 'react';
import { Plus, Copy, Check, ClipboardList } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Modal } from '../ui/Modal';
import { ResultView } from './ResultView';
import type { PsychometricSession, PsychometricSessionStatus } from '../../types';
import { createPsychometricSession, getAllPsychometricSessions } from '../../services/psychometricSessions';

// Distinct colors per status (not the shared badge-* classes, which reuse the
// same green for "review" and "valid" — that read as a false semáforo here).
const STATUS_LABELS: Record<PsychometricSessionStatus, { label: string; className: string }> = {
  pending: { label: 'Pendiente de iniciar', className: 'bg-yellow-100 text-yellow-800' },
  in_progress: { label: 'En progreso', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Completada', className: 'bg-green-100 text-green-800' },
  expired: { label: 'Expirada', className: 'bg-red-100 text-red-700' },
};

function testUrl(token: string): string {
  return `${window.location.origin}/prueba-psicometrica/${token}`;
}

export function SessionsTab() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<PsychometricSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PsychometricSession | null>(null);

  const refresh = () => {
    setLoading(true);
    getAllPsychometricSessions()
      .then(setSessions)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const handleCreate = async () => {
    if (!user || !name.trim() || !email.trim()) return;
    setCreating(true);
    try {
      await createPsychometricSession({ candidateName: name.trim(), candidateEmail: email.trim() }, user.uid);
      setName('');
      setEmail('');
      setShowCreate(false);
      refresh();
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(testUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Sesiones de prueba</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Módulo independiente — aún no ligado a candidatos del pipeline de reclutamiento.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2">
          <Plus size={14} /> Nueva sesión
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">
          No hay sesiones todavía. Crea una para generar un enlace de prueba.
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const status = STATUS_LABELS[s.status];
            return (
              <div key={s.id} className="card p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{s.candidateName}</p>
                  <p className="text-xs text-gray-500 truncate">{s.candidateEmail}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                    {status.label}
                  </span>
                  {s.status === 'completed' && s.result && (
                    <button
                      onClick={() => setViewing(s)}
                      className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                    >
                      <ClipboardList size={13} /> Ver resultado
                    </button>
                  )}
                  {(s.status === 'pending' || s.status === 'in_progress') && (
                    <button
                      onClick={() => copyLink(s.token)}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      {copiedToken === s.token ? <Check size={13} /> : <Copy size={13} />}
                      {copiedToken === s.token ? 'Copiado' : 'Copiar enlace'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nueva sesión de prueba" size="sm">
        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre completo"
            className="input-field text-sm w-full"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo"
            className="input-field text-sm w-full"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim() || !email.trim()}
            className="btn-primary w-full text-sm py-2 disabled:opacity-40"
          >
            {creating ? 'Creando...' : 'Generar enlace'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!viewing} onClose={() => setViewing(null)} title="Resultado de la prueba" size="md">
        {viewing?.result && <ResultView session={viewing} />}
      </Modal>
    </div>
  );
}
