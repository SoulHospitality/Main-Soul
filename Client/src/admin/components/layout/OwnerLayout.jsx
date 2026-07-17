import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Building, LogOut, UserCircle } from 'lucide-react';

export default function OwnerLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/sign-in'); };

  return (
    <div className="pms-shell min-h-screen bg-gray-50">
      {/* Minimal top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-gradient-to-r from-primary-900 to-primary-800 flex items-center justify-between px-6 shadow-lg">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
            <Building className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-base leading-tight">Soul Hospitality</div>
            <div className="text-blue-200 text-xs">Owner Portal</div>
          </div>
        </div>

        {/* User info + logout */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold">
              {user?.full_name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="hidden sm:block text-right">
              <div className="text-white text-sm font-medium leading-tight">{user?.full_name}</div>
              <div className="text-blue-200 text-xs">Owner</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-300 hover:text-white hover:bg-red-500/30 rounded-lg px-3 py-2 text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Page content — full width, no sidebar */}
      <main className="pt-16 min-h-screen">
        <div className="max-w-5xl mx-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
