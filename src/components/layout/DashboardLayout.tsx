import { type ReactNode } from 'react';
import { LogOut, User } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  children: ReactNode;
}

export function DashboardLayout({ children }: Props) {
  const { profile, signOut } = useAuth();

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: '#F0F5FA' }}>
      {/* Top Bar */}
      <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900">Aviva Recruiting</h1>
            <p className="text-xs text-gray-400 leading-none">Portal de Reclutamiento</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt="" className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center">
                <User size={14} className="text-gray-500" />
              </div>
            )}
            <span className="text-sm text-gray-700 hidden sm:block">{profile?.displayName}</span>
          </div>
          <button
            onClick={signOut}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
