export const CHANNELS = {
  whatsapp: { label: 'WhatsApp', dot: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700' },
  messenger: { label: 'Messenger', dot: 'bg-blue-500', soft: 'bg-blue-50 text-blue-700' },
  instagram: { label: 'Instagram', dot: 'bg-pink-500', soft: 'bg-pink-50 text-pink-700' },
};

export const CONVERSATION_TYPES = {
  unknown: 'Unclassified',
  sales_lead: 'Sales lead',
  existing_guest: 'Existing guest',
  owner: 'Owner',
  broker: 'Broker',
  complaint: 'Complaint',
  supplier: 'Supplier',
  spam: 'Spam',
  other: 'Other',
};

export const VIEWS = [
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'waiting', label: 'Waiting customer' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'hot', label: 'Hot leads' },
  { key: 'all', label: 'All open' },
  { key: 'closed', label: 'Closed' },
];

export const STATUS_LABELS = {
  needs_reply: 'Needs reply',
  waiting_customer: 'Waiting customer',
  snoozed: 'Snoozed',
  closed: 'Closed',
};

export const ROLE_LABELS = { admin: 'CEO', manager: 'Manager', supervisor: 'Supervisor', agent: 'Agent' };

export const PRESENCE = {
  online: { label: 'Online', dot: 'bg-emerald-500' },
  away: { label: 'Away', dot: 'bg-amber-400' },
  offline: { label: 'Offline', dot: 'bg-slate-400' },
};

export const ASSIGN_REASONS = {
  auto: 'auto-routing',
  sticky: 'returning customer',
  manual: 'manual',
  claim: 'claimed',
  takeover: 'taken over',
  sla_breach: 'SLA breach',
  agent_offline: 'agent offline',
  rotation_off: 'left rotation',
};

export const humanize = (s) => (s ? String(s).replace(/_/g, ' ') : '—');

const TZ = 'Africa/Cairo';

export function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(Number(ts)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts) ? new Date(`${ts}T12:00:00`) : new Date(Number(ts) || ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(Number(ts)).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  });
}

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - Number(ts)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return fmtDate(ts);
}

/** mm:ss countdown (negative values count up as "over"). */
export function fmtClock(ms) {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtSeconds(sec) {
  if (sec === null || sec === undefined) return '—';
  const s = Math.round(Number(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h${m ? ` ${m}m` : ''}`;
}

export const fmtDuration = (ms) => fmtSeconds(Math.round(Number(ms || 0) / 1000));

export function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return `EGP ${Number(v).toLocaleString('en-EG', { maximumFractionDigits: 0 })}`;
}

export const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}

/** SLA chip state for a conversation; null when the clock is not running. */
export function slaInfo(c, rules, now = Date.now()) {
  if (!c || c.status !== 'needs_reply' || !c.sla_due_at) return null;
  if (c.sla_start_at && now < Number(c.sla_start_at)) {
    return { level: 'night', text: `After hours · starts ${fmtTime(c.sla_start_at)}`, cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  }
  const warnMs = ((rules?.sla_target_min || 15) - (rules?.sla_warning_min || 10)) * 60000;
  const remaining = Number(c.sla_due_at) - now;
  if (remaining <= 0) return { level: 'over', text: `${fmtClock(remaining)} over SLA`, cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (remaining <= warnMs) return { level: 'warn', text: `${fmtClock(remaining)} left`, cls: 'bg-amber-50 text-amber-800 border-amber-200' };
  return { level: 'ok', text: `${fmtClock(remaining)} left`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

export function stageTone(stage) {
  if (!stage) return 'bg-slate-100 text-slate-600';
  if (stage.kind === 'won') return 'bg-emerald-100 text-emerald-800';
  if (stage.kind === 'lost' || stage.kind === 'invalid') return 'bg-rose-100 text-rose-800';
  return 'bg-amber-50 text-amber-800';
}

export function fillTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

/** <input type="datetime-local"> value for a timestamp, in the browser's zone. */
export function toLocalInput(ts) {
  const d = new Date(Number(ts));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

/** Next occurrence of HH:MM Cairo time (used for "snooze until tomorrow morning"). */
export function nextCairoTime(hhmm) {
  const [h, m] = String(hhmm || '10:00').split(':').map(Number);
  const now = Date.now();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const cur = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  let delta = (h * 60 + (m || 0)) - cur;
  if (delta <= 0) delta += 24 * 60;
  return now + delta * 60000 - (now % 60000);
}

export const phoneDisplay = (p) => (p ? `+${String(p).replace(/^\+/, '')}` : '');

/** PMS booking source for a lead source. */
export function bookingSourceFor(leadSource) {
  const s = String(leadSource || '');
  if (s.endsWith('_ad')) return 'Campaign';
  if (s === 'facebook_comment' || s === 'instagram_comment') return 'Facebook Post';
  if (s === 'broker') return 'Broker';
  if (s === 'website') return 'Website';
  return 'Private';
}
