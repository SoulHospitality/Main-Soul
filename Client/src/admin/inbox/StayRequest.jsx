import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarPlus, Search } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { inboxApi, errorMessage } from './api';
import ReservationFromLead from './ReservationFromLead';
import { fmtMoney } from './utils';

/**
 * Stay request, kept to two jobs: see which units are free for the guest's dates,
 * and create the PMS reservation. The request record behind it is made automatically when booking.
 */
export default function StayRequest({ conversationId, lead, customer, onChanged }) {
  const { canManageReservations } = usePermissions();
  const [form, setForm] = useState({
    check_in: lead?.check_in || '',
    check_out: lead?.check_out || '',
    guests: lead?.guests ? String(lead.guests) : '',
    bedrooms: '',
  });
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(null); // { lead, unit }
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const nights = form.check_in && form.check_out ? Math.round((new Date(form.check_out) - new Date(form.check_in)) / 86400000) : 0;

  const search = async (e) => {
    e?.preventDefault();
    if (!form.check_in || !form.check_out || nights < 1) return toast.error('Choose check-in and check-out');
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      const res = await inboxApi.get('/availability', params);
      setItems(res.items || []);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const reserve = async (unit) => {
    try {
      // The reservation is linked to a stay request (for won/lost reports); make one if the chat has none.
      let current = lead;
      if (!current) {
        const res = await inboxApi.post(`/conversations/${conversationId}/leads`, {
          check_in: form.check_in,
          check_out: form.check_out,
          guests: form.guests ? Number(form.guests) : undefined,
        });
        current = res.lead;
      }
      setBooking({ lead: { ...current, check_in: form.check_in, check_out: form.check_out, guests: form.guests ? Number(form.guests) : current.guests }, unit });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-2">
      <form onSubmit={search} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Check-in</span>
            <input type="date" className="input h-9 py-1 text-xs" value={form.check_in} onChange={(e) => set({ check_in: e.target.value, check_out: form.check_out && form.check_out > e.target.value ? form.check_out : '' })} />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Check-out</span>
            <input type="date" className="input h-9 py-1 text-xs" min={form.check_in || undefined} value={form.check_out} onChange={(e) => set({ check_out: e.target.value })} />
          </label>
          <input type="number" min="1" className="input h-9 py-1 text-xs" placeholder="Guests" value={form.guests} onChange={(e) => set({ guests: e.target.value })} />
          <input type="number" min="1" className="input h-9 py-1 text-xs" placeholder="Bedrooms" value={form.bedrooms} onChange={(e) => set({ bedrooms: e.target.value })} />
        </div>
        <button type="submit" className="btn-secondary btn-sm w-full justify-center" disabled={loading}>
          <Search className="h-3.5 w-3.5" /> {loading ? 'Checking…' : nights > 0 ? `Free units for ${nights} night${nights === 1 ? '' : 's'}` : 'Find free units'}
        </button>
      </form>

      {items ? (
        items.length ? (
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {items.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">
                    {u.unit_number ? <span className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-600">{u.unit_number}</span> : null}
                    {u.title}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {u.compound} · {u.beds || '?'} BR · {u.guests || '?'} guests
                    {u.avg_per_night ? ` · ${fmtMoney(u.avg_per_night)}/night` : u.fully_priced === false ? ' · no price' : ''}
                  </p>
                </div>
                {canManageReservations ? (
                  <button type="button" className="btn-primary btn-sm shrink-0 py-1" onClick={() => reserve(u)}>
                    <CalendarPlus className="h-3 w-3" /> Reserve
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No free units for these dates.</p>
        )
      ) : null}

      {booking ? (
        <ReservationFromLead
          open
          onClose={() => setBooking(null)}
          lead={booking.lead}
          customer={customer}
          unitId={booking.unit.id}
          pricePerNight={booking.unit.avg_per_night}
          onCreated={() => {
            setBooking(null);
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
