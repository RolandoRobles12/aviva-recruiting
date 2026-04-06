import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut, User, LayoutDashboard, Settings, FileText, FileSignature, FolderOpen, Mail, ClipboardList } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  children: ReactNode;
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary-50 text-primary-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
  }`;

export function DashboardLayout({ children }: Props) {
  const { profile, signOut } = useAuth();

  return (
    <div className="h-screen flex" style={{ backgroundColor: '#F0F5FA' }}>
      {/* Sidebar */}
      <aside className="w-16 lg:w-56 bg-white border-r border-gray-100 flex flex-col shrink-0 z-10">
        {/* Logo */}
        <div className="px-3 lg:px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm">
              <span className="text-white text-xs font-bold">A</span>
            </div>
            <div className="hidden lg:block overflow-hidden">
              <h1 className="text-sm font-bold text-gray-900 truncate">Aviva Recruiting</h1>
              <p className="text-xs text-gray-400 leading-none">Portal de Contratación</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 lg:px-3 space-y-5">
          {/* Main */}
          <div className="space-y-1">
            <p className="hidden lg:block px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Principal</p>
            <NavLink to="/" end className={navClass}>
              <LayoutDashboard size={18} className="shrink-0" />
              <span className="hidden lg:block">Candidatos</span>
            </NavLink>
            <NavLink to="/documents" className={navClass}>
              <FolderOpen size={18} className="shrink-0" />
              <span className="hidden lg:block">Expedientes</span>
            </NavLink>
            <NavLink to="/form-config" className={navClass}>
              <ClipboardList size={18} className="shrink-0" />
              <span className="hidden lg:block">Preguntas y documentos</span>
            </NavLink>
          </div>

          {/* Templates */}
          <div className="space-y-1">
            <p className="hidden lg:block px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Templates</p>
            <NavLink to="/offer-templates" className={navClass}>
              <FileSignature size={18} className="shrink-0" />
              <span className="hidden lg:block">Cartas Oferta</span>
            </NavLink>
            <NavLink to="/contract-templates" className={navClass}>
              <FileText size={18} className="shrink-0" />
              <span className="hidden lg:block">Contratos</span>
            </NavLink>
            <NavLink to="/email-templates" className={navClass}>
              <Mail size={18} className="shrink-0" />
              <span className="hidden lg:block">Correos</span>
            </NavLink>
          </div>

          {/* Admin */}
          <div className="space-y-1">
            <p className="hidden lg:block px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Admin</p>
            <NavLink to="/settings" className={navClass}>
              <Settings size={18} className="shrink-0" />
              <span className="hidden lg:block">Configuración</span>
            </NavLink>
          </div>
        </nav>

        {/* User */}
        <div className="px-2 lg:px-3 py-4 border-t border-gray-100">
          <div className="flex items-center gap-2 px-1">
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt="" className="w-7 h-7 rounded-full shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <User size={14} className="text-gray-500" />
              </div>
            )}
            <span className="hidden lg:block text-xs text-gray-700 flex-1 truncate">
              {profile?.displayName}
            </span>
            <button
              onClick={signOut}
              title="Cerrar sesión"
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}
