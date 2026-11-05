import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, Search, X, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLiveNotifications } from '../../hooks/useLiveNotifications';
import { notificationIcon } from '../../utils/notificationLinks';
import { soundEnabled, setSoundEnabled, playChime } from '../../utils/chime';
import { formatDateTime } from '../../utils/formatters';
import { ROLE_LABELS, PMS_LABELS } from '../../utils/permissions';
import { getRoleTheme } from '../../utils/roleTheme';

export default function Header({ onToggleSidebar, sidebarWidth = 256 }) {
  const { user } = useAuth();
  const theme = getRoleTheme(user?.role);
  const navigate = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const notifsRef = useRef(null);
  const { notifications, unread, markRead, open } = useLiveNotifications(user);

  useEffect(() => {
    const handler = (e) => {
      if (notifsRef.current && !notifsRef.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) navigate(`/admin/reservations?search=${encodeURIComponent(search.trim())}`);
  };

  const openNotification = (n) => {
    setShowNotifs(false);
    open(n);
  };

  const toggleSound = () => {
    const next = !sound;
    setSoundEnabled(next);
    setSound(next);
    if (next) playChime();
  };

  return (
    <header
      className="pms-header fixed top-0 right-0 left-0 z-30 h-16 flex items-center justify-between px-4"
      style={{ marginLeft: sidebarWidth }}
    >
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: 'var(--pms-accent)' }} />

      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-soul-muted hover:bg-black/[0.04] transition-colors flex-shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        {sidebarWidth === 0 && !showSearch && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-soul-blue tracking-tight truncate">Soul</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-soul-muted truncate">
              {PMS_LABELS[user?.role]}
            </div>
          </div>
        )}

        {sidebarWidth > 0 && (
          <div className="hidden lg:flex items-center gap-2 pl-1">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ background: 'var(--pms-accent-soft)', color: 'var(--pms-accent-text)' }}
            >
              {theme.eyebrow}
            </span>
          </div>
        )}

        <form onSubmit={handleSearch} className="flex items-center ml-1 min-w-0">
          {showSearch ? (
            <div className="flex items-center gap-2 rounded-xl border border-soul-line bg-white/80 px-3 py-1.5 shadow-sm min-w-0">
              <Search className="w-4 h-4 text-soul-muted shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search reservations..."
                className="w-28 min-w-0 bg-transparent text-base sm:w-48 sm:text-sm outline-none placeholder:text-soul-muted/60 text-soul-blue"
              />
              <button type="button" onClick={() => { setShowSearch(false); setSearch(''); }}>
                <X className="w-4 h-4 text-soul-muted hover:text-soul-blue" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="p-2 rounded-xl text-soul-muted hover:bg-black/[0.04] transition-colors flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              <span className="text-sm text-soul-muted/70 hidden md:block">Search...</span>
            </button>
          )}
        </form>
      </div>

      <div className="flex items-center gap-2" ref={notifsRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifs((v) => !v)}
            className="p-2 rounded-xl text-soul-muted hover:bg-black/[0.04] transition-colors relative"
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-5 h-5 text-white text-xs rounded-full flex items-center justify-center font-bold shadow"
                style={{ background: 'var(--pms-accent)' }}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-soul-line overflow-hidden animate-slide-in">
              <div className="flex items-center justify-between px-4 py-3 border-b border-soul-line bg-[var(--pms-header-tint)]">
                <span className="font-semibold text-soul-blue text-sm">Notifications</span>
                <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSound}
                  className="rounded-lg p-1 text-soul-muted hover:text-soul-blue"
                  title={sound ? 'Sound on: click to mute' : 'Sound off: click to turn on'}
                  aria-label={sound ? 'Mute notification sound' : 'Turn on notification sound'}
                >
                  {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => markRead.mutate('all')}
                    className="text-xs font-medium hover:opacity-80"
                    style={{ color: 'var(--pms-accent-text)' }}
                  >
                    Mark all read
                  </button>
                )}
                </div>
              </div>
              <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-soul-muted text-sm">No notifications</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className={`px-4 py-3 border-b border-soul-line/60 cursor-pointer hover:bg-[var(--pms-accent-soft)] transition-colors ${
                        !n.is_read ? 'bg-[var(--pms-header-tint)]' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg leading-none mt-0.5">
                          {notificationIcon(n)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-soul-blue">{n.title}</div>
                          <div className="text-xs text-soul-muted mt-0.5 line-clamp-2">{n.message}</div>
                          <div className="text-xs text-soul-muted/70 mt-1">{formatDateTime(n.created_at)}</div>
                        </div>
                        {!n.is_read && (
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                            style={{ background: 'var(--pms-accent)' }}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 pl-3 border-l border-soul-line">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
            style={{ background: 'var(--pms-avatar)' }}
          >
            {user?.full_name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="hidden md:block min-w-0">
            <div className="text-sm font-medium text-soul-blue leading-tight truncate max-w-[140px]">
              {user?.full_name}
            </div>
            <div className="text-[11px] text-soul-muted leading-tight">
              {ROLE_LABELS[user?.role] || user?.role}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
