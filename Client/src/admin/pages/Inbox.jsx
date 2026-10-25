import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageSquare, Search, Filter, RefreshCw, Send, Paperclip, Sparkles,
  Bot, Clock, User, Shield, AlertTriangle, CheckCircle, Tag, Check, X,
  Plus, Smartphone, Play, Sliders, BarChart3, ChevronLeft, ChevronRight, UserPlus, Eye, Lock
} from 'lucide-react';
import { useInbox, useInboxEvents } from '../inbox/InboxContext';
import { inboxApi, errorMessage } from '../inbox/api';
import { CHANNELS, VIEWS, STATUS_LABELS, CONVERSATION_TYPES, timeAgo, fmtTime, serviceWindow, nextCairoTime } from '../inbox/utils';
import { Avatar, ChannelDot, PresenceDot, SlaChip, StageChip, Chip, useNow } from '../inbox/ui';
import Attachment from '../inbox/Attachment';
import LeadPanel from '../inbox/LeadPanel';
import Modal from '../components/ui/Modal';

export default function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, can, setPresence, setViewing, userName, connected, viewers } = useInbox();
  const now = useNow(30000);

  const activeConvId = searchParams.get('c') ? Number(searchParams.get('c')) : null;

  const [activeView, setActiveView] = useState('mine');
  const [activeChannel, setActiveChannel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [showSimulator, setShowSimulator] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(() => window.innerWidth >= 1024);
  const messagesEndRef = useRef(null);
  const composerRef = useRef(null);
  const listRefreshTimer = useRef(null);
  const threadRefreshTimer = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Set viewing conversation for presence socket
  useEffect(() => {
    setViewing(activeConvId);
    return () => setViewing(null);
  }, [activeConvId, setViewing]);

  // Fetch conversations list
  const { data: convData, isLoading: loadingConvs, refetch: refetchConvs } = useQuery({
    queryKey: ['inbox-conversations', activeView, activeChannel, searchDebounced],
    queryFn: () => inboxApi.get('/conversations', {
      view: activeView,
      channel: activeChannel || undefined,
      search: searchDebounced || undefined,
    }),
    refetchInterval: 45000,
    refetchOnWindowFocus: false,
    staleTime: 15000,
  });

  const conversations = convData?.items || [];
  const counts = convData?.counts || {};
  const viewerMap = Object.keys(viewers || {}).length ? viewers : (convData?.viewers || {});

  const othersOn = (conversationId) => {
    const ids = viewerMap?.[conversationId] || viewerMap?.[String(conversationId)] || [];
    return ids.filter((id) => Number(id) !== Number(me?.user?.id));
  };

  // Fetch active conversation detail & messages
  const { data: currentConv, refetch: refetchCurrentConv } = useQuery({
    queryKey: ['inbox-conversation', activeConvId],
    queryFn: () => inboxApi.get(`/conversations/${activeConvId}`),
    enabled: Boolean(activeConvId),
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
    staleTime: 10000,
  });

  // Fetch quick replies & templates
  const { data: quickReplies = [] } = useQuery({
    queryKey: ['inbox-quick-replies'],
    queryFn: () => inboxApi.get('/admin/quick-replies'),
    enabled: Boolean(me),
  });
  const replies = (Array.isArray(quickReplies) && quickReplies.length ? quickReplies : null) || me?.templates || [];

  // Listen for realtime events
  useInboxEvents((type, data) => {
    if (type === 'message' && data?.conversation_id === activeConvId) {
      clearTimeout(threadRefreshTimer.current);
      threadRefreshTimer.current = setTimeout(() => refetchCurrentConv(), 1500);
    }
    if (type === 'conversation' || type === 'message') {
      clearTimeout(listRefreshTimer.current);
      listRefreshTimer.current = setTimeout(() => refetchConvs(), 1500);
    }
  });

  useEffect(() => {
    if (currentConv?.messages?.length || currentConv?.notes?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [currentConv?.messages, currentConv?.notes]);

  const selectConversation = (id) => {
    setSearchParams({ c: id });
  };

  const handleSendMessage = (text, asNote) => {
    if (!text || !activeConvId) return;
    if (!asNote && Number(currentConv?.customer?.is_simulated) !== 1 && !serviceWindow(currentConv?.conversation, Date.now()).open) {
      toast.error('The 24-hour window is closed');
      return;
    }
    const tempId = `local-${Date.now()}`;
    const stamp = Date.now();
    const mine = { id: me?.user?.id, name: me?.user?.name };
    qc.setQueryData(['inbox-conversation', activeConvId], (old) => {
      if (!old) return old;
      if (asNote) {
        return { ...old, notes: [...(old.notes || []), { id: tempId, body: text, user_id: mine.id, user_name: mine.name, created_at: stamp }] };
      }
      return {
        ...old,
        messages: [...(old.messages || []), {
          id: tempId, direction: 'out', sender_type: 'agent', body: text, user_id: mine.id, user_name: mine.name,
          created_at: stamp, delivery_status: 'pending', attachments: [],
        }],
      };
    });
    const request = asNote
      ? inboxApi.post(`/conversations/${activeConvId}/notes`, { body: text })
      : inboxApi.post(`/conversations/${activeConvId}/messages`, { text });
    request.then((res) => {
      if (asNote || !res?.message) return;
      qc.setQueryData(['inbox-conversation', activeConvId], (old) => {
        if (!old) return old;
        return {
          ...old,
          messages: (old.messages || []).map((m) => (m.id === tempId
            ? { ...res.message, user_name: mine.name, attachments: res.message.attachments || [] }
            : m)),
        };
      });
    }).catch((err) => {
      qc.setQueryData(['inbox-conversation', activeConvId], (old) => {
        if (!old) return old;
        if (asNote) return { ...old, notes: (old.notes || []).filter((n) => n.id !== tempId) };
        return {
          ...old,
          messages: (old.messages || []).map((m) => (m.id === tempId
            ? { ...m, delivery_status: 'failed', error: errorMessage(err, 'Not sent') }
            : m)),
        };
      });
      toast.error(errorMessage(err, 'Failed to send message'));
    });
  };

  const handleAiSuggest = async () => {
    if (!activeConvId) return '';
    const res = await inboxApi.post(`/conversations/${activeConvId}/ai-suggest`);
    return res?.suggestion || '';
  };

  const handleUpdateStatus = async (status) => {
    if (!activeConvId) return;
    try {
      await inboxApi.post(`/conversations/${activeConvId}/status`, { status });
      toast.success(`Status updated to ${STATUS_LABELS[status] || status}`);
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleAssign = async (userId) => {
    if (!activeConvId) return;
    try {
      await inboxApi.post(`/conversations/${activeConvId}/assign`, { user_id: userId ? Number(userId) : null });
      toast.success('Added to this chat');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const claimConversation = async (id) => {
    if (!me?.user?.id) return;
    try {
      await inboxApi.post(`/conversations/${id}/assign`, { user_id: me.user.id });
      toast.success('You are on this chat');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removeAssignee = async (id, userId) => {
    try {
      await inboxApi.post(`/conversations/${id}/assign`, { user_id: userId, remove: true });
      toast.success('Removed from this chat');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const peopleOn = (conv) => {
    if (!conv) return [];
    let rows = [];
    if (Array.isArray(conv.assignees)) rows = conv.assignees;
    else if (typeof conv.assignees === 'string') {
      try { rows = JSON.parse(conv.assignees); } catch { rows = []; }
    }
    if (rows.length) return rows;
    if (conv.assigned_user_id) return [{ id: conv.assigned_user_id, name: conv.assigned_name || userName(conv.assigned_user_id) }];
    return [];
  };

  const snoozeUntilMorning = async () => {
    if (!activeConvId) return;
    try {
      await inboxApi.post(`/conversations/${activeConvId}/status`, {
        status: 'snoozed',
        snooze_until: nextCairoTime(me?.rules?.business_start || '11:00'),
      });
      toast.success('Snoozed until the team is back');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const thread = useMemo(() => {
    const messages = (currentConv?.messages || []).map((m) => ({ ...m, kind: 'message' }));
    const notes = (currentConv?.notes || []).map((n) => ({
      id: `note-${n.id}`,
      kind: 'note',
      sender_type: 'note',
      user_id: n.user_id,
      user_name: n.user_name,
      body: n.body,
      created_at: n.created_at,
    }));
    return [...messages, ...notes].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  }, [currentConv]);

  const activeConversation = currentConv?.conversation;
  const windowInfo = serviceWindow(activeConversation, now);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || showSimulator) return;
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
      if (typing) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const down = e.key === 'j';
        const idx = conversations.findIndex((c) => c.id === activeConvId);
        const next = down
          ? conversations[idx < 0 ? 0 : Math.min(conversations.length - 1, idx + 1)]
          : conversations[idx <= 0 ? 0 : idx - 1];
        if (next) selectConversation(next.id);
      } else if (e.key === 'n' && activeConvId) {
        composerRef.current?.toggleNote();
      } else if (e.key === '/' && activeConvId) {
        e.preventDefault();
        composerRef.current?.openReplies();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conversations, activeConvId, showSimulator]);

  return (
    <div className="flex flex-col overflow-hidden bg-slate-50 font-sans max-lg:h-[calc(100dvh-11.5rem)] lg:h-[calc(100dvh-8rem)]">
      {/* Top Header Toolbar */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-3 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm z-10 sm:px-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-soul-blue text-white flex items-center justify-center font-bold shadow">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Unified Live Inbox</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium text-[11px] ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {connected ? 'Realtime Connected' : 'Connecting…'}
              </span>
              <span>·</span>
              <span>Needs reply: <strong className="text-slate-800">{counts.needs_reply || 0}</strong></span>
              <span>·</span>
              <span>Overdue: <strong className="text-rose-600">{counts.overdue || 0}</strong></span>
            </div>
          </div>
        </div>

        {/* Presence Selector & Action Bar */}
        <div className="flex items-center gap-3">
          {/* Agent Presence Pill */}
          <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200 text-xs">
            <span className="px-2 font-medium text-slate-500">My Status:</span>
            {['online', 'away', 'offline'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPresence(p)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all capitalize font-medium ${
                  me?.user?.presence === p
                    ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PresenceDot presence={p} />
                {p}
              </button>
            ))}
          </div>

          {me?.simulator && (
          <button
            type="button"
            onClick={() => setShowSimulator(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium text-xs border border-indigo-200 transition-colors"
          >
            <Smartphone className="w-4 h-4" />
            Simulate Message
          </button>
          )}

          {can('analytics.team') && (
            <Link
              to="/admin/inbox-analytics"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium text-xs border border-slate-200 transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              Analytics
            </Link>
          )}

          {can('settings.manage') && (
            <Link
              to="/admin/inbox-settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium text-xs border border-slate-200 transition-colors"
            >
              <Sliders className="w-4 h-4" />
              Settings
            </Link>
          )}
        </div>
      </div>

      {/* Main 3-Column Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Conversations List */}
        <div className={`${activeConvId ? 'hidden lg:flex' : 'flex'} w-full lg:w-96 border-r border-slate-200 bg-white flex-col flex-shrink-0 min-h-0`}>
          {/* Filters & Search */}
          <div className="p-3 border-b border-slate-200 space-y-2 bg-slate-50/50">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats, phone, name…"
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-soul-blue/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* View Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs no-scrollbar">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setActiveView(v.key)}
                  className={`px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors ${
                    activeView === v.key
                      ? 'bg-soul-blue text-white shadow-sm'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {v.label}
                  {counts[v.key] !== undefined && (
                    <span className={`ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full ${
                      activeView === v.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {counts[v.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Channel Filter Chips */}
            <div className="flex items-center gap-1.5 pt-1 text-[11px]">
              <span className="text-slate-400 font-medium">Channel:</span>
              <button
                type="button"
                onClick={() => setActiveChannel('')}
                className={`px-2 py-0.5 rounded ${!activeChannel ? 'font-bold text-soul-blue bg-blue-50' : 'text-slate-500 hover:text-slate-800'}`}
              >
                All
              </button>
              {Object.entries(CHANNELS).map(([k, c]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveChannel(k === activeChannel ? '' : k)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                    activeChannel === k ? `${c.soft} font-bold border border-current` : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <ChannelDot kind={k} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversations Items Stream */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loadingConvs ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading conversations…</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No conversations found in this view.
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === activeConvId;
                const waiting = conv.status === 'needs_reply';
                const overdue = waiting && conv.sla_due_at && Number(conv.sla_due_at) <= now && !(conv.sla_start_at && now < Number(conv.sla_start_at));
                const rowWindow = serviceWindow(conv, now);
                const watching = othersOn(conv.id);
                return (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`p-3 cursor-pointer transition-all hover:bg-slate-50 relative border-l-4 ${
                      isActive
                        ? 'bg-blue-50/70 border-l-soul-blue'
                        : overdue
                        ? 'bg-rose-50/70 border-l-rose-500'
                        : waiting || conv.unread_count > 0
                        ? 'bg-amber-50/40 border-l-amber-500'
                        : 'border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={conv.customer_name} url={conv.avatar_url} kind={conv.channel_kind} size="md" />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <h3 className="text-xs font-bold text-slate-900 truncate">
                            {conv.customer_name || 'Guest User'}
                          </h3>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">
                            {timeAgo(conv.last_message_at, now)}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {conv.last_message_preview || 'No messages yet'}
                        </p>

                        <div className="flex items-center justify-between gap-1 mt-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            {conv.stage_key ? (
                              <StageChip stageKey={conv.stage_key} />
                            ) : (
                              <Chip className="bg-slate-100 text-slate-600">{CONVERSATION_TYPES[conv.type] || conv.type}</Chip>
                            )}
                            {conv.temperature === 'hot' ? <Chip className="bg-rose-100 text-rose-700">Hot</Chip> : null}
                            <SlaChip conversation={conv} now={now} />
                            {rowWindow.urgent ? <Chip className={`border ${rowWindow.cls}`}>{rowWindow.text}</Chip> : null}
                            <Chip className={peopleOn(conv).length ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-700'}>
                              {peopleOn(conv).length
                                ? peopleOn(conv).map((p) => (Number(p.id) === Number(me?.user?.id) ? 'You' : p.name)).join(', ')
                                : 'Unassigned'}
                            </Chip>
                            {watching.length > 0 ? (
                              <Chip className="bg-amber-50 text-amber-800" title="Someone else has this chat open">
                                {watching.map((id) => userName(id)).join(', ')}
                              </Chip>
                            ) : null}
                          </div>

                          {conv.unread_count > 0 && (
                            <span className="w-5 h-5 rounded-full bg-soul-blue text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Middle Column: Active Conversation Feed */}
        <div className={`${activeConvId ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col bg-slate-100 overflow-hidden`}>
          {activeConvId && currentConv?.conversation ? (
            <>
              {/* Conversation Header Bar */}
              <div className="bg-white border-b border-slate-200 px-3 py-2.5 flex items-center justify-between gap-2 flex-shrink-0 shadow-sm sm:px-4">
                <div className="flex items-center gap-2 min-w-0 sm:gap-3">
                  <button
                    type="button"
                    className="lg:hidden grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100"
                    aria-label="Back to conversations"
                    onClick={() => setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.delete('c');
                      return next;
                    })}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <Avatar
                    name={currentConv.conversation.customer_name}
                    url={currentConv.conversation.avatar_url}
                    kind={currentConv.conversation.channel_kind}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900 truncate">
                        {currentConv.conversation.customer_name || 'Guest User'}
                      </h2>
                      <ChannelDot kind={currentConv.conversation.channel_kind} />
                      <span className="text-xs text-slate-400 capitalize font-mono">
                        {currentConv.conversation.phone || currentConv.conversation.email || `#${currentConv.conversation.id}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                      <span>On this chat: <strong>{peopleOn(currentConv.conversation).map((p) => p.name).join(', ') || 'nobody yet'}</strong></span>
                      <SlaChip conversation={currentConv.conversation} now={now} />
                      <Chip className={`border ${windowInfo.cls}`}>{windowInfo.text}</Chip>
                    </div>
                  </div>
                </div>

                {/* Status & Assignment Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!peopleOn(currentConv.conversation).some((p) => Number(p.id) === Number(me?.user?.id)) && (
                    <button
                      type="button"
                      onClick={() => claimConversation(currentConv.conversation.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-soul-blue text-white text-xs font-bold"
                    >
                      {peopleOn(currentConv.conversation).length ? 'Join chat' : 'Take chat'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={snoozeUntilMorning}
                    className="px-2.5 py-1.5 rounded-lg bg-white text-slate-700 text-xs font-medium border border-slate-200"
                    title="Bring this chat back at 11:00 Cairo time"
                  >
                    Snooze till 11
                  </button>
                  {/* Status Dropdown */}
                  <select
                    value={currentConv.conversation.status}
                    onChange={(e) => handleUpdateStatus(e.target.value)}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 focus:outline-none"
                  >
                    {Object.entries(STATUS_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1 max-w-[16rem] flex-wrap justify-end">
                    {peopleOn(currentConv.conversation).map((p) => (
                      <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
                        {Number(p.id) === Number(me?.user?.id) ? 'You' : p.name}
                        {(can('conv.assign') || Number(p.id) === Number(me?.user?.id)) && (
                          <button
                            type="button"
                            className="text-slate-400 hover:text-rose-600"
                            aria-label={`Remove ${p.name}`}
                            onClick={() => removeAssignee(currentConv.conversation.id, p.id)}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {can('conv.assign') && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) handleAssign(e.target.value); }}
                        className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 font-medium text-slate-700 focus:outline-none"
                      >
                        <option value="">Add staff</option>
                        {(me?.users || [])
                          .filter((u) => u.active !== 0 && !peopleOn(currentConv.conversation).some((p) => Number(p.id) === Number(u.id)))
                          .map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                      </select>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowRightPanel(!showRightPanel)}
                    className={`p-1.5 rounded-lg border transition-colors ${
                      showRightPanel ? 'bg-soul-blue text-white border-soul-blue' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                    title="Toggle PMS Lead Panel"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {othersOn(currentConv.conversation.id).length > 0 && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs font-medium text-amber-900">
                  {othersOn(currentConv.conversation.id).map((id) => userName(id)).join(', ')} {othersOn(currentConv.conversation.id).length === 1 ? 'is' : 'are'} also in this chat. Check before you reply.
                </div>
              )}

              {/* Chat Message History Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {thread.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-400">No messages in this chat yet.</div>
                ) : (
                  thread.map((msg) => {
                    const isNote = msg.sender_type === 'note' || msg.kind === 'note';
                    const isInbound = msg.direction === 'in';
                    const isAi = msg.sender_type === 'ai';
                    const isScript = msg.sender_type === 'auto';
                    const isExternal = msg.sender_type === 'external';

                    if (isNote) {
                      return (
                        <div key={msg.id} className="mx-auto max-w-lg bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs shadow-sm space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-bold text-amber-700">
                            <span className="flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Internal Staff Note — {msg.user_name || userName(msg.user_id)}
                            </span>
                            <span>{fmtTime(msg.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-xl rounded-2xl p-3 text-xs shadow-sm space-y-1.5 ${
                            isInbound
                              ? 'bg-white text-slate-800 rounded-tl-sm border border-slate-200'
                              : isScript
                              ? 'bg-slate-700 text-white rounded-tr-sm'
                              : isAi
                              ? 'bg-indigo-600 text-white rounded-tr-sm'
                              : 'bg-soul-blue text-white rounded-tr-sm'
                          }`}
                        >
                          <div className={`flex items-center justify-between gap-4 text-[10px] ${isInbound ? 'text-slate-400' : 'text-white/70'}`}>
                            <span className="font-semibold">
                              {isInbound
                                ? currentConv.conversation.customer_name
                                : isScript
                                ? 'After-hours script'
                                : isAi
                                ? 'AI draft'
                                : isExternal
                                ? 'Sent outside the inbox'
                                : (msg.user_name || userName(msg.user_id))}
                            </span>
                            <span>{fmtTime(msg.created_at)}</span>
                          </div>

                          <p className="whitespace-pre-wrap leading-relaxed text-xs">
                            {msg.body}
                          </p>
                          {msg.delivery_status === 'pending' && (
                            <p className={`text-[10px] ${isInbound ? 'text-slate-400' : 'text-white/70'}`}>Sending…</p>
                          )}
                          {msg.delivery_status === 'failed' && (
                            <p className={`text-[10px] font-semibold ${isInbound ? 'text-rose-600' : 'text-rose-100'}`}>Not delivered{msg.error ? `: ${msg.error}` : ''}</p>
                          )}

                          {(Array.isArray(msg.attachments) ? msg.attachments : []).map((attachment, index) => (
                            <Attachment key={`${msg.id}-${index}`} message={msg} index={index} attachment={attachment} />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <ChatComposer
                ref={composerRef}
                conversationId={activeConvId}
                customerName={currentConv.conversation.customer_name}
                windowOpen={windowInfo.open}
                simulated={Number(currentConv.customer?.is_simulated) === 1}
                replies={replies}
                aiAvailable={Boolean(me?.aiAvailable)}
                onSend={handleSendMessage}
                onSuggest={handleAiSuggest}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-200 text-slate-400 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8" />
              </div>
              <h2 className="text-base font-bold text-slate-700">Select a conversation to start chatting</h2>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Choose a customer thread from the left list to view chat history, reply, log staff notes, or manage PMS leads.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: PMS Lead Panel */}
        {showRightPanel && activeConvId && currentConv?.conversation && (
          <div className="fixed inset-0 z-40 overflow-y-auto bg-white p-4 pb-24 lg:static lg:z-auto lg:w-96 lg:flex-shrink-0 lg:border-l lg:border-slate-200 lg:pb-4">
            <button
              type="button"
              className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-soul-blue lg:hidden"
              onClick={() => setShowRightPanel(false)}
            >
              <ChevronLeft className="h-4 w-4" />
              Back to chat
            </button>
            {(() => {
              const lead = (currentConv.leads || []).find((l) => l.id === currentConv.conversation.current_lead_id) || currentConv.leads?.[0] || null;
              if (!lead) {
                return <p className="text-sm text-slate-500">This conversation has no lead yet.</p>;
              }
              return (
                <LeadPanel
                  lead={lead}
                  followUps={currentConv.followUps || []}
                  customer={currentConv.customer}
                  onChanged={() => {
                    refetchCurrentConv();
                    refetchConvs();
                  }}
                />
              );
            })()}
          </div>
        )}
      </div>

      {/* Simulator Modal for Testing */}
      {showSimulator && (
        <SimulatorModal open={showSimulator} onClose={() => setShowSimulator(false)} onSimulated={() => { refetchConvs(); if (activeConvId) refetchCurrentConv(); }} />
      )}
    </div>
  );
}

const ChatComposer = forwardRef(function ChatComposer({
  conversationId, customerName, windowOpen, simulated, replies, aiAvailable, onSend, onSuggest,
}, ref) {
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [openReplies, setOpenReplies] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const inputRef = useRef(null);
  const blocked = !note && !simulated && !windowOpen;
  const slash = body.startsWith('/') ? body.slice(1).trim().toLowerCase() : null;
  const matches = slash === null
    ? replies
    : replies.filter((qr) => `${qr.shortcut || ''} ${qr.title || ''}`.toLowerCase().includes(slash));

  useEffect(() => {
    setBody('');
    setNote(false);
    setOpenReplies(false);
  }, [conversationId]);

  useImperativeHandle(ref, () => ({
    toggleNote() {
      setNote((v) => !v);
      inputRef.current?.focus();
    },
    openReplies() {
      setNote(false);
      setOpenReplies(true);
      setBody((value) => (value.startsWith('/') ? value : '/'));
      inputRef.current?.focus();
    },
  }), []);

  const submit = (event) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || blocked) return;
    setBody('');
    setOpenReplies(false);
    onSend(text, note);
  };

  return (
    <div className={`border-t p-3 shadow-lg flex-shrink-0 ${blocked ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
      {blocked && (
        <p className="mb-2 text-xs font-medium text-rose-800">
          The 24-hour window is closed. A free reply will not send until the customer writes again. Internal notes still save.
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <button type="button" onClick={() => setNote(false)} className={`px-3 py-1 rounded-md font-medium ${!note ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-600'}`}>Reply to Customer</button>
          <button type="button" onClick={() => setNote(true)} className={`px-3 py-1 rounded-md font-medium ${note ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600'}`}>Internal Note</button>
        </div>
        <div className="flex items-center gap-2">
          {aiAvailable && (
            <button
              type="button"
              disabled={suggesting}
              onClick={async () => {
                setSuggesting(true);
                try {
                  const suggestion = await onSuggest();
                  if (suggestion) setBody(suggestion);
                  else toast.error('No AI suggestion generated');
                } catch (err) {
                  toast.error(errorMessage(err, 'AI suggest failed'));
                } finally {
                  setSuggesting(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {suggesting ? 'Thinking…' : 'AI Draft Response'}
            </button>
          )}
          {replies.length > 0 && (
            <button type="button" onClick={() => setOpenReplies((v) => !v)} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
              Quick Replies
            </button>
          )}
        </div>
      </div>
      {(openReplies || slash !== null) && matches.length > 0 && (
        <div className="mb-2 p-2 bg-slate-50 border border-slate-200 rounded-xl max-h-36 overflow-y-auto divide-y divide-slate-100 text-xs">
          {matches.map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => { setBody(qr.body); setOpenReplies(false); inputRef.current?.focus(); }}
              className="w-full py-1.5 px-2 hover:bg-white rounded text-left flex items-center justify-between"
            >
              <span className="font-bold text-slate-800">{qr.title || qr.shortcut}</span>
              <span className="text-slate-400 truncate max-w-xs">{qr.body}</span>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && slash !== null && matches[0]) {
              e.preventDefault();
              setBody(matches[0].body);
              setOpenReplies(false);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={note ? 'Internal note. Type @Name to mention a teammate.' : blocked ? 'Free replies are closed. Switch to an internal note.' : `Reply to ${customerName || 'customer'}… Enter sends`}
          className={`flex-1 p-2.5 text-xs bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 resize-none ${note ? 'border-amber-300 focus:ring-amber-400/30 bg-amber-50/20' : 'border-slate-200 focus:ring-soul-blue/20'}`}
        />
        <button type="submit" disabled={!body.trim() || blocked} className={`px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow disabled:opacity-50 ${note ? 'bg-amber-500 text-white' : 'bg-soul-blue text-white'}`}>
          <Send className="w-4 h-4" />
          {note ? 'Save Note' : 'Send'}
        </button>
      </form>
      <p className="mt-2 text-[10px] text-slate-400">J and K move the queue. N switches to a note. / inserts a saved reply.</p>
    </div>
  );
});

function SimulatorModal({ open, onClose, onSimulated }) {
  const [kind, setKind] = useState('whatsapp');
  const [phone, setPhone] = useState('201012345678');
  const [name, setName] = useState('Ahmed Hassan');
  const [body, setBody] = useState('Hello! I want to inquire about booking a villa for next weekend.');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await inboxApi.post('/admin/simulator/inbound', {
        kind,
        phone,
        name,
        body,
      });
      toast.success('Inbound message simulated successfully!');
      onSimulated();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Simulation failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Simulate Inbound Customer Message" size="md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="block font-bold text-slate-700 mb-1">Channel Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg bg-white">
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
          </select>
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">Customer Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg" required />
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">Customer Phone / External ID</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg" required />
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">Message Content</label>
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="w-full p-2 border border-slate-200 rounded-lg" required />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium">Cancel</button>
          <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-soul-blue text-white font-bold shadow">
            {loading ? 'Simulating…' : 'Trigger Inbound Event'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
