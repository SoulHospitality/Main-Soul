import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarRange, Edit2, X, DollarSign, Eye, ExternalLink, Clock, Hourglass, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import { currency, formatDate, nightsText, BOOKING_SOURCES } from '../utils/formatters';
import { usePermissions } from '../hooks/usePermissions';
import SearchableSelect from '../components/ui/SearchableSelect';

// ─── helpers ────────────────────────────────────────────────────────────────
// Always use LOCAL date components — toISOString() converts to UTC which
// shifts the date backward by the timezone offset (e.g. UTC+2 → -1 day).
const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const todayStr = () => localISO(new Date());

// addDays: parse the input string as LOCAL midnight to avoid UTC shift
const addDays = (d, n) => {
  const [y, m, day] = String(d).split('-').map(Number);
  return localISO(new Date(y, m - 1, day + n));
};

const isoDate = (d) => localISO(d);

function getMonthDates(year, month) {
  const total = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: total }, (_, i) => new Date(year, month, i + 1));
}

function getWeekRange(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: isoDate(mon), to: isoDate(sun) };
}
function getMonthRange(dateStr) {
  const d = new Date(dateStr);
  return {
    from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)),
    to:   isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

// Normalize PostgreSQL timestamps → plain YYYY-MM-DD strings
const normDate = d => String(d).split('T')[0];

// Build cell rows: checkin / mid / checkout / price
// check-in and check-out each get their own cell; middle nights are colSpanned
function buildRow(unitId, dates, reservations) {
  const unitRes = reservations
    .filter(r => r.unit_id === unitId && r.status !== 'cancelled')
    .map(r => ({ ...r, check_in: normDate(r.check_in), check_out: normDate(r.check_out) }));

  const cells = [];
  let i = 0;

  while (i < dates.length) {
    const dStr = isoDate(dates[i]);

    // ── Check-in day ──────────────────────────────────────────────────
    const ciRes = unitRes.find(r => r.check_in === dStr);
    if (ciRes) {
      cells.push({ type: 'checkin', res: ciRes, date: dStr, unitId });
      i++;
      // Collect middle nights (after check-in, strictly before check-out)
      let span = 0;
      const midStart = i < dates.length ? isoDate(dates[i]) : null;
      while (i < dates.length && isoDate(dates[i]) < ciRes.check_out) { span++; i++; }
      if (span > 0) cells.push({ type: 'mid', res: ciRes, span, firstDate: midStart, unitId });
      // Check-out day (if it falls within the visible range)
      if (i < dates.length && isoDate(dates[i]) === ciRes.check_out) {
        cells.push({ type: 'checkout', res: ciRes, date: ciRes.check_out, unitId });
        i++;
      }
      continue;
    }

    // ── Mid of a reservation that started before the visible range ────
    const midRes = unitRes.find(r => r.check_in < dStr && r.check_out > dStr);
    if (midRes) {
      let span = 0;
      const midStart = dStr;
      while (i < dates.length && isoDate(dates[i]) < midRes.check_out) { span++; i++; }
      cells.push({ type: 'mid', res: midRes, span, firstDate: midStart, unitId });
      if (i < dates.length && isoDate(dates[i]) === midRes.check_out) {
        cells.push({ type: 'checkout', res: midRes, date: midRes.check_out, unitId });
        i++;
      }
      continue;
    }

    // ── Empty price cell ──────────────────────────────────────────────
    cells.push({ type: 'price', date: dStr, unitId });
    i++;
  }

  return cells;
}

// Color rules: hold(yellow) > red > orange > purple(blocked) > blue(owner) > green > grey
function resColors(res, today) {
  const tomorrow = addDays(today, 1);
  const co = normDate(res.check_out);
  const ci = normDate(res.check_in);
  const isBlocked = res.is_owner_reservation && parseFloat(res.total_amount) === 0;
  if (res.is_hold || res.status === 'hold')
                                 return { bg: 'bg-yellow-400',  text: 'text-yellow-900', hover: 'hover:bg-yellow-500' };
  if (co < today)               return { bg: 'bg-gray-300',    text: 'text-gray-700',   hover: 'hover:bg-gray-400'   };
  if (co === tomorrow)          return { bg: 'bg-red-500',     text: 'text-white',      hover: 'hover:bg-red-600'    };
  if (ci === tomorrow)          return { bg: 'bg-orange-400',  text: 'text-white',      hover: 'hover:bg-orange-500' };
  if (isBlocked)                return { bg: 'bg-purple-500',  text: 'text-white',      hover: 'hover:bg-purple-600' };
  if (res.is_owner_reservation) return { bg: 'bg-blue-500',   text: 'text-white',      hover: 'hover:bg-blue-600'   };
  return                               { bg: 'bg-emerald-500', text: 'text-white',      hover: 'hover:bg-emerald-600' };
}

const COLOR_FILTERS = [
  { value: '', label: 'All Reservations' },
  { value: 'hold',             label: '🟡 Hold' },
  { value: 'owner',            label: '🔵 Owner' },
  { value: 'sales',            label: '🟢 Sales' },
  { value: 'blocked',          label: '🟣 Blocked / Owner Stay' },
  { value: 'checkin_tomorrow', label: '🟠 Check-in Tomorrow' },
  { value: 'checkout_tomorrow',label: '🔴 Check-out Tomorrow' },
  { value: 'past',             label: '⚪ Past' },
];

