import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarRange, Edit2, X, DollarSign, Eye, ExternalLink, Clock, Hourglass, Trash2, Plus, Ban, ArrowRightLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import { currency, formatDate, nightsText, BOOKING_SOURCES, unitDisplay, unitSelectLabel } from '../utils/formatters';
import { usePermissions } from '../hooks/usePermissions';
import SearchableSelect from '../components/ui/SearchableSelect';
import AdminReservationDrawer from '../components/AdminReservationDrawer';
import ManualReservationForm, {
  EMPTY_MANUAL_RESERVATION_FORM,
} from '../components/ManualReservationForm';
import TransferReservationModal from '../components/TransferReservationModal';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
import { useAuth } from '../context/AuthContext';
import { isoDateOnly } from '../../utils/stayNights';




const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const todayStr = () => localISO(new Date());


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


const normDate = (d) => isoDateOnly(d);



function buildRow(unitId, dates, reservations) {
  const unitRes = reservations
    .filter((r) => r.unit_id === unitId)
    .map((r) => ({ ...r, check_in: normDate(r.check_in), check_out: normDate(r.check_out) }));

  const cells = [];
  let i = 0;

  while (i < dates.length) {
    const dStr = isoDate(dates[i]);

    
    const covering = unitRes.find((r) => r.check_in < dStr && r.check_out > dStr);
    if (covering) {
      let span = 0;
      const midStart = dStr;
      while (i < dates.length) {
        const d = isoDate(dates[i]);
        if (!(covering.check_in < d && covering.check_out > d)) break;
        span++;
        i++;
      }
      cells.push({ type: 'mid', res: covering, span, firstDate: midStart, unitId });
      continue;
    }

    const starting = unitRes.find((r) => r.check_in === dStr);
    const ending = unitRes.find((r) => r.check_out === dStr);

    
    if (starting && ending && starting.id !== ending.id) {
      cells.push({
        type: 'turnover',
        outRes: ending,
        inRes: starting,
        date: dStr,
        unitId,
      });
      i++;
      continue;
    }

    if (starting) {
      cells.push({ type: 'checkin', res: starting, date: dStr, unitId });
      i++;
      continue;
    }

    
    if (ending) {
      cells.push({ type: 'checkout', res: ending, date: dStr, unitId });
      i++;
      continue;
    }

    cells.push({ type: 'price', date: dStr, unitId });
    i++;
  }

  return cells;
}


function resColors(res, today) {
  const tomorrow = addDays(today, 1);
  const co = normDate(res.check_out);
  const ci = normDate(res.check_in);
  const isBlocked = res.is_owner_reservation && parseFloat(res.total_amount) === 0;
  if (res.status === 'cancelled')
    return { bg: 'bg-red-600', text: 'text-white', hover: 'hover:brightness-95', ring: 'ring-red-300/50', strike: true };
  if (res.is_hold || res.status === 'hold')
    return { bg: 'bg-amber-400', text: 'text-amber-950', hover: 'hover:brightness-95', ring: 'ring-amber-300/60' };
  if (co < today)
    return { bg: 'bg-slate-300', text: 'text-slate-700', hover: 'hover:brightness-95', ring: 'ring-slate-200' };
  if (co === tomorrow)
    return { bg: 'bg-rose-500', text: 'text-white', hover: 'hover:brightness-95', ring: 'ring-rose-300/50' };
  if (ci === tomorrow)
    return { bg: 'bg-orange-500', text: 'text-white', hover: 'hover:brightness-95', ring: 'ring-orange-300/50' };
  if (isBlocked)
    return { bg: 'bg-violet-500', text: 'text-white', hover: 'hover:brightness-95', ring: 'ring-violet-300/50' };
  if (res.is_owner_reservation)
    return { bg: 'bg-sky-500', text: 'text-white', hover: 'hover:brightness-95', ring: 'ring-sky-300/50' };
  return { bg: 'bg-[#2a9d8f]', text: 'text-white', hover: 'hover:brightness-95', ring: 'ring-teal-300/40' };
}

const COLOR_FILTERS = [
  { value: '', label: 'All stays' },
  { value: 'hold', label: 'Holds' },
  { value: 'owner', label: 'Owner reservations' },
  { value: 'sales', label: 'Guest / sales' },
  { value: 'blocked', label: 'Blocked nights' },
  { value: 'checkin_tomorrow', label: 'Check-in tomorrow' },
  { value: 'checkout_tomorrow', label: 'Check-out tomorrow' },
  { value: 'past', label: 'Past stays' },
];

const CELL_W = 32;


