import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageSquare, Search, Filter, RefreshCw, Send, Paperclip, Sparkles,
  Bot, Clock, User, Shield, AlertTriangle, CheckCircle, Tag, Check, X,
  Plus, Smartphone, Play, Sliders, BarChart3, ChevronRight, UserPlus, Eye, Lock
} from 'lucide-react';
import { useInbox, useInboxEvents } from '../inbox/InboxContext';
import { inboxApi, errorMessage } from '../inbox/api';
import { CHANNELS, VIEWS, STATUS_LABELS, PRESENCE, CONVERSATION_TYPES, timeAgo, fmtTime, fmtDateTime, slaInfo } from '../inbox/utils';
import { Avatar, ChannelDot, PresenceDot, SlaChip, StageChip, Chip } from '../inbox/ui';
import Attachment from '../inbox/Attachment';
import LeadPanel from '../inbox/LeadPanel';
import Modal from '../components/ui/Modal';

export default function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, can, presence, setPresence, setViewing, userName, connected } = useInbox();

  const activeConvId = searchParams.get('c') ? Number(searchParams.get('c')) : null;

  const [activeView, setActiveView] = useState('mine');
  const [activeChannel, setActiveChannel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSimulator, setShowSimulator] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [messageBody, setMessageBody] = useState('');
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  const messagesEndRef = useRef(null);

  // Set viewing conversation for presence socket
  useEffect(() => {
    setViewing(activeConvId);
    return () => setViewing(null);
  }, [activeConvId, setViewing]);

  // Fetch conversations list
  const { data: convData, isLoading: loadingConvs, refetch: refetchConvs } = useQuery({
    queryKey: ['inbox-conversations', activeView, activeChannel, searchQuery],
    queryFn: () => inboxApi.get('/conversations', {
      view: activeView,
      channel_kind: activeChannel || undefined,
      q: searchQuery || undefined,
      limit: 60,
    }),
    refetchInterval: 15000,
  });

  const conversations = convData?.items || [];
  const counts = convData?.counts || {};

  // Fetch active conversation detail & messages
  const { data: currentConv, refetch: refetchCurrentConv } = useQuery({
    queryKey: ['inbox-conversation', activeConvId],
    queryFn: () => inboxApi.get(`/conversations/${activeConvId}`),
    enabled: Boolean(activeConvId),
    refetchInterval: 10000,
  });

  // Fetch quick replies & templates
  const { data: quickReplies = [] } = useQuery({
    queryKey: ['inbox-quick-replies'],
    queryFn: () => inboxApi.get('/admin/quick-replies'),
    enabled: can('templates.manage') || Boolean(me),
  });

  // Listen for realtime events
  useInboxEvents((type, data) => {
    if (type === 'message' && data?.conversation_id === activeConvId) {
      refetchCurrentConv();
    }
    if (type === 'conversation' || type === 'message') {
      refetchConvs();
    }
  });

  // Scroll chat feed to bottom when messages update
  useEffect(() => {
    if (currentConv?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentConv?.messages]);

  const selectConversation = (id) => {
    setSearchParams({ c: id });
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!messageBody.trim() || !activeConvId || sending) return;
    setSending(true);
    try {
      if (isNoteMode) {
        await inboxApi.post(`/conversations/${activeConvId}/notes`, { body: messageBody.trim() });
      } else {
        await inboxApi.post(`/conversations/${activeConvId}/messages`, { body: messageBody.trim() });
      }
      setMessageBody('');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to send message'));
    } finally {
      setSending(false);
    }
  };

  const handleAiSuggest = async () => {
    if (!activeConvId || aiSuggesting) return;
    setAiSuggesting(true);
    try {
      const res = await inboxApi.post(`/conversations/${activeConvId}/ai-suggest`);
      if (res?.suggestion) {
        setMessageBody(res.suggestion);
        toast.success('AI draft generated!');
      } else {
        toast.error('No AI suggestion generated');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'AI suggest failed'));
    } finally {
      setAiSuggesting(false);
    }
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
      toast.success('Assignment updated');
      refetchCurrentConv();
      refetchConvs();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="pms-shell flex flex-col h-[calc(100vh-4rem)] bg-slate-50 overflow-hidden font-sans">
      {/* Top Header Toolbar */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-4 shadow-sm z-10">
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

          <button
            type="button"
            onClick={() => setShowSimulator(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium text-xs border border-indigo-200 transition-colors"
          >
            <Smartphone className="w-4 h-4" />
            Simulate Message
          </button>

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
        <div className="w-80 lg:w-96 border-r border-slate-200 bg-white flex flex-col flex-shrink-0">
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
                return (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`p-3 cursor-pointer transition-all hover:bg-slate-50 relative border-l-4 ${
                      isActive
                        ? 'bg-blue-50/70 border-l-soul-blue'
                        : conv.unread_count > 0
                        ? 'bg-amber-50/40 border-l-amber-500 font-medium'
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
                            {timeAgo(conv.last_message_at)}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {conv.last_message_preview || 'No messages yet'}
                        </p>

                        <div className="flex items-center justify-between gap-1 mt-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            {conv.lead_stage ? (
                              <StageChip stageKey={conv.lead_stage} />
                            ) : (
                              <Chip className="bg-slate-100 text-slate-600">{CONVERSATION_TYPES[conv.type] || conv.type}</Chip>
                            )}
                            <SlaChip conversation={conv} now={Date.now()} />
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
        <div className="flex-1 flex flex-col bg-slate-100 overflow-hidden">
          {activeConvId && currentConv?.conversation ? (
            <>
              {/* Conversation Header Bar */}
              <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-3 flex-shrink-0 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
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
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span>Assigned to: <strong>{userName(currentConv.conversation.assigned_user_id)}</strong></span>
                      <span>·</span>
                      <SlaChip conversation={currentConv.conversation} now={Date.now()} />
                    </div>
                  </div>
                </div>

                {/* Status & Assignment Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
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

                  {/* Assignee Dropdown */}
                  <select
                    value={currentConv.conversation.assigned_user_id || ''}
                    onChange={(e) => handleAssign(e.target.value)}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {(me?.users || []).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>

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

              {/* Chat Message History Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {currentConv.messages?.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-400">No messages in this chat yet.</div>
                ) : (
                  currentConv.messages.map((msg) => {
                    const isNote = msg.sender_type === 'note' || Boolean(msg.user_id && !msg.direction);
                    const isInbound = msg.direction === 'in';
                    const isOutbound = msg.direction === 'out';
                    const isAi = msg.sender_type === 'ai';

                    if (isNote) {
                      return (
                        <div key={msg.id} className="mx-auto max-w-lg bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs shadow-sm space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-bold text-amber-700">
                            <span className="flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Internal Staff Note — {userName(msg.user_id)}
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
                              : isAi
                              ? 'bg-indigo-600 text-white rounded-tr-sm'
                              : 'bg-soul-blue text-white rounded-tr-sm'
                          }`}
                        >
                          <div className={`flex items-center justify-between gap-4 text-[10px] ${isInbound ? 'text-slate-400' : 'text-white/70'}`}>
                            <span className="font-semibold">
                              {isInbound ? currentConv.conversation.customer_name : isAi ? '🤖 AI Assistant' : userName(msg.user_id)}
                            </span>
                            <span>{fmtTime(msg.created_at)}</span>
                          </div>

                          <p className="whitespace-pre-wrap leading-relaxed text-xs">
                            {msg.body}
                          </p>

                          {msg.attachments && (
                            <Attachment message={msg} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer & Action Controls */}
              <div className="bg-white border-t border-slate-200 p-3 shadow-lg flex-shrink-0">
                {/* Composer Toolbar */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setIsNoteMode(false)}
                      className={`px-3 py-1 rounded-md font-medium transition-all ${
                        !isNoteMode ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Reply to Customer
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsNoteMode(true)}
                      className={`px-3 py-1 rounded-md font-medium transition-all ${
                        isNoteMode ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      🔒 Internal Note
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAiSuggest}
                      disabled={aiSuggesting}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold border border-indigo-200 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {aiSuggesting ? 'Thinking…' : 'AI Draft Response'}
                    </button>

                    {quickReplies.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowQuickReplies(!showQuickReplies)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-medium border border-slate-200 transition-colors"
                      >
                        ⚡ Quick Replies
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Replies Dropdown Popover */}
                {showQuickReplies && (
                  <div className="mb-2 p-2 bg-slate-50 border border-slate-200 rounded-xl max-h-36 overflow-y-auto divide-y divide-slate-100 text-xs">
                    {quickReplies.map((qr) => (
                      <div
                        key={qr.id}
                        onClick={() => {
                          setMessageBody(qr.body);
                          setShowQuickReplies(false);
                        }}
                        className="py-1.5 px-2 hover:bg-white cursor-pointer rounded transition-colors flex items-center justify-between"
                      >
                        <span className="font-bold text-slate-800">{qr.title || qr.shortcut}</span>
                        <span className="text-slate-400 truncate max-w-xs">{qr.body}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Main Input Form */}
                <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={
                      isNoteMode
                        ? 'Type an internal note visible only to staff…'
                        : `Reply to ${currentConv.conversation.customer_name || 'customer'}… (Press Enter to send)`
                    }
                    className={`flex-1 p-2.5 text-xs bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 resize-none ${
                      isNoteMode
                        ? 'border-amber-300 focus:ring-amber-400/30 bg-amber-50/20'
                        : 'border-slate-200 focus:ring-soul-blue/20'
                    }`}
                  />

                  <button
                    type="submit"
                    disabled={sending || !messageBody.trim()}
                    className={`px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow transition-all ${
                      isNoteMode
                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                        : 'bg-soul-blue hover:bg-soul-blue-dark text-white'
                    } disabled:opacity-50`}
                  >
                    <Send className="w-4 h-4" />
                    {sending ? 'Sending…' : isNoteMode ? 'Save Note' : 'Send'}
                  </button>
                </form>
              </div>
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
          <div className="w-80 lg:w-96 border-l border-slate-200 bg-white flex-shrink-0 overflow-y-auto p-4">
            <LeadPanel
              leadId={currentConv.conversation.current_lead_id}
              conversationId={activeConvId}
              onUpdated={() => {
                refetchCurrentConv();
                refetchConvs();
              }}
            />
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
