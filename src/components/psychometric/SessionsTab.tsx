import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Copy,
  Check,
  Search,
  X,
  RefreshCw,
  ShieldAlert,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Modal } from '../ui/Modal';
import { ResultView } from './ResultView';
import type {
  PsychometricSession,
  PsychometricSessionStatus,
  PsychometricValidityVerdict,
} from '../../types';
import { createPsychometricSession, getAllPsychometricSessions } from '../../services/psychometricSessions';
import { adaptPsychometricResult } from '../../lib/psychometricResult';

// Distinct colors per status (not the shared badge-* classes, which reuse the
// same green for "review" and "valid" — that read as a false semáforo here).
const STATUS_LABELS: Record<PsychometricSessionStatus, { label: string; className: string }> = {
  pending: { label: 'Pendiente de iniciar', className: 'bg-yellow-100 text-yellow-800' },
  in_progress: { label: 'En progreso', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Completada', className: 'bg-gray-100 text-gray-700' },
  expired: { label: 'Expirada', className: 'bg-red-100 text-red-700' },
};

/**
 * A completed session is not automatically a usable result: the verdict is what
 * the recruiter actually needs to see in the list. Before this, an unreliable
 * result showed a green "Completada" and you only found out by opening it.
 */
const VERDICT_META: Record<
  PsychometricValidityVerdict,
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  confiable: { label: 'Confiable', className: 'bg-green-100 text-green-800', icon: ShieldCheck },
  revisar: { label: 'Revisar', className: 'bg-amber-100 text-amber-800', icon: AlertTriangle },
  no_confiable: { label: 'No confiable', className: 'bg-red-100 text-red-700', icon: ShieldAlert },
};

const BAND_TEXT: Record<string, string> = {
  bajo: 'text-red-600',
  medio: 'text-amber-600',
  alto: 'text-green-600',
};

type StatusFilter = 'todas' | PsychometricSessionStatus;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'completed', label: 'Completadas' },
  { key: 'expired', label: 'Expiradas' },
];

const PAGE_SIZE = 25;

function testUrl(token: string): string {
  return `${window.location.origin}/prueba-psicometrica/${token}`;
}

function formatDate(timestamp: { toDate?: () => Date } | undefined): string | null {
  const date = timestamp?.toDate?.();
  if (!date) return null;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function SessionsTab() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<PsychometricSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PsychometricSession | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('todas');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [regenerating, setRegenerating] = useState<string | null>(null);

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
    setCreateError(null);
    try {
      await createPsychometricSession({ candidateName: name.trim(), candidateEmail: email.trim() }, user.uid);
      setName('');
      setEmail('');
      setShowCreate(false);
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo crear la sesión.');
    } finally {
      setCreating(false);
    }
  };

  /** An expired or finished session was a dead end; this issues a fresh link. */
  const regenerate = async (session: PsychometricSession) => {
    if (!user) return;
    setRegenerating(session.id);
    try {
      await createPsychometricSession(
        { candidateName: session.candidateName, candidateEmail: session.candidateEmail },
        user.uid
      );
      refresh();
    } finally {
      setRegenerating(null);
    }
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(testUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      todas: sessions.length,
      pending: 0,
      in_progress: 0,
      completed: 0,
      expired: 0,
    };
    for (const session of sessions) base[session.status] += 1;
    return base;
  }, [sessions]);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    return sessions.filter((session) => {
      if (filter !== 'todas' && session.status !== filter) return false;
      if (!term) return true;
      return (
        normalize(session.candidateName).includes(term) || normalize(session.candidateEmail).includes(term)
      );
    });
  }, [sessions, search, filter]);

  const shown = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Sesiones de prueba</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Módulo independiente — aún no ligado a candidatos del pipeline de reclutamiento.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2 shrink-0"
        >
          <Plus size={14} /> Nueva sesión
        </button>
      </div>

      {sessions.length > 0 && (
        <div className="space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Buscar por nombre o correo..."
              className="input-field text-sm w-full pl-9 pr-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setFilter(key);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === key
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {label} <span className="opacity-60">{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">
          No hay sesiones todavía. Crea una para generar un enlace de prueba.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">
          Ninguna sesión coincide con el filtro.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((session) => {
            const status = STATUS_LABELS[session.status];
            const result = adaptPsychometricResult(session.result);
            const verdict = result ? VERDICT_META[result.validity.verdict] : null;
            const VerdictIcon = verdict?.icon;
            const createdAt = formatDate(session.createdAt);
            const completedAt = formatDate(session.completedAt);
            const canOpen = session.status === 'completed' && !!result;

            return (
              <div
                key={session.id}
                onClick={canOpen ? () => setViewing(session) : undefined}
                className={`card p-4 flex items-center justify-between gap-3 ${
                  canOpen ? 'cursor-pointer hover:border-primary-300' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{session.candidateName}</p>
                  <p className="text-xs text-gray-500 truncate">{session.candidateEmail}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {completedAt ? `Completada ${completedAt}` : createdAt ? `Creada ${createdAt}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Score first: it's what the recruiter is looking for. */}
                  {result?.compositeHasData && (
                    <span className="text-right">
                      <span className={`text-base font-bold ${BAND_TEXT[result.compositeBand] ?? 'text-gray-900'}`}>
                        {result.compositeScore}
                      </span>
                      {result.compositePercentile !== undefined && (
                        <span className="block text-xs text-gray-400 leading-none">
                          pc {result.compositePercentile}
                        </span>
                      )}
                    </span>
                  )}

                  {verdict && VerdictIcon ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${verdict.className}`}
                    >
                      <VerdictIcon size={11} /> {verdict.label}
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                  )}

                  {(session.status === 'pending' || session.status === 'in_progress') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyLink(session.token);
                      }}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      {copiedToken === session.token ? <Check size={13} /> : <Copy size={13} />}
                      {copiedToken === session.token ? 'Copiado' : 'Copiar enlace'}
                    </button>
                  )}

                  {(session.status === 'expired' ||
                    (session.status === 'completed' && result?.validity.verdict === 'no_confiable')) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void regenerate(session);
                      }}
                      disabled={regenerating === session.id}
                      className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 disabled:opacity-50"
                      title="Genera una sesión nueva para el mismo candidato"
                    >
                      <RefreshCw size={12} />
                      {regenerating === session.id ? 'Generando...' : 'Nuevo enlace'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filtered.length > shown.length && (
            <button
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="w-full card p-3 text-xs text-primary-600 hover:text-primary-700"
            >
              Mostrar {Math.min(PAGE_SIZE, filtered.length - shown.length)} más ({shown.length} de{' '}
              {filtered.length})
            </button>
          )}
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
          <p className="text-xs text-gray-500">
            Se genera un enlace que tendrás que enviarle al candidato: este módulo todavía no manda el
            correo por sí solo.
          </p>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
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
