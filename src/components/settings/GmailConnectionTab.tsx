import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle, XCircle, Loader2, Unplug } from 'lucide-react';
import { functions, db } from '../../lib/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { RecruiterProfile } from '../../types';

const getGmailAuthUrl = httpsCallable<void, { authUrl: string }>(functions, 'getGmailAuthUrl');
const disconnectGmailFn = httpsCallable<void, { success: boolean }>(functions, 'disconnectGmail');

export function GmailConnectionTab() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [recruiterEmail, setRecruiterEmail] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Listen for real-time updates to the recruiter profile
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as RecruiterProfile;
        setGmailConnected(data.gmailConnected ?? false);
        setRecruiterEmail(data.email ?? '');
      }
    });
    return unsubscribe;
  }, [user]);

  // Handle OAuth callback query params
  useEffect(() => {
    const gmail = searchParams.get('gmail');
    if (gmail === 'success') {
      setStatusMessage({ type: 'success', text: 'Gmail conectado exitosamente.' });
      setSearchParams({}, { replace: true });
    } else if (gmail === 'error') {
      const reason = searchParams.get('reason') ?? 'unknown';
      const messages: Record<string, string> = {
        access_denied: 'Cancelaste la autorización de Gmail.',
        no_refresh_token: 'No se obtuvo el token de actualización. Intenta de nuevo.',
        not_recruiter: 'Tu cuenta no está registrada como reclutador.',
        token_exchange_failed: 'Error al conectar con Google. Intenta de nuevo.',
        missing_params: 'Parámetros faltantes en la respuesta de Google.',
      };
      setStatusMessage({ type: 'error', text: messages[reason] ?? `Error al conectar Gmail: ${reason}` });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleConnect = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const result = await getGmailAuthUrl();
      window.location.href = result.data.authUrl;
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Error al generar el enlace de autorización.' });
      console.error('getGmailAuthUrl error:', err);
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      await disconnectGmailFn();
      setStatusMessage({ type: 'success', text: 'Gmail desconectado.' });
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Error al desconectar Gmail.' });
      console.error('disconnectGmail error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (gmailConnected === null) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Conexión de Gmail</h3>
      <p className="text-sm text-gray-500 mb-6">
        Conecta tu cuenta de Gmail para enviar correos a candidatos directamente desde tu buzón.
      </p>

      {/* Status message */}
      {statusMessage && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg text-sm mb-4 ${
            statusMessage.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {statusMessage.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {statusMessage.text}
        </div>
      )}

      {/* Connection card */}
      <div className="border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              gmailConnected ? 'bg-green-50' : 'bg-gray-50'
            }`}
          >
            <Mail size={20} className={gmailConnected ? 'text-green-600' : 'text-gray-400'} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">
              Google Gmail
            </p>
            <p className="text-xs text-gray-500">
              {gmailConnected
                ? `Conectado como ${recruiterEmail}`
                : 'No conectado'}
            </p>
          </div>
          {gmailConnected && (
            <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
              <CheckCircle size={12} />
              Activo
            </span>
          )}
        </div>

        {gmailConnected ? (
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Unplug size={16} />
            )}
            Desconectar Gmail
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Mail size={16} />
            )}
            Conectar Gmail
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Al conectar, autorizas a Aviva Recruiting a enviar correos electrónicos en tu nombre.
        Solo se solicita el permiso de envío. Puedes desconectar en cualquier momento.
      </p>
    </div>
  );
}
