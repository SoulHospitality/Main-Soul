import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { inboxApi } from './api';

const InboxContext = createContext(null);

const PRESENCE_KEY = 'inbox_presence';
const HEARTBEAT_MS = 30000;

let audioCtx;
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  } catch {
    /* audio unavailable */
  }
}

/**
 * Inbox session for the whole PMS: one socket, presence heartbeat and live events, so an agent
 * keeps receiving chats (and the sidebar badge stays fresh) while working on other pages.
 */
export function InboxProvider({ children }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listeners = useRef(new Set());
  const viewingRef = useRef(null);
  const socketRef = useRef(null);
  const [viewers, setViewers] = useState({});
  const [connected, setConnected] = useState(false);

  const { data: me, refetch } = useQuery({
    queryKey: ['inbox-me'],
    queryFn: () => inboxApi.get('/me'),
    enabled: Boolean(user?.id) && !user?.is_first_login,
    refetchInterval: 60000,
    staleTime: 15000,
    retry: false,
  });
  const access = Boolean(me?.access);

  const refetchSoon = useRef(null);
  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchSoon.current);
    refetchSoon.current = setTimeout(() => refetch(), 1200);
  }, [refetch]);

  const sendHeartbeat = useCallback(() => {
    socketRef.current?.emit('inbox:heartbeat', { viewing: viewingRef.current });
  }, []);

  const setViewing = useCallback((id) => {
    const next = id ? Number(id) : null;
    if (viewingRef.current === next) return;
    viewingRef.current = next;
    sendHeartbeat();
  }, [sendHeartbeat]);

  const setPresence = useCallback(async (presence, { remember = true } = {}) => {
    await inboxApi.post('/me/presence', { presence });
    if (remember) {
      try { localStorage.setItem(PRESENCE_KEY, presence); } catch { /* storage unavailable */ }
    }
    qc.setQueryData(['inbox-me'], (old) => (old?.user ? { ...old, user: { ...old.user, presence } } : old));
  }, [qc]);

  // Restore the agent's chosen presence after a timeout or a fresh login (default: online).
  const restoredFor = useRef(null);
  useEffect(() => {
    if (!access || !me?.user || restoredFor.current === me.user.id) return;
    restoredFor.current = me.user.id;
    let wanted = 'online';
    try { wanted = localStorage.getItem(PRESENCE_KEY) || 'online'; } catch { /* storage unavailable */ }
    if (me.user.presence !== wanted) setPresence(wanted, { remember: false }).catch(() => {});
  }, [access, me?.user, setPresence]);

  useEffect(() => {
    if (!access || !user?.id) return undefined;
    const socket = io(import.meta.env.VITE_API_URL || window.location.origin, {
      auth: { token: localStorage.getItem('pms_token') || '' },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    const join = () => {
      socket.emit('inbox:join', (res) => {
        setConnected(Boolean(res?.ok));
        if (res?.viewers) setViewers(res.viewers);
        sendHeartbeat();
      });
    };
    const onEvent = ({ type, data } = {}) => {
      if (type === 'viewers') setViewers(data || {});
      if (type === 'presence' || type === 'users' || type === 'settings' || type === 'conversation' || type === 'message') {
        scheduleRefetch();
      }
      if (type === 'notification') {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        const critical = /breach|escalat|overdue/.test(data?.kind || '');
        toast(`${data?.title || 'Inbox'}${data?.body ? ` — ${String(data.body).slice(0, 120)}` : ''}`, {
          icon: critical ? '⛔' : '💬',
          duration: critical ? 8000 : 5000,
        });
        beep();
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(data?.title || 'Inbox', { body: data?.body || '', tag: `inbox-${data?.conversation_id || ''}` });
          n.onclick = () => {
            window.focus();
            if (data?.conversation_id) window.location.assign(`/admin/inbox?c=${data.conversation_id}`);
          };
        }
      }
      listeners.current.forEach((fn) => {
        try { fn(type, data); } catch { /* listener errors must not break the stream */ }
      });
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setConnected(false));
    socket.on('inbox:event', onEvent);
    const beat = setInterval(sendHeartbeat, HEARTBEAT_MS);
    const onVisible = () => { if (!document.hidden) sendHeartbeat(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
      socket.emit('inbox:leave');
      socket.off('inbox:event', onEvent);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [access, user?.id, qc, scheduleRefetch, sendHeartbeat]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const value = useMemo(() => {
    const perms = new Set(me?.permissions || []);
    const usersById = new Map((me?.users || []).map((u) => [u.id, u]));
    return {
      me,
      access,
      connected,
      viewers,
      can: (p) => perms.has(p),
      userName: (id) => usersById.get(Number(id))?.name || (id ? `#${id}` : '—'),
      stageByKey: (key) => (me?.stages || []).find((s) => s.key === key) || null,
      refresh: refetch,
      setViewing,
      setPresence,
      subscribe,
    };
  }, [me, access, connected, viewers, refetch, setViewing, setPresence, subscribe]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox() {
  return useContext(InboxContext) || {
    me: null, access: false, connected: false, viewers: {}, can: () => false, userName: () => '—',
    stageByKey: () => null, refresh: () => {}, setViewing: () => {}, setPresence: async () => {}, subscribe: () => () => {},
  };
}

/** Run `fn(type, data)` for every live inbox event while the component is mounted. */
export function useInboxEvents(fn) {
  const { subscribe } = useInbox();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((type, data) => ref.current(type, data)), [subscribe]);
}
