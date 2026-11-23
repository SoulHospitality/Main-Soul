import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ImagePlus, MessageCircle, Mic, Send, Square, X } from 'lucide-react';
import api from '../../api/http';
import { useLocale } from '../../context/LocaleContext';

const TOKEN_KEY = 'soul_chat_token';

const TEXT = {
  en: {
    open: 'Chat with us',
    title: 'Soul Hospitality',
    subtitle: 'Usually replies in seconds',
    team: 'You are chatting with our team',
    welcome: 'Hi! 👋 Ask me about our homes, prices and available dates, in English or Arabic.',
    placeholder: 'Write a message…',
    photo: 'Send a photo',
    record: 'Record a voice note',
    stop: 'Stop and send',
    perNight: '/ night',
    view: 'View',
    failed: 'Message not sent. Try again.',
    unavailable: 'Chat is not available right now. Please message us on WhatsApp.',
    you: 'You',
  },
  ar: {
    open: 'كلمنا',
    title: 'سول للضيافة',
    subtitle: 'بنرد عادةً خلال ثواني',
    team: 'أنت بتكلم فريقنا دلوقتي',
    welcome: 'أهلاً بحضرتك 👋 اسألني عن الوحدات والأسعار والتواريخ المتاحة، بالعربي أو بالإنجليزي.',
    placeholder: 'اكتب رسالتك…',
    photo: 'ابعت صورة',
    record: 'سجّل رسالة صوتية',
    stop: 'إيقاف وإرسال',
    perNight: '/ الليلة',
    view: 'عرض',
    failed: 'الرسالة ماوصلتش، جرّب تاني.',
    unavailable: 'الشات مش متاح دلوقتي، كلمنا على واتساب.',
    you: 'أنت',
  },
};

function linkify(text) {
  return String(text || '')
    .split(/(https?:\/\/[^\s]+)/g)
    .map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all underline">
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
}

function UnitCard({ u, tr }) {
  return (
    <a href={u.link} target="_blank" rel="noopener noreferrer" className="flex gap-2.5 rounded-xl border border-soul-line bg-white p-2 text-soul-blue hover:border-soul-blue/40">
      {u.image ? <img src={u.image} alt="" loading="lazy" className="h-16 w-20 shrink-0 rounded-lg object-cover" /> : null}
      <span className="min-w-0 text-xs">
        <span className="block truncate font-semibold">{u.title}</span>
        <span className="block text-soul-muted">{[u.destination, u.bedrooms ? `${u.bedrooms} BR` : null, u.max_guests ? `${u.max_guests} guests` : null].filter(Boolean).join(' · ')}</span>
        {u.price_per_night ? <span className="block font-semibold">EGP {Number(u.price_per_night).toLocaleString('en-US')} {tr.perNight}</span> : null}
      </span>
    </a>
  );
}

