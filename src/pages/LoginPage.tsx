import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { signInWithGoogle, authError } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    signInWithGoogle();
    // Note: page will redirect to Google — loading state persists until redirect
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#F0F5FA' }}>
      <div className="card p-8 max-w-sm w-full text-center">
        {/* Logo */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ backgroundColor: '#16b877', boxShadow: '0 10px 25px rgba(22,184,119,0.3)' }}
        >
          <span className="text-white text-2xl font-bold">A</span>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-1">Aviva Recruiting</h1>
        <p className="text-sm text-gray-500 mb-8">
          Portal exclusivo para el equipo de reclutamiento
        </p>

        {/* Error from Firebase (shown after redirect returns with an error) */}
        {authError && (
          <div className="mb-5 flex items-start gap-2 text-left bg-red-50 border border-red-200 rounded-xl p-3">
            <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{authError}</p>
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-3 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
          </svg>
          {loading ? 'Redirigiendo a Google...' : 'Continuar con Google'}
        </button>

        <p className="mt-6 text-xs text-gray-400">
          Acceso restringido al equipo de Aviva
        </p>
      </div>
    </div>
  );
}
