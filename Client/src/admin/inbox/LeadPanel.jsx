import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarPlus, Check, Home, Link2, Search, X } from 'lucide-react';
import Modal from '../components/ui/Modal';
import { usePermissions } from '../hooks/usePermissions';
import { useInbox } from './InboxContext';
import { inboxApi, errorCode, errorMessage } from './api';
import { Chip, Field, SectionTitle, StageChip } from './ui';
import ReservationFromLead from './ReservationFromLead';
import { fmtDate, fmtDateTime, fmtMoney, fromLocalInput, humanize, toLocalInput } from './utils';

const EMPTY = { project: '', unit_type: '', check_in: '', check_out: '', guests: '', budget: '', temperature: '', source: '', campaign: '' };

function FollowUpFields({ value, onChange }) {
  return (
    <div className="space-y-3">
      <Field label="Follow up at">
        <input type="datetime-local" className="input" value={value.at} onChange={(e) => onChange({ ...value, at: e.target.value })} required />
      </Field>
      <Field label="Note">
        <input className="input" maxLength={300} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="e.g. send photos of the villa" />
      </Field>
    </div>
  );
}

const defaultFollowUp = () => ({ at: toLocalInput(Date.now() + 24 * 3600000), note: '' });

/** Collects what the target stage needs (lost reason, booking, follow-up) and moves the lead. */
function StageModal({ open, lead, stage, needFollowUp, onClose, onDone, onBook }) {
  const { me } = useInbox();
  const [lost, setLost] = useState({ key: '', note: '' });
  const [won, setWon] = useState({ reservation: '', ref: '', value: '' });
  const [fu, setFu] = useState(defaultFollowUp());
  const [saving, setSaving] = useState(false);
  const [askFollowUp, setAskFollowUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLost({ key: '', note: '' });
    setWon({ reservation: '', ref: '', value: '' });
    setFu(defaultFollowUp());
    setAskFollowUp(needFollowUp);
  }, [open, needFollowUp]);

  if (!stage) return null;
  const showFollowUp = stage.kind === 'open' && askFollowUp;

  const submit = async () => {
    setSaving(true);
    try {
      if (stage.kind === 'won' && won.reservation) {
        await inboxApi.post(`/leads/${lead.id}/reservation`, { reservation_id: Number(won.reservation) });
      } else {
        const body = { stage: stage.key };
        if (stage.kind === 'lost') Object.assign(body, { lost_reason_key: lost.key, lost_note: lost.note });
        if (stage.kind === 'won') Object.assign(body, { booking_ref: won.ref, booking_value: won.value });
        if (showFollowUp) Object.assign(body, { follow_up_at: fromLocalInput(fu.at), follow_up_note: fu.note });
        await inboxApi.post(`/leads/${lead.id}/stage`, body);
      }
      toast.success(`Moved to ${stage.name_en}`);
      onDone();
    } catch (err) {
      if (errorCode(err) === 'follow_up_required') setAskFollowUp(true);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Move to ${stage.name_en}`}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving || (stage.kind === 'lost' && !lost.key)} onClick={submit}>
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {stage.kind === 'lost' && (
          <>
            <Field label="Lost reason">
              <select className="input" value={lost.key} onChange={(e) => setLost({ ...lost, key: e.target.value })}>
                <option value="">Choose…</option>
                {(me?.lostReasons || []).map((r) => <option key={r.key} value={r.key}>{r.name_en}</option>)}
              </select>
            </Field>
            <Field label="Note (optional)">
              <input className="input" maxLength={300} value={lost.note} onChange={(e) => setLost({ ...lost, note: e.target.value })} />
            </Field>
          </>
        )}
        {stage.kind === 'won' && (
          <>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Best: create the reservation in the PMS so the booking value and reference are exact.
              {onBook ? (
                <button type="button" className="btn-success btn-sm mt-2 w-full" onClick={() => { onClose(); onBook(); }}>
                  <CalendarPlus className="h-4 w-4" /> Create PMS reservation
                </button>
              ) : null}
            </div>
            <Field label="…or link an existing reservation #" hint="The value and reference are taken from the reservation.">
              <input className="input" inputMode="numeric" value={won.reservation} onChange={(e) => setWon({ ...won, reservation: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 1532" />
            </Field>
            {!won.reservation && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Booking ref">
                  <input className="input" maxLength={100} value={won.ref} onChange={(e) => setWon({ ...won, ref: e.target.value })} />
                </Field>
                <Field label="Booking value (EGP)">
                  <input className="input" type="number" min="0" value={won.value} onChange={(e) => setWon({ ...won, value: e.target.value })} />
                </Field>
              </div>
            )}
          </>
        )}
        {showFollowUp && (
          <>
            <p className="text-sm text-soul-muted">This stage needs a scheduled next action.</p>
            <FollowUpFields value={fu} onChange={setFu} />
          </>
        )}
        {stage.kind === 'open' && !showFollowUp && <p className="text-sm text-soul-muted">Move this lead to {stage.name_en}?</p>}
      </div>
    </Modal>
  );
}

function AvailabilityList({ lead, onPick, onBook, canBook, onQuote }) {
  const [query, setQuery] = useState(null);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ check_in: '', check_out: '', project: '', guests: '', bedrooms: '' });

  useEffect(() => {
    setFilters({
      check_in: lead.check_in || '', check_out: lead.check_out || '', project: lead.project || '', guests: lead.guests || '', bedrooms: '',
    });
    setItems(null);
  }, [lead.id, lead.check_in, lead.check_out, lead.project, lead.guests]);

  const search = async () => {
    if (!filters.check_in || !filters.check_out) return toast.error('Set check-in and check-out first');
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== null));
      const res = await inboxApi.get('/availability', params);
      setItems(res.items);
      setQuery(params);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-soul-line bg-white p-3">
      <SectionTitle>Availability &amp; prices</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="input py-1.5 text-xs" value={filters.check_in} onChange={(e) => setFilters({ ...filters, check_in: e.target.value })} />
        <input type="date" className="input py-1.5 text-xs" value={filters.check_out} onChange={(e) => setFilters({ ...filters, check_out: e.target.value })} />
        <input className="input py-1.5 text-xs" type="number" min="1" placeholder="Guests" value={filters.guests} onChange={(e) => setFilters({ ...filters, guests: e.target.value })} />
        <input className="input py-1.5 text-xs" type="number" min="1" placeholder="Bedrooms" value={filters.bedrooms} onChange={(e) => setFilters({ ...filters, bedrooms: e.target.value })} />
      </div>
      <button type="button" className="btn-secondary btn-sm mt-2 w-full" onClick={search} disabled={loading}>
        <Search className="h-3.5 w-3.5" /> {loading ? 'Searching…' : `Find free units${filters.project ? ` in ${filters.project}` : ''}`}
      </button>
      {items && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {!items.length && <p className="text-xs text-soul-muted">No free units for these dates{query?.project ? ` in ${query.project}` : ''}.</p>}
          {items.map((u) => (
            <div key={u.id} className={`rounded-lg border p-2 text-xs ${String(lead.unit_id) === String(u.id) ? 'border-emerald-300 bg-emerald-50' : 'border-soul-line'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-soul-blue">{u.unit_number ? `${u.unit_number} · ` : ''}{u.title}</div>
                  <div className="text-soul-muted">{u.compound} · {u.beds || '?'} BR · up to {u.guests || '?'} guests</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-soul-blue">{u.total ? fmtMoney(u.total) : 'No price'}</div>
                  <div className="text-soul-muted">
                    {u.nights} night{u.nights === 1 ? '' : 's'}{u.avg_per_night ? ` · ~${fmtMoney(u.avg_per_night)}/n` : ''}
                  </div>
                </div>
              </div>
              {!u.fully_priced && u.total ? <p className="mt-1 text-amber-700">Only {u.priced_nights}/{u.nights} nights have a price.</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className="btn-secondary btn-sm py-1" onClick={() => onPick(u)}>
                  <Home className="h-3 w-3" /> {String(lead.unit_id) === String(u.id) ? 'Selected' : 'Select'}
                </button>
                {onQuote && u.total ? (
                  <button type="button" className="btn-secondary btn-sm py-1" onClick={() => onQuote(u, query)}>Quote in reply</button>
                ) : null}
                {canBook && (
                  <button type="button" className="btn-primary btn-sm py-1" onClick={() => onBook(u)}>
                    <CalendarPlus className="h-3 w-3" /> Book
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lead editor used by the inbox side panel and the Leads page. */
export default function LeadPanel({ lead, followUps = [], customer, onChanged, onQuote }) {
  const { me, can, stageByKey } = useInbox();
  const { canManageReservations } = usePermissions();
  const [form, setForm] = useState(EMPTY);
  const [stageTarget, setStageTarget] = useState(null);
  const [fuOpen, setFuOpen] = useState(false);
  const [fu, setFu] = useState(defaultFollowUp());
  const [booking, setBooking] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      project: lead.project || '', unit_type: lead.unit_type || '', check_in: lead.check_in || '', check_out: lead.check_out || '',
      guests: lead.guests ?? '', budget: lead.budget || '', temperature: lead.temperature || '', source: lead.source || '', campaign: lead.campaign || '',
    });
  }, [lead]);

  const stages = me?.stages || [];
  const current = stageByKey(lead.stage_key);
  const openStages = stages.filter((s) => s.kind === 'open');
  const closingStages = stages.filter((s) => s.kind !== 'open');
  const now = Date.now();
  const openFollowUps = useMemo(
    () => followUps.filter((f) => f.lead_id === lead.id && f.status === 'open').sort((a, b) => a.due_at - b.due_at),
    [followUps, lead.id],
  );
  const hasFutureFollowUp = openFollowUps.some((f) => f.due_at > now);
  const dirty = Object.keys(EMPTY).some((k) => String(form[k] ?? '') !== String(lead[k] ?? ''));
  const canBook = canManageReservations && current?.kind === 'open';

  const save = async (patch = form) => {
    setSaving(true);
    try {
      await inboxApi.patch(`/leads/${lead.id}`, patch);
      toast.success('Lead saved');
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const clickStage = async (st) => {
    if (st.key === lead.stage_key) return;
    const needsForm = st.kind !== 'open' || (st.requires_follow_up && !hasFutureFollowUp);
    if (needsForm) return setStageTarget(st);
    try {
      await inboxApi.post(`/leads/${lead.id}/stage`, { stage: st.key });
      onChanged?.();
    } catch (err) {
      if (errorCode(err) === 'follow_up_required') return setStageTarget(st);
      toast.error(errorMessage(err));
    }
    return null;
  };

  const addFollowUp = async () => {
    try {
      await inboxApi.post('/follow-ups', { lead_id: lead.id, due_at: fromLocalInput(fu.at), note: fu.note });
      setFuOpen(false);
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const closeFollowUp = async (id, cancel = false) => {
    try {
      await inboxApi.post(`/follow-ups/${id}/done`, { cancel });
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const changeOwner = async (userId) => {
    try {
      await inboxApi.post(`/leads/${lead.id}/owner`, { user_id: Number(userId) });
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <div>
        <SectionTitle right={<span className="text-[11px] text-soul-muted">Lead #{lead.id} · {fmtDate(lead.created_at)}</span>}>Stage</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {openStages.map((s) => {
            const isCurrent = s.key === lead.stage_key;
            const done = current?.kind === 'open' && s.position < current.position;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => clickStage(s)}
                className={`rounded-lg border px-2 py-1 text-xs font-medium transition ${
                  isCurrent ? 'border-amber-400 bg-amber-100 text-amber-900' : done ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-soul-line bg-white text-soul-muted hover:border-amber-300'
                }`}
              >
                {s.name_en}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {closingStages.map((s) => {
            const isCurrent = s.key === lead.stage_key;
            const won = s.kind === 'won';
            const tone = isCurrent
              ? won ? 'border-emerald-400 bg-emerald-100 text-emerald-900' : 'border-rose-400 bg-rose-100 text-rose-900'
              : won ? 'border-soul-line bg-white text-soul-muted hover:border-emerald-300' : 'border-soul-line bg-white text-soul-muted hover:border-rose-300';
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => clickStage(s)}
                className={`rounded-lg border px-2 py-1 text-xs font-medium transition ${tone}`}
              >
                {s.kind === 'won' ? '✓' : '✕'} {s.name_en}
              </button>
            );
          })}
        </div>
        {current?.kind === 'lost' && lead.lost_reason_key && (
          <p className="mt-2 text-xs text-soul-muted">
            Lost: <strong className="text-soul-blue">{(me?.lostReasons || []).find((r) => r.key === lead.lost_reason_key)?.name_en || lead.lost_reason_key}</strong>
            {lead.lost_note ? ` — ${lead.lost_note}` : ''}
          </p>
        )}
        {current?.kind === 'won' && (
          <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Booked {lead.booking_ref ? <strong>{lead.booking_ref}</strong> : null} · {fmtMoney(lead.booking_value)}
            {lead.reservation_id ? (
              <Link to={`/admin/reservations?view=${lead.reservation_id}`} className="ml-2 inline-flex items-center gap-1 font-semibold underline">
                <Link2 className="h-3 w-3" /> Open reservation #{lead.reservation_id}
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Project">
            <select className="input py-1.5 text-sm" value={form.project} onChange={set('project')}>
              <option value="" />
              {(me?.rules?.projects || []).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Unit type">
            <input className="input py-1.5 text-sm" value={form.unit_type} onChange={set('unit_type')} placeholder="2BR chalet" />
          </Field>
          <Field label="Check-in">
            <input type="date" className="input py-1.5 text-sm" value={form.check_in} onChange={set('check_in')} />
          </Field>
          <Field label="Check-out">
            <input type="date" className="input py-1.5 text-sm" value={form.check_out} onChange={set('check_out')} />
          </Field>
          <Field label="Guests">
            <input type="number" min="0" className="input py-1.5 text-sm" value={form.guests} onChange={set('guests')} />
          </Field>
          <Field label="Budget">
            <input className="input py-1.5 text-sm" value={form.budget} onChange={set('budget')} />
          </Field>
          <Field label="Temperature">
            <select className="input py-1.5 text-sm" value={form.temperature} onChange={set('temperature')}>
              <option value="" />
              <option value="hot">🔥 Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
          </Field>
          <Field label="Source">
            <select className="input py-1.5 text-sm" value={form.source} onChange={set('source')}>
              <option value="" />
              {(me?.rules?.lead_sources || []).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Campaign / ad">
          <input className="input py-1.5 text-sm" value={form.campaign} onChange={set('campaign')} />
        </Field>
        {lead.unit_id && (
          <div className="flex items-center justify-between rounded-lg bg-soul-blue-50 px-3 py-1.5 text-xs text-soul-blue">
            <span><Home className="mr-1 inline h-3 w-3" />{lead.unit_number ? `${lead.unit_number} · ` : ''}{lead.unit_title || 'Selected unit'}</span>
            <button type="button" className="text-soul-muted hover:text-rose-600" onClick={() => save({ unit_id: null })} title="Clear unit">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-soul-muted">
            Owner:{' '}
            {can('conv.assign') ? (
              <select className="rounded-md border border-soul-line bg-white px-1 py-0.5 text-xs" value={lead.owner_user_id || ''} onChange={(e) => changeOwner(e.target.value)}>
                <option value="" disabled>—</option>
                {(me?.users || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            ) : (
              <strong className="text-soul-blue">{lead.owner_name || '—'}</strong>
            )}
          </span>
          <button type="submit" className="btn-primary btn-sm" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save lead'}</button>
        </div>
      </form>

      {canBook && (
        <button type="button" className="btn-success btn-sm w-full" onClick={() => setBooking({ unitId: lead.unit_id })}>
          <CalendarPlus className="h-4 w-4" /> Create PMS reservation
        </button>
      )}

      {current?.kind === 'open' && (
        <AvailabilityList
          lead={lead}
          canBook={canBook}
          onQuote={onQuote}
          onPick={(u) => save({ unit_id: u.id, project: lead.project || u.compound || undefined })}
          onBook={(u) => setBooking({ unitId: u.id, pricePerNight: u.fully_priced ? u.avg_per_night : null })}
        />
      )}

      <div>
        <SectionTitle
          right={current?.kind === 'open' ? (
            <button type="button" className="text-xs font-semibold text-soul-blue hover:underline" onClick={() => { setFu(defaultFollowUp()); setFuOpen(true); }}>
              + Add follow-up
            </button>
          ) : null}
        >
          Follow-ups
        </SectionTitle>
        <div className="space-y-1.5">
          {!openFollowUps.length && <p className="text-xs text-soul-muted">No open follow-ups.</p>}
          {openFollowUps.map((f) => {
            const overdue = f.due_at < now;
            return (
              <div key={f.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${overdue ? 'border-rose-200 bg-rose-50' : 'border-soul-line bg-white'}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-soul-blue">
                    {fmtDateTime(f.due_at)} {overdue ? <Chip className="bg-rose-100 text-rose-700">Overdue</Chip> : null}
                  </div>
                  <div className="text-soul-muted">{f.note || '—'} · {f.assigned_name || ''}</div>
                </div>
                <button type="button" className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100" title="Done" onClick={() => closeFollowUp(f.id)}>
                  <Check className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-md p-1 text-soul-muted hover:bg-rose-100 hover:text-rose-700" title="Cancel" onClick={() => closeFollowUp(f.id, true)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <StageModal
        open={Boolean(stageTarget)}
        lead={lead}
        stage={stageTarget}
        needFollowUp={Boolean(stageTarget?.requires_follow_up && !hasFutureFollowUp)}
        onClose={() => setStageTarget(null)}
        onDone={() => { setStageTarget(null); onChanged?.(); }}
        onBook={canManageReservations ? () => setBooking({ unitId: lead.unit_id }) : null}
      />

      <Modal
        open={fuOpen}
        onClose={() => setFuOpen(false)}
        title="Add follow-up"
        size="sm"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setFuOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={addFollowUp}>Save</button>
          </>
        )}
      >
        <FollowUpFields value={fu} onChange={setFu} />
      </Modal>

      <ReservationFromLead
        open={Boolean(booking)}
        onClose={() => setBooking(null)}
        lead={lead}
        customer={customer}
        unitId={booking?.unitId}
        pricePerNight={booking?.pricePerNight}
        onCreated={() => onChanged?.()}
      />
    </div>
  );
}