/** Website live chat: the Soul chatbot, and the team after a hand-off. */
export default function ChatWidget() {
  const { pathname } = useLocation();
  const { locale } = useLocale();
  const tr = TEXT[locale === 'ar' ? 'ar' : 'en'];
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  });
  const [chat, setChat] = useState({ messages: [], bot_typing: false, status: 'bot' });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const recorder = useRef(null);
  const endRef = useRef(null);
  const fileRef = useRef(null);

  const hidden = pathname.startsWith('/admin') || pathname.startsWith('/sales');

  useEffect(() => {
    if (hidden) return;
    api.get('/chat/config').then((r) => setEnabled(Boolean(r.data?.enabled))).catch(() => setEnabled(false));
  }, [hidden]);

  const saveToken = (t) => {
    setToken(t);
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.get(`/chat/sessions/${token}`);
      setChat(data);
    } catch (err) {
      if (err?.response?.status === 404) saveToken(null);
    }
  }, [token]);

  // Poll while the chat is open (faster while the bot is writing).
  useEffect(() => {
    if (!open || !token) return undefined;
    load();
    const id = setInterval(load, chat.bot_typing ? 1500 : 3500);
    return () => clearInterval(id);
  }, [open, token, load, chat.bot_typing]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.length, chat.bot_typing, open]);

  async function ensureSession() {
    if (token) return token;
    const { data } = await api.post('/chat/sessions');
    saveToken(data.token);
    setChat(data);
    return data.token;
  }

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const t = await ensureSession();
      setText('');
      const { data } = await api.post(`/chat/sessions/${t}/messages`, { text: body });
      setChat(data);
    } catch (err) {
      setError(err?.response?.status === 503 ? tr.unavailable : err?.response?.data?.error || tr.failed);
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file) {
    if (!file) return;
    setSending(true);
    setError('');
    try {
      const t = await ensureSession();
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/chat/sessions/${t}/files`, fd);
      setChat(data);
    } catch (err) {
      setError(err?.response?.data?.error || tr.failed);
    } finally {
      setSending(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr2) => tr2.stop());
        setRecording(false);
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size > 0) sendFile(new File([blob], `voice.${type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'}`, { type }));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      // Voice notes are kept short.
      setTimeout(() => rec.state === 'recording' && rec.stop(), 60000);
    } catch {
      setError(tr.failed);
    }
  }

  if (hidden || !enabled) return null;

  const canRecord = typeof window !== 'undefined' && 'MediaRecorder' in window && navigator.mediaDevices?.getUserMedia;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={tr.open}
          title={tr.open}
          className="fixed bottom-[88px] end-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-soul-blue text-white shadow-lg transition hover:scale-105 md:bottom-[96px] md:end-6 md:h-[60px] md:w-[60px]"
        >
          <MessageCircle className="h-7 w-7" />
        </button>
      ) : (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-soul-paper sm:inset-auto sm:bottom-6 sm:end-6 sm:h-[560px] sm:max-h-[calc(100vh-48px)] sm:w-[380px] sm:overflow-hidden sm:rounded-3xl sm:border sm:border-soul-line sm:shadow-2xl"
          role="dialog"
          aria-label={tr.title}
        >
          <header className="flex items-center justify-between gap-3 bg-soul-blue px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="font-semibold">{tr.title}</div>
              <div className="text-xs text-white/75">{chat.status === 'team' ? tr.team : tr.subtitle}</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1.5 hover:bg-white/15">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-4">
            <div dir="auto" className="max-w-[85%] rounded-2xl rounded-ss-sm bg-white px-3.5 py-2.5 text-sm text-soul-blue shadow-sm">{tr.welcome}</div>
            {chat.messages.map((m) => {
              const mine = m.role === 'customer';
              return (
                <div key={m.id} className={`flex flex-col gap-1.5 ${mine ? 'items-end' : 'items-start'}`}>
                  {m.body ? (
                    <div
                      dir="auto"
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                        mine ? 'rounded-se-sm bg-soul-blue text-white' : 'rounded-ss-sm bg-white text-soul-blue'
                      }`}
                    >
                      {linkify(m.body)}
                    </div>
                  ) : null}
                  {Array.isArray(m.units) && m.units.length ? (
                    <div className="w-[85%] space-y-1.5">
                      {m.units.map((u) => <UnitCard key={u.id} u={u} tr={tr} />)}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {chat.bot_typing ? (
              <div className="inline-flex gap-1 rounded-2xl bg-white px-3.5 py-3 shadow-sm" aria-label="typing">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-soul-blue/50" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {error ? <div className="px-4 pb-1 text-xs text-rose-600">{error}</div> : null}
          <form onSubmit={send} className="flex items-center gap-1.5 border-t border-soul-line bg-white px-2 py-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { sendFile(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={sending} title={tr.photo} aria-label={tr.photo} className="rounded-full p-2 text-soul-muted hover:bg-soul-blue-50 hover:text-soul-blue">
              <ImagePlus className="h-5 w-5" />
            </button>
            {canRecord ? (
              <button
                type="button"
                onClick={toggleRecording}
                disabled={sending}
                title={recording ? tr.stop : tr.record}
                aria-label={recording ? tr.stop : tr.record}
                className={`rounded-full p-2 ${recording ? 'animate-pulse bg-rose-100 text-rose-600' : 'text-soul-muted hover:bg-soul-blue-50 hover:text-soul-blue'}`}
              >
                {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            ) : null}
            <input
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={tr.placeholder}
              maxLength={2000}
              className="min-w-0 flex-1 rounded-full border border-soul-line bg-soul-paper px-4 py-2.5 text-sm text-soul-blue outline-none focus:border-soul-blue/50"
            />
            <button type="submit" disabled={!text.trim() || sending} aria-label="Send" className="rounded-full bg-soul-blue p-2.5 text-white disabled:opacity-40">
              <Send className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
