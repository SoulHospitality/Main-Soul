import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageSquare, Search, Send, Paperclip, Sparkles,
  X, ChevronLeft, Lock, PanelRight
} from 'lucide-react';
import { useInbox, useInboxEvents } from '../inbox/InboxContext';
import { inboxApi, errorMessage } from '../inbox/api';
import { CHANNELS, VIEWS, STATUS_LABELS, CONVERSATION_TYPES, timeAgo, fmtTime, serviceWindow, nextCairoTime } from '../inbox/utils';
import { Avatar, ChannelDot, PresenceDot, SlaChip, StageChip, Chip, useNow } from '../inbox/ui';
import Attachment from '../inbox/Attachment';
import GuestRail from '../inbox/GuestRail';

export default function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { me, can, setPresence, setViewing, userName, connected, viewers } = useInbox();
  const now = useNow(30000);

  const activeConvId = searchParams.get('c') ? Number(searchParams.get('c')) : null;

  const [activeView, setActiveView] = useState('mine');
  const [activeChannel, setActiveChannel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [showRightPanel, setShowRightPanel] = useState(() => window.innerWidth >= 1536);
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

  const handleSendMessage = (text, asNote, file) => {
    if ((!text && !file) || !activeConvId) return;
    if (!asNote && Number(currentConv?.customer?.is_simulated) !== 1 && !serviceWindow(currentConv?.conversation, Date.now()).open) {
      toast.error('The 24-hour window is closed');
      return;
    }
    const tempId = `local-${Date.now()}`;
    const stamp = Date.now();
    const mine = { id: me?.user?.id, name: me?.user?.name };
    const localUrl = file ? URL.createObjectURL(file) : null;
    const pendingAttachments = file
      ? [{ type: (file.type || 'file').split('/')[0] || 'file', url: localUrl, mime: file.type, filename: file.name }]
      : [];
    qc.setQueryData(['inbox-conversation', activeConvId], (old) => {
      if (!old) return old;
      if (asNote) {
        return { ...old, notes: [...(old.notes || []), { id: tempId, body: text, user_id: mine.id, user_name: mine.name, created_at: stamp }] };
      }
      return {
        ...old,
        messages: [...(old.messages || []), {
          id: tempId, direction: 'out', sender_type: 'agent', body: text, user_id: mine.id, user_name: mine.name,
          created_at: stamp, delivery_status: 'pending', attachments: pendingAttachments,
        }],
      };
    });
    let request;
    if (asNote) {
      request = inboxApi.post(`/conversations/${activeConvId}/notes`, { body: text });
    } else if (file) {
      const form = new FormData();
      form.append('file', file);
      if (text) form.append('caption', text);
      request = inboxApi.upload(`/conversations/${activeConvId}/attachments`, form);
    } else {
      request = inboxApi.post(`/conversations/${activeConvId}/messages`, { text });
    }
    request.then((res) => {
      if (localUrl) setTimeout(() => URL.revokeObjectURL(localUrl), 1500);
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
    if (status === 'closed' && (!currentConv?.conversation?.type || currentConv.conversation.type === 'unknown')) {
      setShowRightPanel(true);
      toast.error('Choose who this guest is before closing the chat');
      return;
    }
    try {
      await inboxApi.post(`/conversations/${activeConvId}/status`, { status });
      toast.success(`Status updated to ${STATUS_LABELS[status] || status}`);
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

  const setConversationType = async (type) => {
    if (!activeConvId || !type) return;
    try {
      await inboxApi.post(`/conversations/${activeConvId}/type`, { type });
      toast.success(`Marked as ${CONVERSATION_TYPES[type] || type}`);
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const startStayRequest = async () => {
    if (!activeConvId) return;
    try {
      await inboxApi.post(`/conversations/${activeConvId}/leads`, {});
      toast.success('Stay request opened');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
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
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
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
  }, [conversations, activeConvId]);

  return (
    <div className="inbox-shell flex-row bg-slate-50 font-sans">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-bold text-slate-900">Inbox</h1>
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${connected ? 'text-emerald-700' : 'text-amber-700'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {connected ? 'Live' : 'Connecting'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Guest chats across WhatsApp, Instagram, and Messenger.</p>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2" aria-label="Inbox views">
          {VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => setActiveView(view.key)}
              className={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs font-medium ${
                activeView === view.key ? 'bg-soul-blue text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="truncate">{view.label}</span>
              {counts[view.key] !== undefined ? (
                <span className={`ml-2 rounded-full px-1.5 text-[10px] ${activeView === view.key ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{counts[view.key]}</span>
              ) : null}
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Channel</p>
          <button
            type="button"
            onClick={() => setActiveChannel('')}
            className={`flex h-8 w-full items-center rounded-lg px-2.5 text-left text-xs ${!activeChannel ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            All channels
          </button>
          {Object.entries(CHANNELS).map(([key, channel]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveChannel(key === activeChannel ? '' : key)}
              className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs ${activeChannel === key ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <ChannelDot kind={key} />
              {channel.label}
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-slate-200 p-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
            {['online', 'away', 'offline'].map((presence) => (
              <button
                key={presence}
                type="button"
                onClick={() => setPresence(presence)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 font-medium capitalize ${
                  me?.user?.presence === presence ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                <PresenceDot presence={presence} />
                {presence === 'online' ? 'On' : presence === 'away' ? 'Away' : 'Off'}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Thread list */}
        <div className={`${activeConvId ? 'hidden lg:flex' : 'flex'} w-full min-h-0 flex-shrink-0 flex-col border-r border-slate-200 bg-white lg:w-72 xl:w-80`}>
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
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-soul-blue/20 sm:text-sm"
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
            <div className="flex items-center gap-2 lg:hidden">
              <select
                aria-label="Inbox view"
                value={activeView}
                onChange={(event) => setActiveView(event.target.value)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800"
              >
                {VIEWS.map((view) => (
                  <option key={view.key} value={view.key}>
                    {view.label}{counts[view.key] !== undefined ? ` (${counts[view.key]})` : ''}
                  </option>
                ))}
              </select>
              <select
                aria-label="My status"
                value={me?.user?.presence || 'offline'}
                onChange={(event) => setPresence(event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm capitalize text-slate-700"
              >
                <option value="online">Online</option>
                <option value="away">Away</option>
                <option value="offline">Offline</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1 text-[11px] lg:hidden">
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
                  className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 transition-colors ${
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
          <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain">
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
                          <h3 className="truncate text-xs font-bold text-slate-900">
                            {conv.customer_name || 'Guest'}
                            {conv.type && conv.type !== 'unknown' ? (
                              <span className="ml-1.5 font-medium text-soul-blue">{CONVERSATION_TYPES[conv.type]}</span>
                            ) : null}
                          </h3>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">
                            {timeAgo(conv.last_message_at, now)}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {conv.last_message_preview || 'No messages yet'}
                        </p>

                        <div className="mt-1.5 flex items-center justify-between gap-1">
                          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                            <span className="hidden sm:contents">
                              {conv.stage_key ? (
                                <StageChip stageKey={conv.stage_key} />
                              ) : (
                                <Chip className="bg-slate-100 text-slate-600">{CONVERSATION_TYPES[conv.type] || conv.type}</Chip>
                              )}
                              {conv.temperature === 'hot' ? <Chip className="bg-rose-100 text-rose-700">Hot</Chip> : null}
                            </span>
                            <SlaChip conversation={conv} now={now} />
                            {rowWindow.urgent ? <Chip className={`hidden border sm:inline-flex ${rowWindow.cls}`}>{rowWindow.text}</Chip> : null}
                            <Chip className={`max-w-[9rem] truncate ${peopleOn(conv).length ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-700'}`}>
                              {peopleOn(conv).length
                                ? peopleOn(conv).map((p) => (Number(p.id) === Number(me?.user?.id) ? 'You' : p.name)).join(', ')
                                : 'Unassigned'}
                            </Chip>
                            {watching.length > 0 ? (
                              <Chip className="hidden bg-amber-50 text-amber-800 sm:inline-flex" title="Someone else has this chat open">
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
        <div className={`${activeConvId ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100`}>
          {activeConvId && currentConv?.conversation ? (
            <>
              <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-2 shadow-sm sm:px-3">
                <button
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 lg:hidden"
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
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate text-sm font-bold text-slate-900">
                      {currentConv.conversation.customer_name || 'Guest'}
                    </h2>
                    <ChannelDot kind={currentConv.conversation.channel_kind} />
                  </div>
                  <p className="truncate text-[11px] text-slate-500">
                    {CONVERSATION_TYPES[currentConv.conversation.type] || 'Unclassified'}
                    {' · '}
                    {peopleOn(currentConv.conversation).map((p) => p.name).join(', ') || 'Unassigned'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRightPanel(!showRightPanel)}
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold ${
                    showRightPanel ? 'border-soul-blue bg-soul-blue text-white' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                  aria-label="Guest record"
                >
                  <PanelRight className="h-4 w-4" />
                  <span className="hidden sm:inline">Guest</span>
                </button>
              </div>

              {othersOn(currentConv.conversation.id).length > 0 && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs font-medium text-amber-900">
                  {othersOn(currentConv.conversation.id).map((id) => userName(id)).join(', ')} {othersOn(currentConv.conversation.id).length === 1 ? 'is' : 'are'} also in this chat. Check before you reply.
                </div>
              )}

              {/* Chat Message History Stream */}
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3 sm:space-y-3 sm:p-4">
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
                        <div key={msg.id} className="mx-auto w-full max-w-lg space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 shadow-sm sm:text-xs">
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
                          className={`max-w-[85%] space-y-1.5 rounded-2xl p-3 text-sm shadow-sm sm:max-w-xl sm:text-xs ${
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

                          <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
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
                agentName={me?.user?.name}
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
              <h2 className="text-base font-bold text-slate-700">Choose a guest</h2>
              <p className="mt-1 max-w-sm text-xs text-slate-400">
                Reply from here, record the stay, and label the chat before you close it.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: PMS Lead Panel */}
        {showRightPanel && activeConvId && currentConv?.conversation && (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-white p-4 pb-8 2xl:static 2xl:z-auto 2xl:w-80 2xl:flex-shrink-0 2xl:border-l 2xl:border-slate-200 2xl:pb-4">
            <button
              type="button"
              className="mb-3 inline-flex h-11 items-center gap-1 text-sm font-semibold text-soul-blue 2xl:hidden"
              onClick={() => setShowRightPanel(false)}
            >
              <ChevronLeft className="h-4 w-4" />
              Back to chat
            </button>
            <GuestRail
              conversation={currentConv.conversation}
              customer={currentConv.customer}
              leads={currentConv.leads}
              followUps={currentConv.followUps}
              me={me}
              can={can}
              now={now}
              windowInfo={windowInfo}
              people={peopleOn(currentConv.conversation)}
              onType={setConversationType}
              onStatus={handleUpdateStatus}
              onRemove={(userId) => removeAssignee(currentConv.conversation.id, userId)}
              onClaim={() => claimConversation(currentConv.conversation.id)}
              onSnooze={snoozeUntilMorning}
              onChanged={() => { refetchCurrentConv(); refetchConvs(); }}
              onStartLead={startStayRequest}
            />
          </div>
        )}
      </div>

    </div>
  );
}

function fillReply(text, agentName, customerName) {
  return String(text || '')
    .replace(/\{\{\s*agent_name\s*\}\}/gi, () => agentName || '')
    .replace(/\{\{\s*customer_name\s*\}\}/gi, () => customerName || '');
}

const ChatComposer = forwardRef(function ChatComposer({
  conversationId, customerName, agentName, windowOpen, simulated, replies, aiAvailable, onSend, onSuggest,
}, ref) {
  const [body, setBody] = useState('');
  const [note, setNote] = useState(false);
  const [openReplies, setOpenReplies] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [file, setFile] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const blocked = !note && !simulated && !windowOpen;
  const slash = body.startsWith('/') ? body.slice(1).trim().toLowerCase() : null;
  const matches = slash === null
    ? replies
    : replies.filter((qr) => `${qr.shortcut || ''} ${qr.title || ''}`.toLowerCase().includes(slash));

  useEffect(() => {
    setBody('');
    setNote(false);
    setOpenReplies(false);
    setFile(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, [conversationId]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [body]);

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

  const chooseFile = (event) => {
    const next = event.target.files?.[0];
    event.target.value = '';
    if (!next) return;
    if (next.size > 16 * 1024 * 1024) {
      toast.error('File must be under 16 MB');
      return;
    }
    setNote(false);
    setFile(next);
  };

  const applyReply = (text) => fillReply(text, agentName, customerName);

  const submit = (event) => {
    event?.preventDefault();
    const text = applyReply(body).trim();
    if (blocked || (!text && !file)) return;
    if (note && !text) return;
    setBody('');
    setOpenReplies(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const sendingFile = note ? null : file;
    setFile(null);
    onSend(text, note, sendingFile);
  };

  return (
    <div className={`flex-shrink-0 border-t px-2 py-2 shadow-lg sm:px-3 sm:py-3 ${blocked ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
      {blocked && (
        <p className="mb-2 text-xs font-medium text-rose-800">
          The 24-hour window is closed. A free reply will not send until the customer writes again. Internal notes still save.
        </p>
      )}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
          <button type="button" onClick={() => setNote(false)} className={`h-9 flex-1 rounded-md px-2 font-medium ${!note ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-600'}`}>Reply</button>
          <button type="button" onClick={() => setNote(true)} className={`h-9 flex-1 rounded-md px-2 font-medium ${note ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600'}`}>Note</button>
        </div>
        {aiAvailable && (
          <button
            type="button"
            disabled={suggesting}
            aria-label="AI draft"
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
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{suggesting ? 'Thinking…' : 'AI draft'}</span>
          </button>
        )}
        {replies.length > 0 && (
          <button type="button" onClick={() => setOpenReplies((v) => !v)} className="h-10 shrink-0 rounded-lg border border-slate-200 bg-slate-100 px-2.5 text-xs font-medium text-slate-700">
            Saved
          </button>
        )}
      </div>
      {(openReplies || slash !== null) && matches.length > 0 && (
        <div className="mb-2 max-h-36 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm sm:text-xs">
          {matches.map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => { setBody(applyReply(qr.body)); setOpenReplies(false); inputRef.current?.focus(); }}
              className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-2 text-left hover:bg-white sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-bold text-slate-800">{qr.title || qr.shortcut}</span>
              <span className="line-clamp-1 text-slate-400 sm:max-w-xs">{applyReply(qr.body)}</span>
            </button>
          ))}
        </div>
      )}
      {file && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <Paperclip className="h-3.5 w-3.5" />
          <span className="max-w-[16rem] truncate">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="text-slate-400 hover:text-rose-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <form onSubmit={submit} className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/ogg,audio/aac,audio/mp4,application/pdf"
          onChange={chooseFile}
        />
        <button
          type="button"
          disabled={blocked}
          onClick={() => fileRef.current?.click()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          aria-label="Attach a file"
          title="Image, video, audio, or PDF, up to 16 MB"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && slash !== null && matches[0]) {
              e.preventDefault();
              setBody(applyReply(matches[0].body));
              setOpenReplies(false);
              return;
            }
            const coarse = window.matchMedia('(pointer: coarse)').matches;
            if (e.key === 'Enter' && !e.shiftKey && !coarse) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={note ? 'Internal note' : blocked ? 'Window closed. Use a note.' : `Message ${customerName || 'guest'}`}
          className={`max-h-36 min-h-11 flex-1 resize-none rounded-xl border bg-slate-50 p-2.5 text-base focus:outline-none focus:ring-2 sm:text-sm ${note ? 'border-amber-300 bg-amber-50/20 focus:ring-amber-400/30' : 'border-slate-200 focus:ring-soul-blue/20'}`}
        />
        <button type="submit" aria-label={note ? 'Save note' : 'Send'} disabled={blocked || (!body.trim() && !file) || (note && !body.trim())} className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold shadow disabled:opacity-50 ${note ? 'bg-amber-500 text-white' : 'bg-soul-blue text-white'}`}>
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">{note ? 'Save' : 'Send'}</span>
        </button>
      </form>
      <p className="mt-1.5 hidden text-[10px] text-slate-400 lg:block">J and K move the queue. N switches to a note. / inserts a saved reply.</p>
    </div>
  );
});