function PriceEditorModal({
  open,
  onClose,
  unitId,
  unitName,
  dateStr,
  currentPrice,
  blockSource,
  onSave,
  onClear,
  onBlock,
  onUnblock,
  saving,
}) {
  const [price, setPrice] = useState('');
  const [applyTo, setApplyTo] = useState('day');
  const [rangeFrom, setRangeFrom] = useState(dateStr || '');
  const [rangeTo, setRangeTo]   = useState(dateStr || '');

  
  useEffect(() => {
    setPrice(currentPrice ? String(currentPrice) : '');
    setApplyTo('day');
    setRangeFrom(dateStr);
    setRangeTo(dateStr);
  }, [open, dateStr, currentPrice]);

  const getRange = () => {
    if (applyTo === 'day')    return { from: dateStr, to: dateStr };
    if (applyTo === 'week')   return getWeekRange(dateStr);
    if (applyTo === 'month')  return getMonthRange(dateStr);
    return { from: rangeFrom, to: rangeTo };
  };

  const removableBlock =
    !!blockSource && blockSource !== 'reservation';
  const lockedBlock = blockSource === 'reservation';

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

  const handleBlock = () => {
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onBlock(unitId, from, to);
  };

  const handleUnblock = () => {
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onUnblock(unitId, from, to);
  };

  const blockLabel =
    blockSource === 'ical'
      ? 'OTA (iCal) block'
      : blockSource === 'owner'
        ? 'Owner block'
        : blockSource === 'reservation'
          ? 'Reservation'
          : blockSource === 'manual'
            ? 'Manual block'
            : blockSource === 'csv_import' || blockSource === 'soul_availability_xlsx'
              ? 'Imported block'
              : blockSource
                ? `${blockSource} block`
                : null;

  return (
    <Modal open={open} onClose={onClose} title="Edit night" size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        {currentPrice > 0 && (
          <button onClick={handleClear} disabled={saving} className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50">
            Clear price
          </button>
        )}
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <DollarSign className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Apply price'}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-soul-line bg-[#f7f9fc] px-4 py-3">
          <p className="text-sm font-semibold text-soul-blue">{unitName}</p>
          <p className="mt-0.5 text-xs text-soul-muted">
            {formatDate(dateStr)}
            {currentPrice > 0 ? ` · Current ${currency(currentPrice)}` : ' · Unpriced'}
            {blockLabel ? ` · ${blockLabel}` : ''}
          </p>
        </div>

        <div>
          <label className="label">Price per night (EGP)</label>
          <input type="number" min="0" step="0.01" autoFocus className="input text-lg font-semibold"
            value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label className="label">Apply to</label>
          <div className="grid grid-cols-2 gap-2">
            {[['day','This day'],['week','This week'],['month','This month'],['range','Custom range']].map(([v,l]) => (
              <button key={v} onClick={() => setApplyTo(v)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${applyTo === v ? 'border-[var(--pms-accent,#283f5e)] bg-[var(--pms-accent,#283f5e)] text-white shadow-sm' : 'border-soul-line text-soul-blue hover:bg-slate-50'}`}>
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
          <p className="text-xs text-soul-muted">
            {applyTo === 'week'  && `Mon – Sun of the week containing ${formatDate(dateStr)}`}
            {applyTo === 'month' && `All days of ${new Date(dateStr).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`}
          </p>
        )}

        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-900">
            <Ban className="h-3.5 w-3.5" />
            Calendar block
          </div>
          <p className="text-xs text-violet-800">
            Blocks close the night to guests without creating a reservation. Reservation nights stay booked until cancelled.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBlock}
              disabled={saving || lockedBlock}
              className="btn-secondary border-violet-300 text-violet-800 hover:bg-violet-100 disabled:opacity-40"
            >
              Block nights
            </button>
            <button
              type="button"
              onClick={handleUnblock}
              disabled={saving || lockedBlock}
              className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50 disabled:opacity-40"
              title={
                lockedBlock
                  ? 'Cancel the reservation to free this night'
                  : removableBlock
                    ? 'Remove calendar block for this range'
                    : 'Clear any calendar blocks in the selected range'
              }
            >
              Unblock nights
            </button>
          </div>
          {lockedBlock && (
            <p className="text-[11px] font-medium text-rose-700">
              This night is held by a reservation. Cancel or edit that booking to free it.
            </p>
          )}
        </div>

        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          Clearing a price marks the night unpriced — guests see it as unavailable.
        </p>
      </div>
    </Modal>
  );
}


function ReservationDetailModal({ open, onClose, reservationId, canWrite, onMoveUnit }) {
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
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          {canWrite && res && res.status !== 'cancelled' && Number(res.is_owner_reservation) !== 1 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onMoveUnit?.(res)}
            >
              <ArrowRightLeft className="w-4 h-4" /> Move unit
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      }
    >
      {isLoading ? <LoadingSpinner /> : res ? (
        <div className="space-y-4">
          
          <div className="flex gap-2 flex-wrap">
            <Badge status={res.status} />
            <Badge status={res.payment_status} />
            {res.is_owner_reservation && <span className="badge badge-blue">Owner Reservation</span>}
          </div>

          
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Info label="Tenant"     value={res.guest_name} bold />
            <Info
              label="Unit"
              value={unitDisplay(res)}
            />
            <Info label="Phone"      value={res.guest_phone} />
            <Info label="Email"      value={res.guest_email} />
            <Info label="Nationality" value={res.guest_nationality} />
            <Info
              label="Party"
              value={[
                res.adults != null ? `${res.adults} adult${Number(res.adults) === 1 ? '' : 's'}` : null,
                res.children != null && Number(res.children) > 0
                  ? `${res.children} child${Number(res.children) === 1 ? '' : 'ren'}`
                  : null,
                res.nanny_count != null && Number(res.nanny_count) > 0
                  ? `${res.nanny_count} nanny`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            />
            <Info label="Source"     value={res.booking_source} />
            <Info label="Sales"      value={res.sales_person_name} />
            <Info label="Created by" value={res.created_by_name} />
            {res.booking_id ? (
              <Info label="Accepted by" value={res.accepted_by_name} />
            ) : null}
          </div>

          
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
              options={[{ value: '', label: 'Select…' }, ...unitsList.map(u => ({ value: String(u.id), label: unitSelectLabel(u) }))]}
            />
          </div>
          <div><label className="label">Tenant Name *</label><input className="input" value={editForm.guest_name} onChange={e => setEditForm(f => ({ ...f, guest_name: e.target.value }))} /></div>
          <div><label className="label">Phone</label><input className="input" value={editForm.guest_phone} onChange={e => setEditForm(f => ({ ...f, guest_phone: e.target.value }))} /></div>
          <div>
            <label className="label">Adults</label>
            <input type="number" min="0" className="input" value={editForm.adults ?? '2'} onChange={e => setEditForm(f => ({ ...f, adults: e.target.value }))} />
          </div>
          <div>
            <label className="label">Children</label>
            <input type="number" min="0" className="input" value={editForm.children ?? '0'} onChange={e => setEditForm(f => ({ ...f, children: e.target.value }))} />
          </div>
          <div>
            <label className="label">Nanny</label>
            <input type="number" min="0" className="input" value={editForm.nanny_count ?? '0'} onChange={e => setEditForm(f => ({ ...f, nanny_count: e.target.value }))} />
          </div>
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


function HoldModal({ open, onClose, prefillUnit, prefillCheckIn, prefillCheckOut, unitsList, onSave, saving }) {
  const [unitId,     setUnitId]     = useState('');
  const [guestName,  setGuestName]  = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkIn,    setCheckIn]    = useState('');
  const [checkOut,   setCheckOut]   = useState('');
  const [preset,     setPreset]     = useState('24'); 
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
            options={[{ value:'', label:'Select…' }, ...unitsList.map(u => ({ value: String(u.id), label: unitSelectLabel(u, { withProject: false }) }))]}
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


function HoldDetailModal({ open, onClose, holdId, onConfirm, onDelete, deleting }) {
  const { data: hold, isLoading } = useQuery({
    queryKey: ['hold-detail', holdId],
    queryFn: () => api.get(`/reservations/${holdId}`).then(r => r.data),
    enabled: !!holdId && open,
    refetchInterval: open ? 30000 : false, 
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
            <div className="flex gap-2"><span className="text-gray-400 w-20">Unit:</span><span className="font-medium">{unitDisplay(hold)}</span></div>
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


const EMPTY_EDIT = {
  unit_id: '', guest_name: '', guest_email: '', guest_phone: '', guest_nationality: '',
  adults: '2', children: '0', nanny_count: '0',
  check_in: '', check_out: '', total_amount: '', price_per_night: '',
  booking_source: '', sales_person_id: '', is_owner_reservation: false, is_hold: false,
  status: 'confirmed', notes: '',
};

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
    <Modal open={open} onClose={onClose} title={`Bulk price · ${unitCount} unit${unitCount !== 1 ? 's' : ''}`} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || unitCount === 0} className="btn-primary">
          <DollarSign className="w-3.5 h-3.5" />{saving ? 'Saving…' : `Apply to ${unitCount}`}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-soul-line bg-[#f7f9fc] px-4 py-3 text-sm text-soul-blue">
          Price will apply to <strong>{unitCount}</strong> selected unit{unitCount !== 1 ? 's' : ''}.
        </div>

        <div>
          <label className="label">Price per night (EGP)</label>
          <input type="number" min="0" step="0.01" autoFocus className="input text-lg font-semibold"
            value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label className="label">Apply to</label>
          <div className="grid grid-cols-2 gap-2">
            {[['day','Today'],['week','This week'],['month','This month'],['range','Custom range']].map(([v,l]) => (
              <button key={v} onClick={() => setApplyTo(v)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${applyTo === v ? 'border-[var(--pms-accent,#283f5e)] bg-[var(--pms-accent,#283f5e)] text-white shadow-sm' : 'border-soul-line text-soul-blue hover:bg-slate-50'}`}>
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
  const { user } = useAuth();
  const { canEditSchedulePricing, canManageReservations, isManualReservations, isWebsiteReservations, isAdmin } = usePermissions();
  const TODAY = todayStr();
  const TOMORROW = addDays(TODAY, 1);
  const now = new Date();

  
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [spanMonths, setSpanMonths] = useState(2);

  
  const [createDrawer, setCreateDrawer] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_MANUAL_RESERVATION_FORM });
  const [createProof, setCreateProof] = useState(null);

  
  const [filterBedrooms,  setFilterBedrooms]  = useState('');
  const [filterProject,   setFilterProject]   = useState('');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');
  const [filterColor,     setFilterColor]     = useState('');
  const [filterUnits,     setFilterUnits]     = useState([]);   
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

  
  const [priceModal,        setPriceModal]        = useState(false);
  const [priceCell,         setPriceCell]         = useState(null); 

  
  const [bulkMode,          setBulkMode]          = useState(false);
  const [selectedUnitIds,   setSelectedUnitIds]   = useState(new Set());
  const [bulkPriceModal,    setBulkPriceModal]    = useState(false);

  
  const [detailModal,       setDetailModal]       = useState(false);
  const [detailResId,       setDetailResId]       = useState(null);
  const [transferRes,       setTransferRes]       = useState(null);

  
  const [editModal,         setEditModal]         = useState(false);
  const [editId,            setEditId]            = useState(null);
  const [editForm,          setEditForm]          = useState(EMPTY_EDIT);

  
  const [filtersOpen, setFiltersOpen] = useState(false);

  
  const [holdModal,         setHoldModal]         = useState(false);
  const [holdPrefill,       setHoldPrefill]       = useState({});
  const [holdDetailModal,   setHoldDetailModal]   = useState(false);
  const [holdDetailId,      setHoldDetailId]      = useState(null);

  
  const defaultFrom = isoDate(new Date(viewYear, viewMonth, 1));
  const defaultTo   = isoDate(new Date(viewYear, viewMonth + spanMonths, 1)); 

  
  
  
  const { fromStr, toStr } = useMemo(() => {
    const monthStart = (dateStr) => {
      const [y, m] = String(dateStr).split('-').map(Number);
      return isoDate(new Date(y, m - 1, 1));
    };
    const monthEnd = (dateStr, months) => {
      const [y, m] = String(dateStr).split('-').map(Number);
      return isoDate(new Date(y, m - 1 + months, 1));
    };

    if (filterFrom && filterTo) {
      const start = filterFrom <= filterTo ? filterFrom : filterTo;
      const end   = filterFrom <= filterTo ? filterTo : filterFrom;
      return { fromStr: start, toStr: addDays(end, 1) };
    }
    if (filterFrom) {
      return { fromStr: filterFrom, toStr: monthEnd(filterFrom, spanMonths) };
    }
    if (filterTo) {
      return { fromStr: monthStart(filterTo), toStr: addDays(filterTo, 1) };
    }
    return { fromStr: defaultFrom, toStr: defaultTo };
  }, [filterFrom, filterTo, defaultFrom, defaultTo, spanMonths]);

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
    const priority = { reservation: 3, ical: 2, owner: 1, manual: 1 };
    for (const b of calendarBlocks) {
      if (!m[b.unit_id]) m[b.unit_id] = {};
      const dateKey = String(b.date).split('T')[0];
      const prev = m[b.unit_id][dateKey];
      const prevRank = priority[prev] || 0;
      const nextRank = priority[b.source] || 0;
      
      if (!prev || nextRank >= prevRank) {
        m[b.unit_id][dateKey] = b.source;
      }
    }
    return m;
  }, [calendarBlocks]);

  const priceMap = useMemo(() => {
    const m = {};
    dailyPricesRaw.forEach(dp => {
      if (!m[dp.unit_id]) m[dp.unit_id] = {};
      
      const dateKey = String(dp.date).split('T')[0];
      m[dp.unit_id][dateKey] = parseFloat(dp.price);
    });
    return m;
  }, [dailyPricesRaw]);

  const getUnitDayPrice = (unit, dateStr) => {
    if (priceMap[unit.id]?.[dateStr] != null) return priceMap[unit.id][dateStr];
    
    return priceMap[unit.id]?.[dateStr] ?? null;
  };

  const { data: projectsList = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api.get('/units/projects').then(r => r.data) });
  const { data: unitsList     = [] } = useQuery({ queryKey: ['units'],    queryFn: () => api.get('/units').then(r => r.data) });
  const { data: usersList     = [] } = useQuery({ queryKey: ['users-sales'], queryFn: () => api.get('/users/sales').then(r => r.data) });

  
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

  const blockMutation = useMutation({
    mutationFn: ({ unit_id, from_date, to_date, clear }) =>
      api.put(`/blocked-dates/${unit_id}`, {
        from_date,
        to_date,
        clear: !!clear,
      }),
    onSuccess: (res, { clear }) => {
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      if (clear) {
        const still = res?.data?.still_reserved || [];
        if (still.length) {
          toast.success(
            `Unblocked calendar nights. ${still.length} night${still.length === 1 ? '' : 's'} still held by reservation(s).`
          );
        } else {
          toast.success('Nights unblocked');
        }
      } else {
        toast.success('Nights blocked');
      }
      setPriceModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error updating blocks'),
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

  const createReservationMutation = useMutation({
    mutationFn: (d) => {
      if (d instanceof FormData) {
        return api.post('/reservations', d, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      return api.post('/reservations', d);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      toast.success('Reservation created — pending payment');
      setCreateDrawer(false);
      setCreateProof(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error creating reservation'),
  });

  const openCreateDrawer = () => {
    setCreateForm({
      ...EMPTY_MANUAL_RESERVATION_FORM,
      sales_person_id: (isManualReservations || isWebsiteReservations) && !isAdmin && user?.id ? String(user.id) : '',
      payment_method: 'cash',
    });
    setCreateProof(null);
    setCreateDrawer(true);
  };

  const handleCreateReservation = () => {
    if (!createForm.guest_phone?.trim()) return toast.error('Mobile number is required');
    if (!createForm.is_owner_reservation && !createForm.sales_person_id) {
      return toast.error('Please select a Sales Person or mark as Owner Reservation');
    }
    if (!createForm.unit_id || !createForm.check_in || !createForm.check_out) {
      return toast.error('Unit and dates are required');
    }
    const selectedUnit = unitsList.find((u) => String(u.id) === String(createForm.unit_id));
    const adults = Math.max(0, parseInt(createForm.adults, 10) || 0);
    const children = Math.max(0, parseInt(createForm.children, 10) || 0);
    const nannyCount = Math.max(0, parseInt(createForm.nanny_count, 10) || 0);
    if (!createForm.is_owner_reservation && adults < 1) {
      return toast.error('At least 1 adult is required');
    }
    const payload = {
      ...createForm,
      adults,
      children,
      nanny_count: nannyCount,
      housekeeping_fees: selectedUnit
        ? housekeepingFeeForUnit(selectedUnit)
        : createForm.housekeeping_fees,
      beach_access_fees: createForm.is_owner_reservation
        ? 0
        : createForm.beach_access_fees !== '' && createForm.beach_access_fees != null
          ? Number(createForm.beach_access_fees)
          : undefined,
    };
    if (createProof) {
      const fd = new FormData();
      Object.entries(payload).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) {
          fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
        }
      });
      fd.append('transfer_proof', createProof);
      createReservationMutation.mutate(fd);
    } else {
      createReservationMutation.mutate(payload);
    }
  };

  const deleteHoldMutation = useMutation({
    mutationFn: (id) => api.delete(`/reservations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Hold deleted');
      setHoldDetailModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting hold'),
  });

  
  const goPrevMonth = () => { if (viewMonth === 0) { setViewYear(y=>y-1); setViewMonth(11); } else setViewMonth(m=>m-1); };
  const goNextMonth = () => { if (viewMonth === 11) { setViewYear(y=>y+1); setViewMonth(0);  } else setViewMonth(m=>m+1); };
  const goThisMonth = () => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); };

  const hasFilters = filterBedrooms || filterProject || filterFrom || filterTo || filterColor || filterUnits.length || filterFloor || filterPriceMin || filterPriceMax || filterAvailable;
  const clearFilters = () => { setFilterBedrooms(''); setFilterProject(''); setFilterFrom(''); setFilterTo(''); setFilterColor(''); setFilterUnits([]); setFilterFloor(''); setFilterPriceMin(''); setFilterPriceMax(''); setFilterAvailable(false); };

  const handlePriceClick = useCallback((unit, dateStr) => {
    if (!canEditSchedulePricing) return;
    setPriceCell({
      unitId: unit.id,
      unitName: unit.name,
      dateStr,
      currentPrice: getUnitDayPrice(unit, dateStr),
      blockSource: blockMap[unit.id]?.[dateStr] || null,
    });
    setPriceModal(true);
  }, [canEditSchedulePricing, priceMap, blockMap]);

  const handleResClick = useCallback((res) => {
    
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
        adults: res.adults != null ? String(res.adults) : '2',
        children: res.children != null ? String(res.children) : '0',
        nanny_count: res.nanny_count != null ? String(res.nanny_count) : '0',
        check_in: normDate(res.check_in), check_out: normDate(res.check_out),
        total_amount: isHold ? '' : res.total_amount,
        price_per_night: res.price_per_night || '',
        booking_source: res.booking_source || '', sales_person_id: res.sales_person_id || '',
        is_owner_reservation: !!res.is_owner_reservation,
        
        is_hold: isHold ? false : undefined,
        status: isHold ? 'confirmed' : res.status,
        notes: res.notes || '',
      });
      setEditId(res.id);
      setHoldDetailModal(false); 
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

  
  
  const parseUnitCode = (unitNumber = '') => {
    const s = String(unitNumber).trim().toUpperCase();
    if (/^SA/i.test(s)) {
      
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

  
  const availableFloors = useMemo(() => {
    const floors = new Set();
    (data?.units || []).forEach(u => {
      const f = parseInt(u.floor);
      if (!isNaN(f) && f >= 0) floors.add(f);
    });
    return Array.from(floors).sort((a, b) => a - b);
  }, [data]);

  
  
  
  const sortUnits = (units) => [...units].sort((a, b) => {
    const pA = parseUnitCode(a.unit_number);
    const pB = parseUnitCode(b.unit_number);
    if (pA.group    !== pB.group)    return pA.group    - pB.group;
    if (pA.subGroup !== pB.subGroup) return pA.subGroup - pB.subGroup;
    if (pA.group === 0) { 
      if (pA.floor   !== pB.floor)   return pA.floor    - pB.floor;
      if (pA.section !== pB.section) return pA.section.localeCompare(pB.section);
    }
    return pA.raw.localeCompare(pB.raw, undefined, { numeric: true });
  });

  
  const allReservations = data?.reservations || [];
  const filteredUnits = useMemo(() => {
    const priceMin = filterPriceMin !== '' ? parseFloat(filterPriceMin) : null;
    const priceMax = filterPriceMax !== '' ? parseFloat(filterPriceMax) : null;
    const filtered = (data?.units || []).filter(unit => {
      
      if (filterUnits.length > 0 && !filterUnits.includes(String(unit.id))) return false;

      
      if (filterFloor !== '' && filterFloor !== undefined) {
        if (parseInt(unit.floor) !== parseInt(filterFloor)) return false;
      }

      
      
      if (priceMin !== null || priceMax !== null) {
        const nightly = displayDates
          .map((d) => priceMap[unit.id]?.[isoDate(d)])
          .filter((p) => p != null && p > 0);
        const fallbackPrice = parseFloat(unit.price_per_night) || 0;
        const prices = nightly.length ? nightly : (fallbackPrice > 0 ? [fallbackPrice] : []);
        if (!prices.length) return false;
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        if (priceMin !== null && highest < priceMin) return false;
        if (priceMax !== null && lowest > priceMax) return false;
      }

      const ur = allReservations.filter(r => r.unit_id === unit.id);
      const lastD  = displayDates[displayDates.length - 1];
      const firstD = displayDates[0];
      if (!lastD || !firstD) return true;
      const last  = isoDate(lastD);
      const first = isoDate(firstD);
      const unitBlocks = blockMap[unit.id] || {};
      const blockedNightsInView = Object.keys(unitBlocks).filter(
        (d) => d >= first && d <= last
      );

      
      if (filterAvailable) {
        const hasOverlap = ur.some(r => normDate(r.check_in) < toStr && normDate(r.check_out) > fromStr);
        if (hasOverlap) return false;
        if (blockedNightsInView.length > 0) return false;
      }

      
      if (!filterColor) return true;
      if (filterColor === 'hold')              return ur.some(r => (r.is_hold || r.status === 'hold') && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'blocked')           return ur.some(r => r.is_owner_reservation && !r.is_hold && parseFloat(r.total_amount) === 0 && normDate(r.check_in) <= last && normDate(r.check_out) > first)
                                                 || blockedNightsInView.some((d) => unitBlocks[d] !== 'reservation');
      if (filterColor === 'owner')             return ur.some(r => r.is_owner_reservation && !r.is_hold && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'sales')             return ur.some(r => !r.is_owner_reservation && !r.is_hold && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'checkout_tomorrow') return ur.some(r => !r.is_hold && normDate(r.check_out) === TOMORROW);
      if (filterColor === 'checkin_tomorrow')  return ur.some(r => !r.is_hold && normDate(r.check_in)  === TOMORROW);
      if (filterColor === 'past')              return ur.some(r => !r.is_hold && normDate(r.check_out) <= TODAY);
      return true;
    });
    return sortUnits(filtered);
  }, [data, filterColor, filterUnits, filterFloor, filterPriceMin, filterPriceMax, filterAvailable, allReservations, displayDates, priceMap, blockMap, fromStr, toStr, TODAY, TOMORROW]);

  
  return (
    <div className="space-y-4">
      
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">Operations</p>
          <h1 className="page-title mt-1">Schedule</h1>
          <p className="page-subtitle">
            {filterFrom || filterTo
              ? `${formatDate(fromStr)} — ${filterTo ? formatDate(filterTo) : formatDate(addDays(toStr, -1))}`
              : monthLabel}
            {canEditPrice ? ' · Tap an open night to price or clear it' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <button onClick={openCreateDrawer} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New reservation</span>
                <span className="sm:hidden">New</span>
              </button>
              <button
                onClick={() => { setHoldPrefill({}); setHoldModal(true); }}
                className="btn-secondary flex items-center gap-2"
              >
                <Hourglass className="w-4 h-4 text-amber-600" />
                <span className="hidden sm:inline">Hold</span>
              </button>
            </>
          )}
          <div className="flex items-center rounded-xl border border-soul-line bg-white p-0.5 shadow-sm">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSpanMonths(n)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  spanMonths === n
                    ? 'bg-[var(--pms-accent,#283f5e)] text-white shadow-sm'
                    : 'text-soul-muted hover:bg-slate-50 hover:text-soul-blue'
                }`}
              >
                {n} mo
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-soul-line bg-white p-0.5 shadow-sm">
            <button onClick={goPrevMonth} className="rounded-lg p-2 text-soul-muted hover:bg-slate-50 hover:text-soul-blue">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goThisMonth}
              className="min-w-[7.5rem] px-2 text-center text-sm font-semibold text-soul-blue hover:text-[var(--pms-accent,#283f5e)]"
              title="Jump to this month"
            >
              {monthLabel}
            </button>
            <button onClick={goNextMonth} className="rounded-lg p-2 text-soul-muted hover:bg-slate-50 hover:text-soul-blue">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-soul-line bg-white/90 px-4 py-3 shadow-sm">
        {[
          { swatch: 'bg-emerald-50 border border-emerald-200', label: 'Priced' },
          { swatch: 'bg-rose-50 border border-rose-200', label: 'Unpriced' },
          { swatch: 'border border-slate-300', label: 'OTA / admin block', style: { backgroundImage: 'repeating-linear-gradient(135deg, rgba(40,63,94,0.14) 0 4px, transparent 4px 8px)' } },
          { swatch: 'bg-[#2a9d8f]', label: 'Guest stay' },
          { swatch: 'bg-red-600', label: 'Cancelled' },
          { swatch: 'bg-amber-400', label: 'Hold' },
          { swatch: 'bg-violet-500', label: 'Blocked' },
          { swatch: 'bg-sky-500', label: 'Owner' },
          { swatch: 'bg-rose-500', label: 'Checkout soon' },
          { swatch: 'bg-orange-500', label: 'Check-in soon' },
        ].map((item) => (
          <div key={item.label} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-soul-muted">
            <span className={`h-3 w-3 rounded-md ${item.swatch}`} style={item.style} />
            {item.label}
          </div>
        ))}
        {canEditPrice && !bulkMode && (
          <button
            onClick={() => { setBulkMode(true); setSelectedUnitIds(new Set()); }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-soul-line bg-slate-50 px-3 py-1.5 text-xs font-semibold text-soul-blue hover:bg-[var(--pms-accent-soft,rgba(40,63,94,0.08))]"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Bulk price
          </button>
        )}
        {canEditPrice && bulkMode && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-soul-blue">
              {selectedUnitIds.size} selected
            </span>
            <button
              onClick={() => setSelectedUnitIds(new Set(filteredUnits.map((u) => u.id)))}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-soul-muted hover:bg-slate-200"
            >
              All
            </button>
            <button
              onClick={() => setSelectedUnitIds(new Set())}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-soul-muted hover:bg-slate-200"
            >
              Clear
            </button>
            <button
              disabled={selectedUnitIds.size === 0}
              onClick={() => setBulkPriceModal(true)}
              className="rounded-full bg-[var(--pms-accent,#283f5e)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Apply price
            </button>
            <button
              onClick={() => { setBulkMode(false); setSelectedUnitIds(new Set()); }}
              className="rounded-full px-2 py-1 text-xs font-medium text-soul-muted hover:text-soul-blue"
            >
              Done
            </button>
          </div>
        )}
      </div>

      
      
      <div className="relative z-40 rounded-2xl border border-soul-line bg-white shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left lg:cursor-default"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-soul-blue">Filters</span>
            {hasFilters && (
              <span className="rounded-full bg-[var(--pms-accent-soft,rgba(40,63,94,0.12))] px-2 py-0.5 text-[11px] font-semibold text-soul-blue">
                Active
              </span>
            )}
          </div>
          <span className="text-xs font-medium text-soul-muted lg:hidden">
            {filtersOpen ? 'Hide' : 'Show'}
          </span>
        </button>
        <div className={`border-t border-soul-line px-4 py-4 ${filtersOpen ? '' : 'hidden lg:block'}`}>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label text-xs">Project</label>
              <SearchableSelect
                className="w-44"
                value={filterProject}
                onChange={(v) => { setFilterProject(v); setFilterUnits([]); }}
                placeholder="All projects"
                options={[{ value: '', label: 'All projects' }, ...projectsList.map((p) => ({ value: p, label: p }))]}
              />
            </div>
            <div>
              <label className="label text-xs">Bedrooms</label>
              <SearchableSelect
                className="w-32"
                value={filterBedrooms}
                onChange={setFilterBedrooms}
                placeholder="All"
                options={[{ value: '', label: 'All' }, ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: n === 0 ? 'Studio' : `${n} BR` }))]}
              />
            </div>
            <div>
              <label className="label text-xs">Floor</label>
              <SearchableSelect
                className="w-28"
                value={filterFloor}
                onChange={setFilterFloor}
                placeholder="All"
                options={[{ value: '', label: 'All' }, ...availableFloors.map((f) => ({ value: String(f), label: f === 0 ? 'Ground' : `Floor ${f}` }))]}
              />
            </div>
            <div>
              <label className="label text-xs">From</label>
              <input type="date" className="input w-38" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="date" className="input w-38" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Min price</label>
              <input type="number" min="0" step="100" className="input w-28" placeholder="Any" value={filterPriceMin} onChange={(e) => setFilterPriceMin(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Max price</label>
              <input type="number" min="0" step="100" className="input w-28" placeholder="Any" value={filterPriceMax} onChange={(e) => setFilterPriceMax(e.target.value)} />
            </div>
            <div className="relative" ref={unitPickerRef}>
              <label className="label text-xs">Units</label>
              <button
                type="button"
                onClick={() => { setUnitPickerOpen((v) => !v); setUnitPickerSearch(''); }}
                className={`input w-44 flex cursor-pointer items-center justify-between gap-2 text-left ${
                  filterUnits.length > 0 ? 'border-[var(--pms-accent,#283f5e)] bg-[var(--pms-accent-soft,rgba(40,63,94,0.08))]' : ''
                }`}
              >
                <span className="truncate text-sm">
                  {filterUnits.length === 0 ? 'All units' : `${filterUnits.length} selected`}
                </span>
                <ChevronRight className={`h-3.5 w-3.5 text-soul-muted transition ${unitPickerOpen ? 'rotate-90' : ''}`} />
              </button>
              {unitPickerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto overscroll-contain rounded-2xl border border-soul-line bg-white shadow-xl">
                  <div className="flex items-center justify-between gap-2 border-b border-soul-line px-3 py-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search units…"
                      value={unitPickerSearch}
                      onChange={(e) => setUnitPickerSearch(e.target.value)}
                      className="flex-1 rounded-lg border border-soul-line px-2 py-1 text-xs outline-none focus:border-[var(--pms-accent,#283f5e)]"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {filterUnits.length > 0 && (
                      <button onClick={() => setFilterUnits([])} className="whitespace-nowrap text-xs font-semibold text-soul-blue hover:underline">
                        Clear
                      </button>
                    )}
                  </div>
                  {(() => {
                    const q = unitPickerSearch.trim().toLowerCase();
                    const wantProject = filterProject.trim().toLowerCase();
                    const pool = sortUnits(
                      (data?.units || []).filter(
                        (u) =>
                          !wantProject ||
                          String(u.project || u.compound || '').trim().toLowerCase() === wantProject
                      )
                    );
                    const visible = q
                      ? pool.filter((u) => String(unitSelectLabel(u, { withProject: false }) || '').toLowerCase().includes(q) || String(u.name || '').toLowerCase().includes(q) || String(u.unit_number || '').toLowerCase().includes(q))
                      : pool;
                    if (visible.length === 0) {
                      return <p className="px-3 py-4 text-center text-sm text-soul-muted">No units found</p>;
                    }
                    return visible.map((u) => {
                      const isChecked = filterUnits.includes(String(u.id));
                      return (
                        <label
                          key={u.id}
                          className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-slate-50 ${
                            isChecked ? 'bg-[var(--pms-accent-soft,rgba(40,63,94,0.08))]' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              setFilterUnits((prev) =>
                                prev.includes(String(u.id))
                                  ? prev.filter((id) => id !== String(u.id))
                                  : [...prev, String(u.id)]
                              )
                            }
                            className="h-4 w-4 flex-shrink-0 rounded border-soul-line accent-[var(--pms-accent,#283f5e)]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-soul-blue">{unitDisplay(u)}</div>
                            <div className="text-xs text-soul-muted">
                              {[u.project, u.name && u.unit_number && u.name !== u.unit_number ? u.name : null]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </div>
                          </div>
                        </label>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
            <div className="flex flex-col justify-end">
              <label className="label text-xs opacity-0 select-none">_</label>
              <button
                onClick={() => setFilterAvailable((v) => !v)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  filterAvailable
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-soul-line bg-white text-soul-muted hover:border-emerald-300'
                }`}
              >
                Available only
              </button>
            </div>
            <div>
              <label className="label text-xs">Stay type</label>
              <SearchableSelect
                className="w-48"
                value={filterColor}
                onChange={setFilterColor}
                placeholder="All stays"
                options={COLOR_FILTERS.map((cf) => ({ value: cf.value, label: cf.label }))}
              />
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="btn-secondary flex items-center gap-1.5 text-sm">
                <X className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      
      {isLoading ? <LoadingSpinner /> : (
        <div
          className="relative z-0 overflow-auto rounded-2xl border border-soul-line bg-white shadow-sm"
          style={{ maxHeight: '75vh' }}
        >
          <table
            className="w-full border-collapse text-sm"
            style={{ minWidth: Math.max(480, 140 + displayDates.length * CELL_W) }}
          >
            <thead className="sticky top-0 z-30">
              <tr className="border-b border-soul-line bg-[#f7f9fc]">
                <th className="sticky left-0 z-40 min-w-[96px] border-r border-soul-line bg-[#f7f9fc] px-2 py-1.5 text-left font-semibold text-soul-blue lg:min-w-[168px] lg:px-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-soul-muted">
                    <CalendarRange className="h-3 w-3" />
                    Unit
                  </div>
                </th>
                {displayDates.map((d, i) => {
                  const dStr = isoDate(d);
                  const isToday = dStr === TODAY;
                  const isTomorrow = dStr === TOMORROW;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <th
                      key={i}
                      style={{ minWidth: CELL_W, width: CELL_W }}
                      className={`border-r border-slate-100 px-0 py-1 text-center font-medium ${
                        isToday
                          ? 'bg-[var(--pms-accent-soft,rgba(40,63,94,0.12))] text-soul-blue'
                          : isTomorrow
                            ? 'bg-orange-50 text-orange-700'
                            : isWeekend
                              ? 'bg-amber-50/70 text-amber-700'
                              : 'text-soul-muted'
                      }`}
                    >
                      <div className={`mx-auto flex h-5 w-5 items-center justify-center text-[10px] font-bold leading-none ${
                        isToday ? 'rounded-full bg-[var(--pms-accent,#283f5e)] text-white' : ''
                      }`}>
                        {d.getDate()}
                      </div>
                      <div className="mt-0.5 hidden text-[8px] font-semibold uppercase tracking-wide opacity-70 lg:block">
                        {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredUnits.map((unit) => {
                const cells = buildRow(unit.id, displayDates, allReservations);
                return (
                  <tr key={unit.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 border-r border-soul-line bg-white px-2 py-1 lg:px-3">
                      {bulkMode && (
                        <label className="mb-1 flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedUnitIds.has(unit.id)}
                            onChange={(e) =>
                              setSelectedUnitIds((prev) => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(unit.id) : next.delete(unit.id);
                                return next;
                              })
                            }
                            className="h-3.5 w-3.5 rounded accent-[var(--pms-accent,#283f5e)]"
                          />
                        </label>
                      )}
                      <div className="flex items-start gap-1.5">
                        <div className="mt-0.5 hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--pms-accent-soft,rgba(40,63,94,0.1))] text-[9px] font-bold text-soul-blue lg:flex">
                          {unitDisplay(unit, '?').toString().slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold leading-tight text-soul-blue lg:text-xs">
                            {unitDisplay(unit)}
                          </div>
                          <div className="mt-0.5 hidden items-center gap-1 text-[9px] text-soul-muted lg:flex">
                            <span>
                              {(unit.name || unit.title) && unit.unit_number ? `${unit.name || unit.title} · ` : ''}
                              {unit.project}
                              {unit.bedrooms > 0 ? ` · ${unit.bedrooms}BR` : ' · Studio'}
                            </span>
                            {unit.photos_link && (
                              <a
                                href={unit.photos_link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-soul-muted transition-colors hover:text-soul-blue"
                                title="View photos"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="truncate text-[10px] text-soul-muted lg:hidden">
                            {unit.project || unit.name || unit.title || '—'}
                          </div>
                          {(unit.view || (unit.floor !== null && unit.floor !== undefined)) && (
                            <div className="mt-0.5 hidden truncate text-[10px] text-slate-400 lg:block">
                              {[
                                unit.view,
                                unit.floor !== null && unit.floor !== undefined
                                  ? (parseInt(unit.floor, 10) === 0 ? 'Ground' : `Floor ${unit.floor}`)
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {cells.map((cell, j) => {
                      if (cell.type === 'price') {
                        const price = getUnitDayPrice(unit, cell.date);
                        const blockSrc = blockMap[unit.id]?.[cell.date];
                        const isToday = cell.date === TODAY;
                        const isPast = cell.date < TODAY;
                        const isPriced = price != null && price > 0;
                        const hasCheckinTomorrow =
                          cell.date === TODAY &&
                          allReservations.some(
                            (r) => r.unit_id === unit.id && normDate(r.check_in) === TOMORROW
                          );
                        const hatch =
                          'repeating-linear-gradient(135deg, rgba(40,63,94,0.14) 0 4px, transparent 4px 8px)';
                        let cellBg = 'bg-white';
                        if (blockSrc) cellBg = 'bg-slate-50';
                        else if (isPriced) cellBg = 'bg-emerald-50/90';
                        else if (!isPast) cellBg = 'bg-rose-50/80';
                        return (
                          <td
                            key={j}
                            style={{
                              minWidth: CELL_W,
                              width: CELL_W,
                              ...(blockSrc ? { backgroundImage: hatch } : {}),
                            }}
                            className={`border-r border-slate-100 p-0 text-center align-middle ${cellBg} ${
                              isPast ? 'opacity-45' : ''
                            } ${isToday ? 'ring-1 ring-inset ring-[var(--pms-accent,#283f5e)]/35' : ''} ${
                              hasCheckinTomorrow && !blockSrc ? 'bg-orange-50' : ''
                            } ${canEditPrice && !isPast ? 'cursor-pointer group hover:brightness-[0.98]' : ''}`}
                            onClick={() => canEditPrice && !isPast && handlePriceClick(unit, cell.date)}
                            title={
                              blockSrc
                                ? `${
                                    blockSrc === 'ical'
                                      ? 'OTA (iCal)'
                                      : blockSrc === 'owner'
                                        ? 'Owner'
                                        : blockSrc === 'reservation'
                                          ? 'Reservation'
                                          : 'Admin'
                                  } block · ${formatDate(cell.date)}${
                                    canEditPrice && !isPast ? ' · Click to manage' : ''
                                  }`
                                : isPriced
                                  ? `${currency(price)} · ${formatDate(cell.date)}${
                                      canEditPrice && !isPast ? ' · Click to price or block' : ''
                                    }`
                                  : `No price — guests see unavailable · ${formatDate(cell.date)}${
                                      canEditPrice && !isPast ? ' · Click to price or block' : ''
                                    }`
                            }
                          >
                            <div
                              className={`relative flex h-11 flex-col items-center justify-center py-1 ${
                                hasCheckinTomorrow
                                  ? 'text-orange-700'
                                  : isPriced
                                    ? 'text-emerald-700'
                                    : 'text-rose-300'
                              }`}
                            >
                              {hasCheckinTomorrow && (
                                <span className="mb-0.5 text-[10px] leading-none text-orange-500">●</span>
                              )}
                              {blockSrc && !isPriced ? (
                                <span className="rounded-md bg-white/80 px-0.5 text-[8px] font-bold tracking-wide text-violet-700">
                                  {blockSrc === 'ical' ? 'OTA' : 'BLK'}
                                </span>
                              ) : isPriced ? (
                                <span className="text-[10px] font-bold leading-none tracking-tight">
                                  {price >= 1000
                                    ? `${(price / 1000).toFixed(price % 1000 === 0 ? 0 : 1)}k`
                                    : price}
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold">—</span>
                              )}
                              {canEditPrice && !isPast && (
                                <Edit2 className="absolute bottom-1 right-1 h-2.5 w-2.5 text-soul-blue opacity-0 transition group-hover:opacity-50" />
                              )}
                            </div>
                          </td>
                        );
                      }

                      if (cell.type === 'turnover') {
                        const outColors = resColors(cell.outRes, TODAY);
                        const inColors = resColors(cell.inRes, TODAY);
                        const outTip = `${cell.outRes.guest_name}\n${formatDate(normDate(cell.outRes.check_in))} → ${formatDate(normDate(cell.outRes.check_out))}\nCheckout morning`;
                        const inTip = `${cell.inRes.guest_name}\n${formatDate(normDate(cell.inRes.check_in))} → ${formatDate(normDate(cell.inRes.check_out))}\nCheck-in afternoon`;
                        return (
                          <td
                            key={j}
                            style={{ minWidth: CELL_W, width: CELL_W }}
                            className="border-r border-slate-100 p-0 align-middle"
                          >
                            <div className="flex h-9 items-center">
                              <div
                                className={`h-6 w-1/2 cursor-pointer rounded-r-full shadow-sm ring-1 ${outColors.bg} ${outColors.hover} ${outColors.ring} transition`}
                                title={outTip}
                                onClick={() => handleResClick(cell.outRes)}
                              />
                              <div
                                className={`h-6 w-1/2 cursor-pointer rounded-l-full shadow-sm ring-1 ${inColors.bg} ${inColors.hover} ${inColors.ring} transition`}
                                title={inTip}
                                onClick={() => handleResClick(cell.inRes)}
                              />
                            </div>
                          </td>
                        );
                      }

                      const { bg, text, hover, ring, strike } = resColors(cell.res, TODAY);
                      const tipText = `${cell.res.status === 'cancelled' ? 'CANCELLED · ' : ''}${cell.res.guest_name}\n${formatDate(normDate(cell.res.check_in))} → ${formatDate(normDate(cell.res.check_out))}\n${nightsText(cell.res.nights)} · ${currency(cell.res.total_amount)}`;

                      if (cell.type === 'checkin') {
                        const openPrice = getUnitDayPrice(unit, cell.date);
                        const isPastOpen = cell.date < TODAY;
                        return (
                          <td
                            key={j}
                            style={{ minWidth: CELL_W, width: CELL_W }}
                            className="border-r border-slate-100 p-0 align-middle"
                          >
                            <div className="flex h-9 items-center overflow-hidden">
                              <div
                                className={`flex h-full w-1/2 items-center justify-center bg-emerald-50/90 ${
                                  canEditPrice && !isPastOpen
                                    ? 'cursor-pointer hover:bg-emerald-100'
                                    : ''
                                }`}
                                title={`Open morning — previous guest can check out · ${formatDate(cell.date)}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (canEditPrice && !isPastOpen) handlePriceClick(unit, cell.date);
                                }}
                              >
                                {openPrice != null && openPrice > 0 ? (
                                  <span className="text-[10px] font-bold leading-none text-emerald-700">
                                    {openPrice >= 1000
                                      ? `${(openPrice / 1000).toFixed(openPrice % 1000 === 0 ? 0 : 1)}k`
                                      : openPrice}
                                  </span>
                                ) : (
                                  <span className="text-[8px] font-semibold text-emerald-600/70">out</span>
                                )}
                              </div>
                              <div
                                className={`h-6 w-1/2 cursor-pointer rounded-l-full shadow-sm ring-1 ${bg} ${hover} ${ring} transition`}
                                title={tipText}
                                onClick={() => handleResClick(cell.res)}
                              />
                            </div>
                          </td>
                        );
                      }

                      if (cell.type === 'mid') {
                        return (
                          <td
                            key={j}
                            colSpan={cell.span}
                            style={{ minWidth: CELL_W * cell.span }}
                            className="border-r border-slate-100 p-0 align-middle"
                          >
                            <div
                              className={`mx-0 my-1 flex h-6 cursor-pointer items-center justify-between px-1.5 shadow-sm ring-1 ${bg} ${text} ${hover} ${ring} transition`}
                              title={tipText}
                              onClick={() => handleResClick(cell.res)}
                            >
                              <div className="flex min-w-0 items-center gap-1">
                                <Eye className="h-2.5 w-2.5 flex-shrink-0 opacity-80" />
                                <span className="truncate text-[10px] font-semibold tracking-tight">
                                  {cell.res.guest_name}
                                </span>
                              </div>
                              {cell.span > 2 && (
                                <span className="max-w-[64px] flex-shrink-0 truncate text-[9px] opacity-75">
                                  {cell.res.is_owner_reservation
                                    ? 'Owner'
                                    : cell.res.sales_person_name || ''}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      }

                      if (cell.type === 'checkout') {
                        const openPrice = getUnitDayPrice(unit, cell.date);
                        const isPastOpen = cell.date < TODAY;
                        return (
                          <td
                            key={j}
                            style={{ minWidth: CELL_W, width: CELL_W }}
                            className="border-r border-slate-100 p-0 align-middle bg-emerald-50/90"
                          >
                            <div className="flex h-9 items-center overflow-hidden">
                              <div
                                className={`h-6 w-1/2 cursor-pointer rounded-r-full shadow-sm ring-1 ${bg} ${hover} ${ring} transition`}
                                title={tipText}
                                onClick={() => handleResClick(cell.res)}
                              />
                              <div
                                className={`flex h-full w-1/2 items-center justify-center ${
                                  canEditPrice && !isPastOpen
                                    ? 'cursor-pointer hover:bg-emerald-100'
                                    : ''
                                }`}
                                title={`Open for next check-in · ${formatDate(cell.date)}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (canEditPrice && !isPastOpen) handlePriceClick(unit, cell.date);
                                }}
                              >
                                {openPrice != null && openPrice > 0 ? (
                                  <span className="text-[10px] font-bold leading-none text-emerald-700">
                                    {openPrice >= 1000
                                      ? `${(openPrice / 1000).toFixed(openPrice % 1000 === 0 ? 0 : 1)}k`
                                      : openPrice}
                                  </span>
                                ) : (
                                  <span className="text-[8px] font-semibold text-emerald-600/70">in</span>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                      }

                      return null;
                    })}
                  </tr>
                );
              })}
              {filteredUnits.length === 0 && (
                <tr>
                  <td colSpan={displayDates.length + 1} className="px-6 py-20 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f7f9fc] text-soul-muted">
                        <CalendarRange className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-semibold text-soul-blue">
                        {(data?.units || []).length === 0 ? 'No units yet' : 'No matching units'}
                      </p>
                      <p className="text-xs text-soul-muted">
                        {(data?.units || []).length === 0
                          ? 'Add units in the Units page to start scheduling.'
                          : 'Try clearing filters or widening the date range.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-right text-[11px] text-soul-muted">
        Tap a night to price or block it · Checkout days stay open for the next check-in · Bars open reservation details
      </p>

      
      <PriceEditorModal
        open={priceModal}
        onClose={() => setPriceModal(false)}
        unitId={priceCell?.unitId}
        unitName={priceCell?.unitName}
        dateStr={priceCell?.dateStr}
        currentPrice={priceCell?.currentPrice}
        blockSource={priceCell?.blockSource}
        saving={priceMutation.isPending || blockMutation.isPending}
        onSave={(unitId, from, to, price) => priceMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, price })}
        onClear={(unitId, from, to) => priceMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: true })}
        onBlock={(unitId, from, to) => blockMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: false })}
        onUnblock={(unitId, from, to) => blockMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: true })}
      />

      <ReservationDetailModal
        open={detailModal}
        onClose={() => setDetailModal(false)}
        reservationId={detailResId}
        canWrite={canWrite}
        onMoveUnit={(res) => {
          setTransferRes(res);
          setDetailModal(false);
        }}
      />

      <TransferReservationModal
        open={!!transferRes}
        reservation={transferRes}
        units={unitsList}
        onClose={() => setTransferRes(null)}
        onTransferred={() => {
          qc.invalidateQueries({ queryKey: ['schedule'] });
          qc.invalidateQueries({ queryKey: ['reservations'] });
          qc.invalidateQueries({ queryKey: ['reservation-detail'] });
        }}
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

      <AdminReservationDrawer
        open={createDrawer}
        onClose={() => { setCreateDrawer(false); setCreateProof(null); }}
      >
        <ManualReservationForm
          form={createForm}
          setForm={setCreateForm}
          units={unitsList}
          users={usersList}
          transferProof={createProof}
          onTransferProofChange={setCreateProof}
          lockSalesPerson={(isManualReservations || isWebsiteReservations) && !isAdmin}
          currentUserName={user?.full_name || user?.username || ''}
          showCommission={isAdmin}
          allowPastDates={isAdmin}
          onCancel={() => { setCreateDrawer(false); setCreateProof(null); }}
          onSubmit={handleCreateReservation}
          submitting={createReservationMutation.isPending}
        />
      </AdminReservationDrawer>
    </div>
  );
}