// ─── Price Editor Modal ──────────────────────────────────────────────────────
function PriceEditorModal({ open, onClose, unitId, unitName, dateStr, currentPrice, onSave, onClear, saving }) {
  const [price, setPrice] = useState('');
  const [applyTo, setApplyTo] = useState('day');
  const [rangeFrom, setRangeFrom] = useState(dateStr || '');
  const [rangeTo, setRangeTo]   = useState(dateStr || '');

  // Reset when opened on new cell
  useEffect(() => { setPrice(currentPrice ? String(currentPrice) : ''); setApplyTo('day'); setRangeFrom(dateStr); setRangeTo(dateStr); }, [open, dateStr, currentPrice]);

  const getRange = () => {
    if (applyTo === 'day')    return { from: dateStr, to: dateStr };
    if (applyTo === 'week')   return getWeekRange(dateStr);
    if (applyTo === 'month')  return getMonthRange(dateStr);
    return { from: rangeFrom, to: rangeTo };
  };

  const handleSave = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) { toast.error('Enter a valid price'); return; }
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onSave(unitId, from, to, p);
  };

  const handleClear = () => {
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onClear(unitId, from, to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Nightly Price" size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        {currentPrice > 0 && (
          <button onClick={handleClear} disabled={saving} className="btn-secondary text-red-700 border-red-200 hover:bg-red-50">
            Clear / block
          </button>
        )}
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <DollarSign className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Apply Price'}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="bg-blue-50 rounded-lg px-4 py-2 text-sm text-blue-800">
          <span className="font-semibold">{unitName}</span>
          <span className="mx-2">·</span>{formatDate(dateStr)}
          {currentPrice > 0 && <span className="ml-2 text-blue-500">(current: {currency(currentPrice)})</span>}
        </div>

        <div>
          <label className="label">New Price per Night (EGP) *</label>
          <input type="number" min="0" step="0.01" autoFocus className="input text-lg font-semibold"
            value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label className="label">Apply to</label>
          <div className="grid grid-cols-2 gap-2">
            {[['day','This Day'],['week','This Week'],['month','This Month'],['range','Custom Range']].map(([v,l]) => (
              <button key={v} onClick={() => setApplyTo(v)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${applyTo === v ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-700 hover:border-primary-300'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {applyTo === 'range' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">From</label><input type="date" className="input" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className="input" value={rangeTo}   onChange={e => setRangeTo(e.target.value)}   /></div>
          </div>
        )}

        {applyTo !== 'day' && applyTo !== 'range' && (
          <p className="text-xs text-gray-400">
            {applyTo === 'week'  && `Mon – Sun of the week containing ${formatDate(dateStr)}`}
            {applyTo === 'month' && `All days of ${new Date(dateStr).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`}
          </p>
        )}

        <p className="text-xs text-gray-500">
          Clearing a price blocks that night for guests (same as the website calendar).
        </p>
      </div>
    </Modal>
  );
}

// ─── Reservation Detail Modal ────────────────────────────────────────────────
function ReservationDetailModal({ open, onClose, reservationId }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['reservation-detail', reservationId],
    queryFn: () => api.get(`/reservations/${reservationId}`).then(r => r.data),
    enabled: !!reservationId && open,
  });

  const paid = parseFloat(res?.amount_paid) || 0;
  const total = parseFloat(res?.total_amount) || 0;
  const remaining = total - paid;

  return (
    <Modal open={open} onClose={onClose} title={`Reservation #${reservationId}`} size="md"
      footer={<button onClick={onClose} className="btn-secondary">Close</button>}
    >
      {isLoading ? <LoadingSpinner /> : res ? (
        <div className="space-y-4">
          {/* Status badges */}
          <div className="flex gap-2 flex-wrap">
            <Badge status={res.status} />
            <Badge status={res.payment_status} />
            {res.is_owner_reservation && <span className="badge badge-blue">Owner Reservation</span>}
          </div>

          {/* Guest + unit */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Info label="Tenant"     value={res.guest_name} bold />
            <Info label="Unit"       value={res.unit_name} />
            <Info label="Phone"      value={res.guest_phone} />
            <Info label="Email"      value={res.guest_email} />
            <Info label="Source"     value={res.booking_source} />
            <Info label="Sales"      value={res.sales_person_name} />
          </div>

          {/* Dates + financials */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Info label="Check-in"   value={formatDate(res.check_in)} />
            <Info label="Check-out"  value={formatDate(res.check_out)} />
            <Info label="Nights"     value={nightsText(res.nights)} />
            <Info label="Price/Night" value={res.price_per_night > 0 ? currency(res.price_per_night) : '—'} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Total</p>
              <p className="font-bold text-gray-900 text-sm">{currency(total)}</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
              <p className="text-xs text-green-600 mb-1">Paid</p>
              <p className="font-bold text-green-700 text-sm">{currency(paid)}</p>
            </div>
            <div className={`border rounded-xl p-3 text-center ${remaining > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`text-xs mb-1 ${remaining > 0 ? 'text-red-500' : 'text-gray-400'}`}>Remaining</p>
              <p className={`font-bold text-sm ${remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>{currency(remaining)}</p>
            </div>
          </div>

          {res.notes && (
            <div className="bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Notes: </span>{res.notes}
            </div>
          )}
        </div>
      ) : <p className="text-gray-400 text-center py-8">Reservation not found</p>}
    </Modal>
  );
}

function Info({ label, value, bold }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-24 flex-shrink-0">{label}:</span>
      <span className={bold ? 'font-semibold text-gray-900' : 'text-gray-700'}>{value || '—'}</span>
    </div>
  );
}

// ─── Edit Reservation Modal (inline form) ────────────────────────────────────
function EditReservationModal({ open, onClose, editId, editForm, setEditForm, unitsList, usersList, onSave, saving }) {
  return (
    <Modal open={open} onClose={onClose} title={`Edit Reservation #${editId}`} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={onSave} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
      </>}
    >
      <div className="space-y-4">
        <div className="form-grid">
          <div>
            <label className="label">Unit *</label>
            <SearchableSelect value={editForm.unit_id} onChange={v => setEditForm(f => ({ ...f, unit_id: v }))}
              placeholder="Select…"
              options={[{ value: '', label: 'Select…' }, ...unitsList.map(u => ({ value: String(u.id), label: `${u.name} (${u.project})` }))]}
            />
          </div>
          <div><label className="label">Tenant Name *</label><input className="input" value={editForm.guest_name} onChange={e => setEditForm(f => ({ ...f, guest_name: e.target.value }))} /></div>
          <div><label className="label">Phone</label><input className="input" value={editForm.guest_phone} onChange={e => setEditForm(f => ({ ...f, guest_phone: e.target.value }))} /></div>
          <div>
            <label className="label">Booking Source</label>
            <SearchableSelect value={editForm.booking_source} onChange={v => setEditForm(f => ({ ...f, booking_source: v }))}
              placeholder="Select…"
              options={[{ value: '', label: 'Select…' }, ...BOOKING_SOURCES.map(s => ({ value: s, label: s }))]}
            />
          </div>
          <div><label className="label">Check-in *</label><input type="date" className="input" value={editForm.check_in} onChange={e => setEditForm(f => ({ ...f, check_in: e.target.value }))} /></div>
          <div><label className="label">Check-out *</label><input type="date" className="input" value={editForm.check_out} onChange={e => setEditForm(f => ({ ...f, check_out: e.target.value }))} /></div>
          <div><label className="label">Total (EGP)</label><input type="number" min="0" step="0.01" className="input" value={editForm.total_amount} onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))} /></div>
          <div>
            <label className="label">Status</label>
            <SearchableSelect value={editForm.status} onChange={v => setEditForm(f => ({ ...f, status: v }))}
              placeholder="Select…"
              options={['confirmed','checked_in','checked_out','cancelled'].map(s => ({ value: s, label: s.replace(/_/g,' ') }))}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="owner_sched" checked={!!editForm.is_owner_reservation} onChange={e => setEditForm(f => ({ ...f, is_owner_reservation: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
          <label htmlFor="owner_sched" className="text-sm text-gray-700 font-medium">Owner Reservation</label>
        </div>
        <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}

// ─── Hold Modal (create a hold) ───────────────────────────────────────────────
function HoldModal({ open, onClose, prefillUnit, prefillCheckIn, prefillCheckOut, unitsList, onSave, saving }) {
  const [unitId,     setUnitId]     = useState('');
  const [guestName,  setGuestName]  = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkIn,    setCheckIn]    = useState('');
  const [checkOut,   setCheckOut]   = useState('');
  const [preset,     setPreset]     = useState('24'); // hours
  const [customH,    setCustomH]    = useState('');

  useEffect(() => {
    if (open) {
      setUnitId(prefillUnit || '');
      setCheckIn(prefillCheckIn || '');
      setCheckOut(prefillCheckOut || '');
      setGuestName(''); setGuestPhone(''); setPreset('24'); setCustomH('');
    }
  }, [open, prefillUnit, prefillCheckIn, prefillCheckOut]);

  const hours = preset === 'custom' ? (parseInt(customH) || 24) : parseInt(preset);

  const holdUntilLabel = (() => {
    const d = new Date(Date.now() + hours * 3600000);
    return d.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  })();

  const handleSave = () => {
    if (!unitId || !checkIn || !checkOut) { toast.error('Unit, check-in, check-out required'); return; }
    if (checkOut <= checkIn) { toast.error('Check-out must be after check-in'); return; }
    onSave({ unit_id: unitId, guest_name: guestName || 'Hold', guest_phone: guestPhone || undefined, check_in: checkIn, check_out: checkOut, is_hold: '1', hold_hours: String(hours) });
  };

  return (
    <Modal open={open} onClose={onClose} title="🟡 Add Hold" size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <Hourglass className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Create Hold'}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5 text-xs text-yellow-800">
          الهولد بيحجز التواريخ مؤقتاً. لو ماتأكدش في المدة المحددة هيتشال أوتوماتيك.
        </div>

        <div>
          <label className="label">Unit *</label>
          <SearchableSelect value={unitId} onChange={setUnitId} placeholder="Select unit…"
            options={[{ value:'', label:'Select…' }, ...unitsList.map(u => ({ value: String(u.id), label: u.name }))]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Check-in *</label>
            <input type="date" className="input" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></div>
          <div><label className="label">Check-out *</label>
            <input type="date" className="input" value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Guest Name (optional)</label>
            <input type="text" className="input" placeholder="Hold" value={guestName} onChange={e => setGuestName(e.target.value)} /></div>
          <div><label className="label">Phone (optional)</label>
            <input type="text" className="input" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} /></div>
        </div>

        <div>
          <label className="label">Hold Duration</label>
          <div className="flex gap-2 flex-wrap">
            {[['24','24 hours'],['48','48 hours'],['72','72 hours'],['custom','Custom']].map(([v,l]) => (
              <button key={v} type="button" onClick={() => setPreset(v)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors
                  ${preset === v ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'border-gray-200 text-gray-600 hover:border-yellow-300'}`}>
                {l}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" min="1" max="720" className="input w-24 text-center"
                placeholder="24" value={customH} onChange={e => setCustomH(e.target.value)} />
              <span className="text-sm text-gray-500">hours</span>
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          Hold expires: <span className="font-semibold text-yellow-700">{holdUntilLabel}</span>
        </div>
      </div>
    </Modal>
  );
}

// ─── Hold Detail Modal ────────────────────────────────────────────────────────
function HoldDetailModal({ open, onClose, holdId, onConfirm, onDelete, deleting }) {
  const { data: hold, isLoading } = useQuery({
    queryKey: ['hold-detail', holdId],
    queryFn: () => api.get(`/reservations/${holdId}`).then(r => r.data),
    enabled: !!holdId && open,
    refetchInterval: open ? 30000 : false, // refresh every 30s to update countdown
  });

  const now = new Date();
  const holdUntil = hold?.hold_until ? new Date(hold.hold_until) : null;
  const msLeft = holdUntil ? holdUntil - now : null;
  const isExpired = msLeft !== null && msLeft <= 0;

  const timeLeftStr = (() => {
    if (!msLeft || isExpired) return 'Expired';
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h remaining`;
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
  })();

  return (
    <Modal open={open} onClose={onClose} title={`Hold #${holdId}`} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Close</button>
        {hold && !isExpired && (
          <button onClick={() => onConfirm(hold)} className="btn-primary">
            <Eye className="w-3.5 h-3.5" />Confirm as Reservation
          </button>
        )}
      </>}
    >
      {isLoading ? <div className="py-8 text-center text-gray-400 text-sm">Loading…</div> : hold ? (
        <div className="space-y-4">
          <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${isExpired ? 'bg-red-50 border border-red-100' : 'bg-yellow-50 border border-yellow-200'}`}>
            <Clock className={`w-5 h-5 flex-shrink-0 ${isExpired ? 'text-red-400' : 'text-yellow-500'}`} />
            <div>
              <p className={`font-semibold text-sm ${isExpired ? 'text-red-600' : 'text-yellow-800'}`}>{timeLeftStr}</p>
              <p className="text-xs text-gray-400">
                Expires: {holdUntil?.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex gap-2"><span className="text-gray-400 w-20">Unit:</span><span className="font-medium">{hold.unit_name}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Guest:</span><span>{hold.guest_name}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Check-in:</span><span>{formatDate(hold.check_in)}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Check-out:</span><span>{formatDate(hold.check_out)}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Nights:</span><span>{nightsText(hold.nights)}</span></div>
            {hold.guest_phone && <div className="flex gap-2"><span className="text-gray-400 w-20">Phone:</span><span>{hold.guest_phone}</span></div>}
          </div>

          <button onClick={() => onDelete(holdId)} disabled={deleting}
            className="w-full btn-danger flex items-center justify-center gap-2 text-sm">
            <Trash2 className="w-3.5 h-3.5" />{deleting ? 'Deleting…' : 'Delete Hold'}
          </button>
        </div>
      ) : <p className="text-gray-400 text-center py-8 text-sm">Hold not found</p>}
    </Modal>
  );
}

// ─── Main Schedule ────────────────────────────────────────────────────────────
const EMPTY_EDIT = { unit_id:'', guest_name:'', guest_email:'', guest_phone:'', guest_nationality:'', check_in:'', check_out:'', total_amount:'', price_per_night:'', booking_source:'', sales_person_id:'', is_owner_reservation: false, is_hold: false, status:'confirmed', notes:'' };

function BulkPriceModal({ open, onClose, unitCount, onSave, saving }) {
  const [price,     setPrice]     = useState('');
  const [applyTo,   setApplyTo]   = useState('day');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo,   setRangeTo]   = useState('');

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (open) { setPrice(''); setApplyTo('day'); setRangeFrom(today); setRangeTo(today); }
  }, [open]);

  const getRange = () => {
    if (applyTo === 'day')   return { from: today, to: today };
    if (applyTo === 'week')  return getWeekRange(today);
    if (applyTo === 'month') return getMonthRange(today);
    return { from: rangeFrom, to: rangeTo };
  };

  const handleSave = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) { toast.error('Enter a valid price'); return; }
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onSave(from, to, p);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Bulk Edit Price — ${unitCount} Unit${unitCount !== 1 ? 's' : ''}`} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || unitCount === 0} className="btn-primary">
          <DollarSign className="w-3.5 h-3.5" />{saving ? 'Saving…' : `Apply to ${unitCount} Unit${unitCount !== 1 ? 's' : ''}`}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="bg-indigo-50 rounded-lg px-4 py-2 text-sm text-indigo-800">
          This price will be applied to <strong>{unitCount} selected unit{unitCount !== 1 ? 's' : ''}</strong>.
        </div>

        <div>
          <label className="label">New Price per Night (EGP) *</label>
          <input type="number" min="0" step="0.01" autoFocus className="input text-lg font-semibold"
            value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label className="label">Apply to</label>
          <div className="grid grid-cols-2 gap-2">
            {[['day','Today'],['week','This Week'],['month','This Month'],['range','Custom Range']].map(([v,l]) => (
              <button key={v} onClick={() => setApplyTo(v)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${applyTo === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-700 hover:border-indigo-300'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {applyTo === 'range' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">From</label><input type="date" className="input" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className="input" value={rangeTo} onChange={e => setRangeTo(e.target.value)} /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Schedule() {
  const qc = useQueryClient();
  const { canEditSchedulePricing, canManageReservations } = usePermissions();
  const TODAY = todayStr();
  const TOMORROW = addDays(TODAY, 1);
  const now = new Date();

  // ── View state
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [spanMonths, setSpanMonths] = useState(2);

  // ── Filters
  const [filterBedrooms,  setFilterBedrooms]  = useState('');
  const [filterProject,   setFilterProject]   = useState('');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');
  const [filterColor,     setFilterColor]     = useState('');
  const [filterUnits,     setFilterUnits]     = useState([]);   // multi-select unit ids
  const [filterFloor,     setFilterFloor]     = useState('');
  const [filterPriceMin,  setFilterPriceMin]  = useState('');
  const [filterPriceMax,  setFilterPriceMax]  = useState('');
  const [filterAvailable, setFilterAvailable] = useState(false);
  const [unitPickerOpen,  setUnitPickerOpen]  = useState(false);
  const [unitPickerSearch, setUnitPickerSearch] = useState('');
  const unitPickerRef = useRef(null);
  useEffect(() => {
    if (!unitPickerOpen) return;
    const handler = (e) => { if (unitPickerRef.current && !unitPickerRef.current.contains(e.target)) { setUnitPickerOpen(false); setUnitPickerSearch(''); } };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [unitPickerOpen]);

  // ── Price editor state
  const [priceModal,        setPriceModal]        = useState(false);
  const [priceCell,         setPriceCell]         = useState(null); // { unitId, unitName, dateStr, currentPrice }

  // ── Bulk price editor state
  const [bulkMode,          setBulkMode]          = useState(false);
  const [selectedUnitIds,   setSelectedUnitIds]   = useState(new Set());
  const [bulkPriceModal,    setBulkPriceModal]    = useState(false);

  // ── Reservation detail state
  const [detailModal,       setDetailModal]       = useState(false);
  const [detailResId,       setDetailResId]       = useState(null);

  // ── Edit form state
  const [editModal,         setEditModal]         = useState(false);
  const [editId,            setEditId]            = useState(null);
  const [editForm,          setEditForm]          = useState(EMPTY_EDIT);

  // ── Mobile filter panel toggle
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Hold state
  const [holdModal,         setHoldModal]         = useState(false);
  const [holdPrefill,       setHoldPrefill]       = useState({});
  const [holdDetailModal,   setHoldDetailModal]   = useState(false);
  const [holdDetailId,      setHoldDetailId]      = useState(null);

  // ── Compute display dates (1–3 month horizon like soul-website admin calendar)
  const defaultFrom = isoDate(new Date(viewYear, viewMonth, 1));
  const defaultTo   = isoDate(new Date(viewYear, viewMonth + spanMonths, 1)); // exclusive
  const fromStr     = filterFrom || defaultFrom;
  const toStr       = filterTo ? addDays(filterTo, 1) : defaultTo;

  const displayDates = useMemo(() => {
    const days = [];
    for (let d = new Date(`${fromStr}T00:00:00`); isoDate(d) < toStr; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  }, [fromStr, toStr]);

  const monthLabel = useMemo(() => {
    const start = new Date(viewYear, viewMonth, 1);
    if (spanMonths === 1) {
      return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const end = new Date(viewYear, viewMonth + spanMonths - 1, 1);
    const a = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const b = end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${a} – ${b}`;
  }, [viewYear, viewMonth, spanMonths]);

  // ── Data fetching
  const { data, isLoading } = useQuery({
    queryKey: ['schedule', fromStr, toStr, filterBedrooms, filterProject],
    queryFn: () => api.get('/reservations/schedule', {
      params: { from_date: fromStr, to_date: toStr, bedrooms: filterBedrooms || undefined, project: filterProject || undefined },
    }).then(r => r.data),
  });

  const { data: dailyPricesRaw = [] } = useQuery({
    queryKey: ['daily-prices', fromStr, toStr],
    queryFn: () => api.get('/daily-prices', { params: { from_date: fromStr, to_date: toStr } }).then(r => r.data),
  });

  const { data: calendarBlocks = [] } = useQuery({
    queryKey: ['calendar-blocks', fromStr, toStr],
    queryFn: () => api.get('/calendar-blocks', { params: { from: fromStr, to: toStr } }).then(r => r.data),
  });

  const blockMap = useMemo(() => {
    const m = {};
    for (const b of calendarBlocks) {
      if (!m[b.unit_id]) m[b.unit_id] = {};
      m[b.unit_id][String(b.date).split('T')[0]] = b.source;
    }
    return m;
  }, [calendarBlocks]);

  const priceMap = useMemo(() => {
    const m = {};
    dailyPricesRaw.forEach(dp => {
      if (!m[dp.unit_id]) m[dp.unit_id] = {};
      // Normalize date: DB may return "2024-01-15T00:00:00.000Z" or plain "2024-01-15"
      const dateKey = String(dp.date).split('T')[0];
      m[dp.unit_id][dateKey] = parseFloat(dp.price);
    });
    return m;
  }, [dailyPricesRaw]);

  const getUnitDayPrice = (unit, dateStr) => {
    if (priceMap[unit.id]?.[dateStr] != null) return priceMap[unit.id][dateStr];
    // No fallback to unit default for guest-parity display — empty means unpriced
    return priceMap[unit.id]?.[dateStr] ?? null;
  };

  const { data: projectsList = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api.get('/units/projects').then(r => r.data) });
  const { data: unitsList     = [] } = useQuery({ queryKey: ['units'],    queryFn: () => api.get('/units').then(r => r.data) });
  const { data: usersList     = [] } = useQuery({ queryKey: ['users-sales'], queryFn: () => api.get('/users/sales').then(r => r.data) });

  // ── Mutations
  const priceMutation = useMutation({
    mutationFn: ({ unit_id, from_date, to_date, price, clear }) =>
      api.post('/daily-prices/batch', { unit_id, from_date, to_date, price, clear: !!clear }),
    onSuccess: (_, { unit_id, from_date, to_date, price, clear }) => {
      const updatedDates = [];
      const [fy, fm, fd] = String(from_date).split('-').map(Number);
      const [ty, tm, td] = String(to_date).split('-').map(Number);
      const cur = new Date(fy, fm - 1, fd);
      const end = new Date(ty, tm - 1, td);
      while (cur <= end) {
        updatedDates.push(localISO(cur));
        cur.setDate(cur.getDate() + 1);
      }
      const updatedSet = new Set(updatedDates);

      qc.setQueryData(['daily-prices', fromStr, toStr], (old = []) => {
        const kept = old.filter(dp =>
          !(dp.unit_id === unit_id && updatedSet.has(String(dp.date).split('T')[0]))
        );
        if (clear) return kept;
        const fresh = updatedDates.map(date => ({
          unit_id,
          date,
          price: parseFloat(price),
        }));
        return [...kept, ...fresh];
      });

      toast.success(clear ? 'Price cleared — nights blocked for guests' : 'Price updated');
      setPriceModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving price'),
  });

  const editMutation = useMutation({
    mutationFn: () => api.put(`/reservations/${editId}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservation-detail', editId] });
      toast.success('Reservation updated');
      setEditModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const holdMutation = useMutation({
    mutationFn: (data) => api.post('/reservations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Hold created');
      setHoldModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error creating hold'),
  });

  const deleteHoldMutation = useMutation({
    mutationFn: (id) => api.delete(`/reservations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Hold deleted');
      setHoldDetailModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting hold'),
  });

  // ── Handlers
  const goPrevMonth = () => { if (viewMonth === 0) { setViewYear(y=>y-1); setViewMonth(11); } else setViewMonth(m=>m-1); };
  const goNextMonth = () => { if (viewMonth === 11) { setViewYear(y=>y+1); setViewMonth(0);  } else setViewMonth(m=>m+1); };
  const goThisMonth = () => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); };

  const hasFilters = filterBedrooms || filterProject || filterFrom || filterTo || filterColor || filterUnits.length || filterFloor || filterPriceMin || filterPriceMax || filterAvailable;
  const clearFilters = () => { setFilterBedrooms(''); setFilterProject(''); setFilterFrom(''); setFilterTo(''); setFilterColor(''); setFilterUnits([]); setFilterFloor(''); setFilterPriceMin(''); setFilterPriceMax(''); setFilterAvailable(false); };

  const handlePriceClick = useCallback((unit, dateStr) => {
    if (!canEditSchedulePricing) return;
    setPriceCell({ unitId: unit.id, unitName: unit.name, dateStr, currentPrice: getUnitDayPrice(unit, dateStr) });
    setPriceModal(true);
  }, [canEditSchedulePricing, priceMap]);

  const handleResClick = useCallback((res) => {
    // Hold cells → hold detail modal
    if (res.is_hold || res.status === 'hold') {
      setHoldDetailId(res.id);
      setHoldDetailModal(true);
      return;
    }
    setDetailResId(res.id);
    setDetailModal(true);
  }, []);

  const openEditFromDetail = useCallback(async (res) => {
    try {
      const isHold = !!(res.is_hold || res.status === 'hold');
      setEditForm({
        unit_id: res.unit_id, guest_name: isHold && res.guest_name === 'Hold' ? '' : (res.guest_name || ''),
        guest_email: res.guest_email || '',
        guest_phone: res.guest_phone || '', guest_nationality: res.guest_nationality || '',
        check_in: normDate(res.check_in), check_out: normDate(res.check_out),
        total_amount: isHold ? '' : res.total_amount,
        price_per_night: res.price_per_night || '',
        booking_source: res.booking_source || '', sales_person_id: res.sales_person_id || '',
        is_owner_reservation: !!res.is_owner_reservation,
        // When confirming a hold, mark is_hold=false so backend converts it
        is_hold: isHold ? false : undefined,
        status: isHold ? 'confirmed' : res.status,
        notes: res.notes || '',
      });
      setEditId(res.id);
      setHoldDetailModal(false); // close hold modal if open
      setEditModal(true);
    } catch { toast.error('Failed to load reservation'); }
  }, []);

  const bulkPriceMutation = useMutation({
    mutationFn: async ({ unit_ids, from_date, to_date, price }) => {
      await Promise.all(unit_ids.map(uid =>
        api.post('/daily-prices/batch', { unit_id: uid, from_date, to_date, price })
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries(['daily-prices']);
      setBulkPriceModal(false);
      setBulkMode(false);
      setSelectedUnitIds(new Set());
      toast.success('Price updated for selected units');
    },
    onError: () => toast.error('Failed to update some prices'),
  });

  const canWrite      = canManageReservations;
  const canEditPrice  = canEditSchedulePricing;

  // ── Helper: parse unit_number prefix into sort key
  // Order: SA(0) → ST3,ST4,ST5...(1,subgroup=num) → CL1,CL2...(2,subgroup=num) → F(3) → other(99)
  const parseUnitCode = (unitNumber = '') => {
    const s = String(unitNumber).trim().toUpperCase();
    if (/^SA/i.test(s)) {
      // Extract floor from SA-{floor}{section}-... e.g. SA-3A-B01 → floor=3, section=A
      const rest = s.replace(/^SA[-]?/, '');
      const m = rest.match(/^(\d+)([A-Z]?)/);
      return { group: 0, subGroup: 0, floor: m ? parseInt(m[1]) : 0, section: m ? (m[2] || '') : '', raw: s };
    }
    if (/^ST\d/i.test(s)) {
      const m = s.match(/^ST(\d+)/i);
      return { group: 1, subGroup: m ? parseInt(m[1]) : 0, floor: 0, section: '', raw: s };
    }
    if (/^CL\d/i.test(s)) {
      const m = s.match(/^CL(\d+)/i);
      return { group: 2, subGroup: m ? parseInt(m[1]) : 0, floor: 0, section: '', raw: s };
    }
    if (/^F\d/i.test(s)) {
      const m = s.match(/^F(\d+)/i);
      return { group: 3, subGroup: m ? parseInt(m[1]) : 0, floor: 0, section: '', raw: s };
    }
    return { group: 99, subGroup: 0, floor: 0, section: '', raw: s };
  };

  // ── Helper: extract available floors from unit.floor field
  const availableFloors = useMemo(() => {
    const floors = new Set();
    (data?.units || []).forEach(u => {
      const f = parseInt(u.floor);
      if (!isNaN(f) && f >= 0) floors.add(f);
    });
    return Array.from(floors).sort((a, b) => a - b);
  }, [data]);

  // ── Sort: SA → ST3,ST4,ST5... → CL1,CL2... → F → other
  // Within SA: sort by floor (1<2<3...) then section letter (A<B)
  // Within ST/CL: sort by subGroup number, then alphanumeric by unit_number
  const sortUnits = (units) => [...units].sort((a, b) => {
    const pA = parseUnitCode(a.unit_number);
    const pB = parseUnitCode(b.unit_number);
    if (pA.group    !== pB.group)    return pA.group    - pB.group;
    if (pA.subGroup !== pB.subGroup) return pA.subGroup - pB.subGroup;
    if (pA.group === 0) { // SA: sort by floor then section
      if (pA.floor   !== pB.floor)   return pA.floor    - pB.floor;
      if (pA.section !== pB.section) return pA.section.localeCompare(pB.section);
    }
    return pA.raw.localeCompare(pB.raw, undefined, { numeric: true });
  });

  // ── Combined unit filters (color + units + floor + price + available) + sort
  const allReservations = data?.reservations || [];
  const filteredUnits = useMemo(() => {
    const priceMin = filterPriceMin !== '' ? parseFloat(filterPriceMin) : null;
    const priceMax = filterPriceMax !== '' ? parseFloat(filterPriceMax) : null;
    const filtered = (data?.units || []).filter(unit => {
      // ── Multi-unit picker filter
      if (filterUnits.length > 0 && !filterUnits.includes(String(unit.id))) return false;

      // ── Floor filter
      if (filterFloor !== '' && filterFloor !== undefined) {
        if (parseInt(unit.floor) !== parseInt(filterFloor)) return false;
      }

      // ── Price range filter
      const unitPrice = parseFloat(unit.price_per_night) || 0;
      if (priceMin !== null && unitPrice < priceMin) return false;
      if (priceMax !== null && unitPrice > priceMax) return false;

      const ur = allReservations.filter(r => r.unit_id === unit.id && r.status !== 'cancelled');
      const lastD  = displayDates[displayDates.length - 1];
      const firstD = displayDates[0];
      if (!lastD || !firstD) return true;
      const last  = isoDate(lastD);
      const first = isoDate(firstD);

      // ── Available-only filter
      if (filterAvailable) {
        const hasOverlap = ur.some(r => normDate(r.check_in) < toStr && normDate(r.check_out) > fromStr);
        if (hasOverlap) return false;
      }

      // ── Color filter
      if (!filterColor) return true;
      if (filterColor === 'hold')              return ur.some(r => (r.is_hold || r.status === 'hold') && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'blocked')           return ur.some(r => r.is_owner_reservation && !r.is_hold && parseFloat(r.total_amount) === 0 && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'owner')             return ur.some(r => r.is_owner_reservation && !r.is_hold && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'sales')             return ur.some(r => !r.is_owner_reservation && !r.is_hold && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'checkout_tomorrow') return ur.some(r => !r.is_hold && normDate(r.check_out) === TOMORROW);
      if (filterColor === 'checkin_tomorrow')  return ur.some(r => !r.is_hold && normDate(r.check_in)  === TOMORROW);
      if (filterColor === 'past')              return ur.some(r => !r.is_hold && normDate(r.check_out) <= TODAY);
      return true;
    });
    return sortUnits(filtered);
  }, [data, filterColor, filterUnits, filterFloor, filterPriceMin, filterPriceMax, filterAvailable, allReservations, displayDates, fromStr, toStr, TODAY, TOMORROW]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">Reservation Calendar</h1>
          <p className="page-subtitle text-xs">
            {filterFrom || filterTo
              ? `${formatDate(fromStr)} — ${filterTo ? formatDate(filterTo) : formatDate(addDays(toStr, -1))}`
              : monthLabel}
            {canEditPrice && <span className="ml-2 text-primary-500">· Click a night to set/clear price</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <button onClick={() => { setHoldPrefill({}); setHoldModal(true); }}
              className="btn-secondary flex items-center gap-2 text-sm border-yellow-300 text-yellow-700 hover:bg-yellow-50">
              <Hourglass className="w-4 h-4" /><span className="hidden lg:inline">Add Hold</span><span className="lg:hidden">Hold</span>
            </button>
          )}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSpanMonths(n)}
                className={`px-2.5 py-1.5 text-xs font-semibold ${
                  spanMonths === n ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {n} mo
              </button>
            ))}
          </div>
          <button onClick={goThisMonth} className="btn-secondary text-sm px-3 py-1.5 hidden lg:inline-flex">This Month</button>
          <div className="flex items-center gap-1">
            <button onClick={goPrevMonth} className="btn-secondary p-2"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold text-gray-700 min-w-[110px] lg:min-w-[160px] text-center">{monthLabel}</span>
            <button onClick={goNextMonth} className="btn-secondary p-2"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500 px-1">
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-[#e6f7ee] border border-[#b7e4c7]" /> Priced</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-[#fdecea] border border-[#f5c2c0]" /> Unpriced (blocked for guests)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm border border-gray-300" style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(40,63,94,0.16) 0 3px, transparent 3px 7px)' }} /> OTA / manual block</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-emerald-500" /> Reservation</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-yellow-400" /> Hold</span>
      </div>

      {/* ── Filters */}
      <div className="card p-3">
        {/* Mobile: toggle button */}
        <button
          className="lg:hidden w-full flex items-center justify-between text-sm font-medium text-gray-700 mb-2"
          onClick={() => setFiltersOpen(v => !v)}
        >
          <span>Filters & Search</span>
          <span className="text-gray-400">{filtersOpen ? '▲' : '▼'}</span>
        </button>
        <div className={`flex flex-wrap items-end gap-3 ${filtersOpen ? '' : 'hidden lg:flex'}`}>
          <div><label className="label text-xs">Project</label>
            <SearchableSelect className="w-44" value={filterProject} onChange={v => { setFilterProject(v); setFilterUnits([]); }}
              placeholder="All Projects"
              options={[{ value: '', label: 'All Projects' }, ...projectsList.map(p => ({ value: p, label: p }))]}
            />
          </div>
          <div><label className="label text-xs">Bedrooms</label>
            <SearchableSelect className="w-32" value={filterBedrooms} onChange={setFilterBedrooms}
              placeholder="All"
              options={[{ value: '', label: 'All' }, ...[0,1,2,3,4,5,6].map(n => ({ value: String(n), label: n === 0 ? 'Studio' : `${n} BR` }))]}
            />
          </div>
          {/* ── Floor filter ─────────────────────────────────────────── */}
          <div><label className="label text-xs">Floor</label>
            <SearchableSelect className="w-28" value={filterFloor} onChange={setFilterFloor}
              placeholder="All"
              options={[{ value: '', label: 'All' }, ...availableFloors.map(f => ({ value: String(f), label: f === 0 ? 'Ground' : `Floor ${f}` }))]}
            />
          </div>
          <div><label className="label text-xs">From Date</label>
            <input type="date" className="input w-38" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
          </div>
          <div><label className="label text-xs">To Date</label>
            <input type="date" className="input w-38" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
          </div>
          {/* ── Price range filter ────────────────────────────────────── */}
          <div><label className="label text-xs">Price From (EGP)</label>
            <input type="number" min="0" step="100" className="input w-32" placeholder="Any" value={filterPriceMin} onChange={e => setFilterPriceMin(e.target.value)} />
          </div>
          <div><label className="label text-xs">Price To (EGP)</label>
            <input type="number" min="0" step="100" className="input w-32" placeholder="Any" value={filterPriceMax} onChange={e => setFilterPriceMax(e.target.value)} />
          </div>
          {/* ── Multi-unit picker ──────────────────────────────────────── */}
          <div className="relative" ref={unitPickerRef}><label className="label text-xs">Units</label>
            <button
              type="button"
              onClick={() => { setUnitPickerOpen(v => !v); setUnitPickerSearch(''); }}
              className={`input w-44 text-left flex items-center justify-between gap-2 cursor-pointer
                ${filterUnits.length > 0 ? 'border-primary-400 bg-primary-50' : ''}`}
            >
              <span className="truncate text-sm">
                {filterUnits.length === 0 ? 'All Units' : `${filterUnits.length} selected`}
              </span>
              <span className="text-gray-400 text-xs">▾</span>
            </button>
            {unitPickerOpen && (
              <div className="absolute z-50 top-full mt-1 left-0 w-56 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search units…"
                    value={unitPickerSearch}
                    onChange={e => setUnitPickerSearch(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-primary-400"
                    onClick={e => e.stopPropagation()}
                  />
                  {filterUnits.length > 0 && (
                    <button onClick={() => setFilterUnits([])} className="text-xs text-primary-600 hover:underline whitespace-nowrap">Clear</button>
                  )}
                </div>
                {(() => {
                  const q = unitPickerSearch.trim().toLowerCase();
                  const pool = sortUnits((data?.units || []).filter(u => !filterProject || u.project === filterProject));
                  const visible = q ? pool.filter(u => u.name.toLowerCase().includes(q) || (u.unit_number || '').toLowerCase().includes(q)) : pool;
                  if (visible.length === 0) return <p className="px-3 py-4 text-sm text-gray-400 text-center">No units found</p>;
                  return visible.map(u => {
                    const isChecked = filterUnits.includes(String(u.id));
                    return (
                      <label key={u.id} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${isChecked ? 'bg-primary-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => setFilterUnits(prev =>
                            prev.includes(String(u.id)) ? prev.filter(id => id !== String(u.id)) : [...prev, String(u.id)]
                          )}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{u.name}</div>
                          <div className="text-xs text-gray-400">{u.unit_number} · {u.project}</div>
                        </div>
                      </label>
                    );
                  });
                })()}
              </div>
            )}
          </div>
          {/* ── Available only toggle ────────────────────────────────── */}
          <div className="flex flex-col justify-end">
            <label className="label text-xs opacity-0 select-none">_</label>
            <button
              onClick={() => setFilterAvailable(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap
                ${filterAvailable
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'}`}
            >
              <span className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center flex-shrink-0
                ${filterAvailable ? 'bg-white border-white' : 'border-gray-400'}`}>
                {filterAvailable && <span className="block w-2 h-2 bg-emerald-500 rounded-sm" />}
              </span>
              Available Only
            </button>
          </div>
          <div><label className="label text-xs">Color Filter</label>
            <SearchableSelect className="w-52" value={filterColor} onChange={setFilterColor}
              placeholder="All Reservations"
              options={COLOR_FILTERS.map(cf => ({ value: cf.value, label: cf.label }))}
            />
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary flex items-center gap-1.5 text-sm">
              <X className="w-3.5 h-3.5" />Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Legend */}
      <div className="hidden lg:flex flex-wrap items-center gap-4 text-xs">
        {[
          ['bg-yellow-400','Hold'],
          ['bg-red-500','Checkout Tomorrow'],
          ['bg-orange-400','Check-in Tomorrow'],
          ['bg-purple-500','Blocked / Owner Stay'],
          ['bg-blue-500','Owner Reservation'],
          ['bg-emerald-500','Sales'],
          ['bg-gray-300','Past'],
        ].map(([c,l])=>(
          <div key={l} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${c}`}/><span className="text-gray-600">{l}</span></div>
        ))}
        {canEditPrice && (
          <div className="flex items-center gap-1.5 ml-2">
            <DollarSign className="w-3 h-3 text-primary-400"/>
            <span className="text-primary-600">Click empty cell → edit price</span>
          </div>
        )}
        {canEditPrice && !bulkMode && (
          <button
            onClick={() => { setBulkMode(true); setSelectedUnitIds(new Set()); }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-medium hover:bg-indigo-100 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />Bulk Edit Price
          </button>
        )}
        {canEditPrice && bulkMode && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-indigo-600 font-medium">{selectedUnitIds.size} unit{selectedUnitIds.size !== 1 ? 's' : ''} selected</span>
            <button
              onClick={() => setSelectedUnitIds(new Set(filteredUnits.map(u => u.id)))}
              className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs hover:bg-gray-200 transition-colors"
            >Select All</button>
            <button
              onClick={() => setSelectedUnitIds(new Set())}
              className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs hover:bg-gray-200 transition-colors"
            >Clear</button>
            <button
              disabled={selectedUnitIds.size === 0}
              onClick={() => setBulkPriceModal(true)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >Apply Price to {selectedUnitIds.size} Unit{selectedUnitIds.size !== 1 ? 's' : ''}</button>
            <button
              onClick={() => { setBulkMode(false); setSelectedUnitIds(new Set()); }}
              className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs hover:bg-gray-200 transition-colors"
            >Cancel</button>
          </div>
        )}
      </div>

      {/* ── Calendar grid */}
      {isLoading ? <LoadingSpinner /> : (
        <div className="card p-0 shadow-sm" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '75vh' }}>
          <table className="w-full text-sm border-collapse" style={{ minWidth: Math.max(500, 120 + displayDates.length * 38) }}>
            <thead className="sticky top-0 z-30">
              <tr className="bg-gray-50 border-b border-gray-200">
                {/* Unit column header */}
                <th className="sticky left-0 z-40 bg-gray-50 border-r border-gray-200 px-2 lg:px-4 py-3 text-left min-w-[110px] lg:min-w-[200px] font-semibold text-gray-700">
                  <div className="flex items-center gap-2"><CalendarRange className="w-4 h-4 text-gray-400" />Unit</div>
                </th>
                {displayDates.map((d, i) => {
                  const dStr = isoDate(d);
                  const isToday    = dStr === TODAY;
                  const isTomorrow = dStr === TOMORROW;
                  const isWeekend  = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th key={i} style={{ minWidth: 38 }}
                      className={`border-r border-gray-100 px-0 py-1.5 text-center font-medium
                        ${isToday    ? 'bg-primary-100 text-primary-700 border-primary-200'
                        : isTomorrow ? 'bg-orange-50 text-orange-700'
                        : isWeekend  ? 'bg-amber-50/60 text-amber-700'
                                     : 'text-gray-500'}`}>
                      <div className="text-[11px] font-bold leading-tight">{d.getDate()}</div>
                      <div className="text-[9px] opacity-60 hidden lg:block">{d.toLocaleDateString('en-GB',{weekday:'short'})}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredUnits.map(unit => {
                const cells = buildRow(unit.id, displayDates, allReservations);
                return (
                  <tr key={unit.id} className="border-b border-gray-100 hover:bg-gray-50/40 transition-colors">
                    {/* Unit name — sticky left */}
                    <td className="sticky left-0 z-10 bg-white border-r border-gray-200 px-2 lg:px-4 py-1.5 lg:py-2">
                      {bulkMode && (
                        <label className="flex items-center gap-2 cursor-pointer mb-1">
                          <input type="checkbox"
                            checked={selectedUnitIds.has(unit.id)}
                            onChange={e => setSelectedUnitIds(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(unit.id) : next.delete(unit.id);
                              return next;
                            })}
                            className="w-4 h-4 rounded accent-indigo-600"
                          />
                        </label>
                      )}
                      <div className="text-xs lg:text-sm font-semibold text-gray-900 leading-tight truncate max-w-[100px] lg:max-w-none">{unit.name}</div>
                      <div className="text-[10px] lg:text-xs text-gray-400 hidden lg:flex items-center gap-1">
                        {unit.unit_number} · {unit.project}{unit.bedrooms > 0 ? ` · ${unit.bedrooms}BR` : ' · Studio'}
                        {unit.photos_link && (
                          <a href={unit.photos_link} target="_blank" rel="noreferrer"
                            className="ml-0.5 text-primary-400 hover:text-primary-600 transition-colors flex-shrink-0"
                            title="View Photos"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-[9px] text-gray-400 lg:hidden truncate max-w-[100px]">
                        {unit.unit_number}
                      </div>
                      {(unit.view || (unit.floor !== null && unit.floor !== undefined)) && (
                        <div className="text-[10px] lg:text-xs text-indigo-400 mt-0.5 truncate max-w-[100px] lg:max-w-[190px] hidden lg:block">
                          {[unit.view, unit.floor !== null && unit.floor !== undefined ? (parseInt(unit.floor) === 0 ? 'Ground' : `Floor ${unit.floor}`) : null].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>

                    {/* Calendar cells */}
                    {cells.map((cell, j) => {

                      // ── Price cell ──────────────────────────────────────────────
                      if (cell.type === 'price') {
                        const price = getUnitDayPrice(unit, cell.date);
                        const blockSrc = blockMap[unit.id]?.[cell.date];
                        const isToday    = cell.date === TODAY;
                        const isPast     = cell.date < TODAY;
                        const isPriced   = price != null && price > 0;
                        const hasCheckinTomorrow = cell.date === TODAY && allReservations.some(r => r.unit_id === unit.id && normDate(r.check_in) === TOMORROW);
                        const hatch = 'repeating-linear-gradient(45deg, rgba(40,63,94,0.16) 0 3px, transparent 3px 7px)';
                        let cellBg = '';
                        if (blockSrc) cellBg = '';
                        else if (isPriced) cellBg = 'bg-[#e6f7ee]';
                        else if (!isPast) cellBg = 'bg-[#fdecea]';
                        return (
                          <td key={j} style={{
                            minWidth: 38,
                            ...(blockSrc ? { backgroundImage: hatch } : {}),
                          }}
                            className={`border-r border-gray-100 p-0 text-center align-middle
                              ${cellBg}
                              ${isPast ? 'opacity-50' : ''}
                              ${isToday ? 'ring-1 ring-inset ring-primary-400' : ''}
                              ${hasCheckinTomorrow && !blockSrc ? 'bg-orange-50' : ''}
                              ${canEditPrice && !isPast ? 'cursor-pointer group hover:brightness-95' : ''}`}
                            onClick={() => canEditPrice && !isPast && handlePriceClick(unit, cell.date)}
                            title={
                              blockSrc
                                ? `${blockSrc === 'ical' ? 'OTA (iCal)' : 'Manual'} block · ${formatDate(cell.date)}`
                                : isPriced
                                  ? `${currency(price)} · ${formatDate(cell.date)}`
                                  : `No price — guests see unavailable · ${formatDate(cell.date)}`
                            }
                          >
                            <div className={`py-1 h-9 flex flex-col items-center justify-center relative
                              ${hasCheckinTomorrow ? 'text-orange-700' : isPriced ? 'text-[#0f7d3a]' : 'text-red-300'}`}>
                              {hasCheckinTomorrow && <span className="text-orange-500 text-xs leading-none mb-0.5">⚑</span>}
                              {blockSrc && !isPriced ? (
                                <span className="text-[9px] text-violet-600 font-semibold">{blockSrc === 'ical' ? 'OTA' : 'BLK'}</span>
                              ) : isPriced ? (
                                <span className="text-[10px] font-bold leading-none">
                                  {price >= 1000 ? `${(price / 1000).toFixed(price % 1000 === 0 ? 0 : 1)}k` : price}
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium">—</span>
                              )}
                              {canEditPrice && !isPast && <Edit2 className="w-2.5 h-2.5 absolute bottom-1 right-1 opacity-0 group-hover:opacity-40 text-primary-500" />}
                            </div>
                          </td>
                        );
                      }

                      const { bg, text, hover } = resColors(cell.res, TODAY);
                      const tipText = `${cell.res.guest_name}\n${formatDate(normDate(cell.res.check_in))} → ${formatDate(normDate(cell.res.check_out))}\n${nightsText(cell.res.nights)} · ${currency(cell.res.total_amount)}`;

                      // ── Check-in cell: bar fills right 50%, left-rounded cap ──
                      if (cell.type === 'checkin') {
                        return (
                          <td key={j} style={{ minWidth: 38 }}
                            className="border-r border-gray-100 p-0 align-middle">
                            <div className="h-9 flex items-center">
                              {/* Left half — empty */}
                              <div className="w-1/2 h-full" />
                              {/* Right half — reservation starts */}
                              <div
                                className={`flex-1 h-6 ${bg} ${hover} rounded-l-full cursor-pointer transition-all`}
                                title={tipText}
                                onClick={() => handleResClick(cell.res)}
                              />
                            </div>
                          </td>
                        );
                      }

                      // ── Mid cell: full-width bar with guest name (colSpan) ────
                      if (cell.type === 'mid') {
                        return (
                          <td key={j} colSpan={cell.span} style={{ minWidth: 38 * cell.span }}
                            className="border-r border-gray-100 p-0 align-middle">
                            <div
                              className={`${bg} ${text} ${hover} h-6 my-1.5 mx-0 flex items-center justify-between px-1 cursor-pointer transition-all`}
                              title={tipText}
                              onClick={() => handleResClick(cell.res)}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Eye className="w-3 h-3 flex-shrink-0 opacity-70" />
                                <span className="text-xs font-semibold truncate">{cell.res.guest_name}</span>
                              </div>
                              {cell.span > 2 && (
                                <span className="text-xs opacity-60 flex-shrink-0 truncate max-w-[80px]">
                                  {cell.res.is_owner_reservation ? 'Owner' : (cell.res.sales_person_name || '')}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      }

                      // ── Check-out cell: bar fills left 25%, right-rounded cap ─
                      if (cell.type === 'checkout') {
                        return (
                          <td key={j} style={{ minWidth: 38 }}
                            className="border-r border-gray-100 p-0 align-middle">
                            <div className="h-9 flex items-center">
                              {/* Left quarter — reservation ends */}
                              <div
                                className={`w-1/4 h-6 ${bg} ${hover} rounded-r-full cursor-pointer transition-all`}
                                title={tipText}
                                onClick={() => handleResClick(cell.res)}
                              />
                              {/* Right 3/4 — empty */}
                              <div className="flex-1 h-full" />
                            </div>
                          </td>
                        );
                      }
                    })}
                  </tr>
                );
              })}
              {filteredUnits.length === 0 && (
                <tr>
                  <td colSpan={displayDates.length + 1} className="text-center py-16 text-gray-400">
                    {(data?.units || []).length === 0
                      ? 'No units found — add units in the Units page first'
                      : 'No units match the selected filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Footnote */}
      <p className="text-xs text-gray-400 text-right">
        Green = priced night · Red = unpriced (guests can&apos;t book) · Hatched = OTA/manual block · Bars = reservations/holds
      </p>

      {/* ── Modals */}
      <PriceEditorModal
        open={priceModal}
        onClose={() => setPriceModal(false)}
        unitId={priceCell?.unitId}
        unitName={priceCell?.unitName}
        dateStr={priceCell?.dateStr}
        currentPrice={priceCell?.currentPrice}
        saving={priceMutation.isPending}
        onSave={(unitId, from, to, price) => priceMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, price })}
        onClear={(unitId, from, to) => priceMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: true })}
      />

      <ReservationDetailModal
        open={detailModal}
        onClose={() => setDetailModal(false)}
        reservationId={detailResId}
      />

      <EditReservationModal
        open={editModal}
        onClose={() => setEditModal(false)}
        editId={editId}
        editForm={editForm}
        setEditForm={setEditForm}
        unitsList={unitsList}
        usersList={usersList}
        saving={editMutation.isPending}
        onSave={() => editMutation.mutate()}
      />

      <HoldModal
        open={holdModal}
        onClose={() => setHoldModal(false)}
        prefillUnit={holdPrefill.unitId}
        prefillCheckIn={holdPrefill.checkIn}
        prefillCheckOut={holdPrefill.checkOut}
        unitsList={unitsList}
        saving={holdMutation.isPending}
        onSave={(data) => holdMutation.mutate(data)}
      />

      <BulkPriceModal
        open={bulkPriceModal}
        onClose={() => setBulkPriceModal(false)}
        unitCount={selectedUnitIds.size}
        saving={bulkPriceMutation.isPending}
        onSave={(from, to, price) => bulkPriceMutation.mutate({ unit_ids: [...selectedUnitIds], from_date: from, to_date: to, price })}
      />

      <HoldDetailModal
        open={holdDetailModal}
        onClose={() => setHoldDetailModal(false)}
        holdId={holdDetailId}
        onConfirm={(hold) => openEditFromDetail(hold)}
        onDelete={(id) => deleteHoldMutation.mutate(id)}
        deleting={deleteHoldMutation.isPending}
      />
    </div>
  );
}
