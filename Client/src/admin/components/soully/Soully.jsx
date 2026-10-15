import { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';

const STARTERS = [
  { label: 'Today', text: 'What is the movement today: arrivals, departures, and who is in house?' },
  { label: 'Report', text: 'Write a report on reservations, finance, and HR, and estimate next month from the recent trend.' },
  { label: 'Forecast', text: 'How are bookings and collections trending, and what does next month look like?' },
];

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text || '');
}

export default function Soully() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    inputRef.current?.focus();
    return undefined;
  }, [open, messages, busy]);

  async function send(text) {
    const content = String(text || '').trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const { data } = await api.post('/soully/chat', {
        messages: next.map((item) => ({ role: item.role, content: item.content })),
      });
      setMessages((current) => [...current, { role: 'assistant', content: data.reply || '…' }]);
    } catch (err) {
      const reply = err.response?.data?.error || 'I could not complete that lookup. Please try again.';
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } finally {
      setBusy(false);
    }
  }

  const lastUser = [...messages].reverse().find((item) => item.role === 'user');
  const rtl = hasArabic(draft) || hasArabic(lastUser?.content);

  return (
    <div className="soully">
      {open ? (
        <section className="soully-panel" role="dialog" aria-label="Soully" dir={rtl ? 'rtl' : 'ltr'}>
          <header className="soully-panel__head">
            <img src="/soul-brand/soul-logo.png" alt="" className="soully-panel__logo" />
            <div className="min-w-0">
              <p className="soully-panel__name">Soully</p>
              <p className="soully-panel__tag">Ask for the figures, a department report, or a next-month estimate.</p>
            </div>
            <button type="button" className="soully-panel__close" onClick={() => setOpen(false)} aria-label="Close Soully">
              ×
            </button>
          </header>

          <div ref={listRef} className="soully-panel__body">
            {messages.length === 0 ? (
              <div className="soully-empty">
                <p>Ask for a live figure, or for a report and a next-month estimate across reservations, finance, HR, operations, and units.</p>
                <div className="soully-starters">
                  {STARTERS.map((item) => (
                    <button key={item.label} type="button" onClick={() => send(item.text)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((item, index) => (
                <div
                  key={`${item.role}-${index}`}
                  className={`soully-bubble soully-bubble--${item.role}`}
                  dir={hasArabic(item.content) ? 'rtl' : 'ltr'}
                >
                  {item.content}
                </div>
              ))
            )}
            {busy ? <div className="soully-bubble soully-bubble--assistant soully-bubble--wait">One moment.</div> : null}
          </div>

          <form
            className="soully-form"
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              dir={hasArabic(draft) ? 'rtl' : 'ltr'}
              placeholder={rtl ? 'اسأل سولي…' : 'Ask Soully…'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">
              Send
            </button>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        className="soully-launcher"
        aria-label={open ? 'Close Soully' : 'Open Soully'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <img src="/soul-brand/soul-logo.png" alt="" />
      </button>
    </div>
  );
}
