import { useEffect, useState } from 'react';
import { useInbox } from './InboxContext';
import { CHANNELS, PRESENCE, initials, slaInfo, stageTone } from './utils';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Chip({ className = '', children, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium ${className || 'bg-slate-100 text-slate-600'}`}
    >
      {children}
    </span>
  );
}

export function ChannelDot({ kind, className = '' }) {
  return (
    <span
      title={CHANNELS[kind]?.label || kind}
      className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white ${CHANNELS[kind]?.dot || 'bg-slate-400'} ${className}`}
    />
  );
}

export function Avatar({ name, url, kind, size = 'md' }) {
  const [broken, setBroken] = useState(false);
  const dims = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-11 w-11 text-sm' : 'h-10 w-10 text-sm';
  return (
    <span className={`relative inline-flex flex-shrink-0 items-center justify-center rounded-full bg-soul-blue-50 font-semibold text-soul-blue ${dims}`}>
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full rounded-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(name)
      )}
      {kind ? <ChannelDot kind={kind} className="absolute -bottom-0.5 -right-0.5" /> : null}
    </span>
  );
}

export function PresenceDot({ presence }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${PRESENCE[presence]?.dot || 'bg-slate-400'}`} />;
}

export function StageChip({ stageKey }) {
  const { stageByKey } = useInbox();
  const st = stageByKey(stageKey);
  if (!stageKey) return null;
  return <Chip className={stageTone(st)}>{st?.name_en || stageKey}</Chip>;
}

export function SlaChip({ conversation, now }) {
  const { me } = useInbox();
  const info = slaInfo(conversation, me?.rules, now);
  if (!info) return null;
  return <Chip className={`border ${info.cls}`}>{info.level === 'over' ? '⛔' : info.level === 'warn' ? '⚠️' : info.level === 'night' ? '🌙' : '⏱'} {info.text}</Chip>;
}

export function SectionTitle({ children, right }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-soul-muted">{children}</p>
      {right}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center p-6 text-center text-sm text-soul-muted">{children}</div>;
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-soul-muted">{hint}</span> : null}
    </label>
  );
}
