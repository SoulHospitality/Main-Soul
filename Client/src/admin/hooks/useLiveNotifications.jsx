import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import api from '../api/axios';
import { notificationHref, notificationIcon } from '../utils/notificationLinks';
import { playChime, unlockChime } from '../utils/chime';

/** Queries that hold request lists and counts; refreshed whenever a request changes anywhere. */
export const REQUEST_QUERY_KEYS = [
  ['hr-requests-counts'],
  ['hr-leave-requests'],
  ['hr-wfh'],
  ['hr-loans'],
  ['hr-my-schedule'],
  ['hr-my-leave'],
  ['hr-requests-history'],
  ['requests-board'],
];

export function invalidateRequestQueries(qc) {
  REQUEST_QUERY_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
}

function NotificationToast({ t, n, onOpen }) {
  return (
    <div
      className={`pointer-events-auto flex w-[22rem] max-w-[calc(100vw-24px)] items-start gap-3 rounded-2xl border border-soul-line bg-white p-3 shadow-xl transition-all ${
        t.visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      }`}
    >
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen}>
        <span className="mt-0.5 text-lg leading-none">{notificationIcon(n)}</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-soul-blue">{n.title}</span>
          <span className="mt-0.5 block text-xs text-soul-muted line-clamp-2">{n.message}</span>
          <span className="mt-1 block text-[11px] font-medium" style={{ color: 'var(--pms-accent-text, #283f5e)' }}>
            Open
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded-lg p-1 text-soul-muted hover:bg-black/[0.04] hover:text-soul-blue"
        onClick={() => toast.dismiss(t.id)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The bell's data plus live delivery: a socket pushes new notifications, and anything newer than
 * what was already on screen pops up with a soft chime. Polling keeps it working if the socket drops.
 */
export function useLiveNotifications(user) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const lastSeenId = useRef(null);

  const notifQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications?limit=20').then((r) => r.data),
    refetchInterval: 30000,
    enabled: !!user?.id,
  });

  const markRead = useMutation({
    mutationFn: (id) => (id === 'all' ? api.put('/notifications/read-all') : api.put(`/notifications/${id}/read`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['hr-requests-counts'] });
    },
  });

  const open = (n) => {
    if (!n.is_read) markRead.mutate(n.id);
    navigate(notificationHref(n));
  };
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    unlockChime();
  }, []);

  // New notifications since the last look pop up (at most three, newest last) with one chime.
  useEffect(() => {
    const list = notifQuery.data?.notifications;
    if (!Array.isArray(list)) return;
    const maxId = list.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
    if (lastSeenId.current == null) {
      lastSeenId.current = maxId;
      return;
    }
    const fresh = list
      .filter((n) => Number(n.id) > lastSeenId.current && !n.is_read)
      .sort((a, b) => Number(a.id) - Number(b.id));
    lastSeenId.current = Math.max(lastSeenId.current, maxId);
    if (!fresh.length) return;
    playChime();
    fresh.slice(-3).forEach((n) => {
      toast.custom(
        (t) => (
          <NotificationToast
            t={t}
            n={n}
            onOpen={() => {
              toast.dismiss(t.id);
              openRef.current(n);
            }}
          />
        ),
        { id: `notif-${n.id}`, duration: 7000, position: 'top-right' }
      );
    });
  }, [notifQuery.data]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const base = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(base, {
      auth: { token: localStorage.getItem('pms_token') || '' },
      transports: ['websocket', 'polling'],
    });
    const onNotification = () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-unassigned'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-history'] });
    };
    const onRequests = () => invalidateRequestQueries(qc);
    socket.on('pms:notification', onNotification);
    socket.on('pms:requests', onRequests);
    // After a reconnect, catch up on anything missed while offline.
    socket.on('connect', () => {
      onNotification();
      onRequests();
    });
    return () => {
      socket.off('pms:notification', onNotification);
      socket.off('pms:requests', onRequests);
      socket.disconnect();
    };
  }, [user?.id, qc]);

  return {
    notifications: notifQuery.data?.notifications || [],
    unread: notifQuery.data?.unreadCount || 0,
    markRead,
    open,
  };
}
