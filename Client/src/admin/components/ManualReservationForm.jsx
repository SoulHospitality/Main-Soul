import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Mail, Upload, UserRound } from 'lucide-react';
import guestApi from '../../api/http';
import ListingDatePicker, {
  isoToLocalDate,
  localDateToIso,
} from '../../components/listing/ListingDatePicker';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
import SearchableSelect from './ui/SearchableSelect';
import {
  BOOKING_SOURCES,
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from '../utils/formatters';

const money = (value) =>
  `EGP ${Number(value || 0).toLocaleString('en-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

export const EMPTY_MANUAL_RESERVATION_FORM = {
  unit_id: '',
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  guest_nationality: '',
  check_in: '',
  check_out: '',
  price_per_night: '',
  total_amount: '',
  down_payment: '',
  housekeeping_fees: '',
  insurance: '',
  booking_source: '',
  sales_person_id: '',
  is_owner_reservation: false,
  notes: '',
  owner_collected_type: '',
  owner_collected_amount: '',
  utilities_cost_override: '',
  broker_name: '',
  broker_amount_per_night: '',
  payment_method: 'cash',
};

function Label({ children }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
      {children}
    </p>
  );
}

export default function ManualReservationForm({
  form,
  setForm,
  units,
  users,
  transferProof,
  onTransferProofChange,
  lockSalesPerson = false,
  currentUserName = '',
  onCancel,
  onSubmit,
  submitting = false,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedUnit = units.find((unit) => String(unit.id) === String(form.unit_id));

  const from = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const to = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 12);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data: availability, isLoading: availabilityLoading } = useQuery({
    queryKey: ['manual-availability', form.unit_id, from, to],
    queryFn: () =>
      guestApi
        .get(`/units/${form.unit_id}/availability`, { params: { from, to } })
        .then((r) => r.data),
    enabled: Boolean(form.unit_id),
    staleTime: 30_000,
  });

  const { data: pricing, isLoading: pricingLoading } = useQuery({
    queryKey: ['manual-pricing', form.unit_id, from, to],
    queryFn: () =>
      guestApi
        .get(`/units/${form.unit_id}/pricing`, { params: { from, to } })
        .then((r) => r.data),
    enabled: Boolean(form.unit_id),
    staleTime: 30_000,
  });

  const blockedDates = useMemo(
    () => (availability?.blocked || []).map((item) => item.date || item).filter(Boolean),
    [availability]
  );
  const dailyPrices = pricing?.prices || {};

  const nights = useMemo(() => {
    if (!form.check_in || !form.check_out) return 0;
    return Math.max(
      0,
      Math.round(
        (new Date(`${form.check_out}T00:00:00`) - new Date(`${form.check_in}T00:00:00`)) /
          86_400_000
      )
    );
  }, [form.check_in, form.check_out]);

  const scheduledStay = useMemo(() => {
    if (!form.check_in || !form.check_out || !nights) {
      return { complete: false, total: 0, average: 0 };
    }
    let total = 0;
    let count = 0;
    let complete = true;
    const cursor = new Date(`${form.check_in}T00:00:00`);
    const end = new Date(`${form.check_out}T00:00:00`);
    while (cursor < end) {
      const iso = localDateToIso(cursor);
      const price = Number(dailyPrices[iso]);
      if (!(price > 0)) complete = false;
      else {
        total += price;
        count += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return {
      complete: complete && count === nights,
      total,
      average: count ? total / count : 0,
    };
  }, [dailyPrices, form.check_in, form.check_out, nights]);

  const housekeeping = selectedUnit ? housekeepingFeeForUnit(selectedUnit) : 0;
  const total = Number(form.total_amount) || 0;
  const downPayment = Number(form.down_payment) || 0;
  const insurance = Number(form.insurance) || 0;
  const ownerCollected = Number(form.owner_collected_amount) || 0;
  const brokerPerNight = Number(form.broker_amount_per_night) || 0;

  let toCollect = total - downPayment;
  if (form.owner_collected_type === 'full') toCollect = housekeeping + insurance - downPayment;
  if (form.owner_collected_type === 'partial') toCollect = total - ownerCollected - downPayment;
  toCollect = Math.max(0, toCollect);

  useEffect(() => {
    if (!selectedUnit) return;
    const fee = housekeepingFeeForUnit(selectedUnit);
    setForm((cur) =>
      Number(cur.housekeeping_fees) === fee ? cur : { ...cur, housekeeping_fees: String(fee) }
    );
  }, [selectedUnit?.id, setForm]);

  useEffect(() => {
    if (!nights) return;
    if (scheduledStay.complete) {
      setForm((cur) => ({
        ...cur,
        price_per_night: scheduledStay.average.toFixed(2),
        total_amount: scheduledStay.total.toFixed(2),
        owner_collected_amount:
          cur.owner_collected_type === 'full'
            ? scheduledStay.total.toFixed(2)
            : cur.owner_collected_amount,
      }));
      return;
    }
    const fallback = Number(selectedUnit?.price_per_night || selectedUnit?.price_fallback) || 0;
    if (fallback > 0) {
      setForm((cur) => ({
        ...cur,
        price_per_night: fallback.toFixed(2),
        total_amount: (fallback * nights).toFixed(2),
      }));
    }
  }, [
    nights,
    scheduledStay.complete,
    scheduledStay.average,
    scheduledStay.total,
    selectedUnit?.price_per_night,
    selectedUnit?.price_fallback,
    setForm,
  ]);

  function selectUnit(value) {
    setForm((cur) => ({
      ...cur,
      unit_id: value,
      check_in: '',
      check_out: '',
      price_per_night: '',
      total_amount: '',
    }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-5">
          {/* Unit */}
          <div>
            <Label>Unit</Label>
            <SearchableSelect
              value={form.unit_id}
              onChange={selectUnit}
              placeholder="Select a unit…"
              options={[
                { value: '', label: 'Select a unit…' },
                ...units.map((unit) => ({
                  value: String(unit.id),
                  label: `${unit.unit_number || 'Unit'} — ${unit.name} (${unit.project})`,
                })),
              ]}
            />
          </div>

          {/* Calendar — guest parity */}
          <div>
            <Label>Check-in / Check-out</Label>
            {form.unit_id ? (
              <>
                <ListingDatePicker
                  inline
                  value={{
                    start: isoToLocalDate(form.check_in),
                    end: isoToLocalDate(form.check_out),
                  }}
                  onChange={({ start, end }) =>
                    setForm((cur) => ({
                      ...cur,
                      check_in: start ? localDateToIso(start) : '',
                      check_out: end ? localDateToIso(end) : '',
                    }))
                  }
                  blockedDates={blockedDates}
                  dailyPrices={dailyPrices}
                  minNights={1}
                />
                {(availabilityLoading || pricingLoading) && (
                  <p className="mt-2 text-xs text-soul-muted">Loading availability…</p>
                )}
              </>
            ) : (
              <div className="rounded-[22px] border border-soul-line bg-[#faf9f7] px-4 py-8 text-center text-sm text-soul-muted">
                Select a unit to open the calendar with prices and blocked dates.
              </div>
            )}
          </div>

          {/* Guest */}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
              Guest name *
              <div className="flex items-center gap-3 rounded-2xl border border-soul-line bg-white px-4 py-3 focus-within:border-soul-blue">
                <UserRound className="h-4 w-4 text-soul-muted" />
                <input
                  value={form.guest_name}
                  onChange={(e) => setForm((cur) => ({ ...cur, guest_name: e.target.value }))}
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder="Full name"
                />
              </div>
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
              Mobile *
              <input
                value={form.guest_phone}
                onChange={(e) => setForm((cur) => ({ ...cur, guest_phone: e.target.value }))}
                className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                placeholder="+20…"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
              Nationality
              <input
                value={form.guest_nationality}
                onChange={(e) => setForm((cur) => ({ ...cur, guest_nationality: e.target.value }))}
                className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                placeholder="Optional"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
              Email
              <div className="flex items-center gap-3 rounded-2xl border border-soul-line bg-white px-4 py-3 focus-within:border-soul-blue">
                <Mail className="h-4 w-4 text-soul-muted" />
                <input
                  type="email"
                  value={form.guest_email}
                  onChange={(e) => setForm((cur) => ({ ...cur, guest_email: e.target.value }))}
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder="guest@email.com"
                />
              </div>
            </label>
          </div>

          {/* Ops fields */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Booking source</Label>
              <SearchableSelect
                value={form.booking_source}
                onChange={(v) => setForm((cur) => ({ ...cur, booking_source: v }))}
                placeholder="Select source…"
                options={[
                  { value: '', label: 'Select source…' },
                  ...BOOKING_SOURCES.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
            <div>
              <Label>Sales person{!form.is_owner_reservation ? ' *' : ''}</Label>
              {lockSalesPerson ? (
                <div className="rounded-2xl border border-soul-line bg-[#faf9f7] px-4 py-3 text-sm text-soul-blue">
                  {currentUserName || 'Assigned to you'}
                </div>
              ) : (
                <SearchableSelect
                  value={form.sales_person_id}
                  onChange={(v) => setForm((cur) => ({ ...cur, sales_person_id: v }))}
                  placeholder="Select salesperson…"
                  options={[
                    { value: '', label: 'None' },
                    ...users.map((u) => ({ value: String(u.id), label: u.full_name })),
                  ]}
                />
              )}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-soul-line bg-[#faf9f7] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-soul-blue">Owner reservation</p>
              <p className="text-xs text-soul-muted">No utilities deduction</p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(form.is_owner_reservation)}
              onChange={(e) =>
                setForm((cur) => ({ ...cur, is_owner_reservation: e.target.checked }))
              }
              className="h-4 w-4 accent-[var(--soul-blue)]"
            />
          </label>

          {!form.is_owner_reservation && (
            <div>
              <Label>Payment method</Label>
              <div className="grid grid-cols-2 gap-3">
                {MANUAL_PAYMENT_METHODS.map((method) => {
                  const active = form.payment_method === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setForm((cur) => ({ ...cur, payment_method: method }))}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                        active
                          ? 'border-soul-blue bg-soul-blue text-white'
                          : 'border-soul-line text-soul-blue hover:bg-soul-blue-50'
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-soul-muted">
                Stays pending until payment is collected.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
              Down payment
              <input
                type="number"
                min="0"
                value={form.down_payment}
                onChange={(e) => setForm((cur) => ({ ...cur, down_payment: e.target.value }))}
                className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                placeholder="0"
              />
            </label>
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
              Insurance
              <input
                type="number"
                min="0"
                value={form.insurance}
                onChange={(e) => setForm((cur) => ({ ...cur, insurance: e.target.value }))}
                className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                placeholder="0"
              />
            </label>
          </div>

          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
            Notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((cur) => ({ ...cur, notes: e.target.value }))}
              className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
              placeholder="Optional"
            />
          </label>

          <div>
            <Label>Transfer proof</Label>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-soul-line px-4 py-3 text-sm text-soul-muted hover:border-soul-blue hover:text-soul-blue">
              <Upload className="h-4 w-4" />
              <span>{transferProof?.name || 'Upload image or PDF (optional)'}</span>
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => onTransferProofChange?.(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-soul-line px-4 py-3 text-sm font-semibold text-soul-blue hover:bg-soul-blue-50"
          >
            Owner collection, broker & utilities
            <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="grid gap-4 rounded-2xl border border-soul-line bg-[#faf9f7] p-4 md:grid-cols-2">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                Owner collected
                <select
                  className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none"
                  value={form.owner_collected_type}
                  onChange={(e) =>
                    setForm((cur) => ({
                      ...cur,
                      owner_collected_type: e.target.value,
                      owner_collected_amount:
                        e.target.value === 'full' ? cur.total_amount : '',
                    }))
                  }
                >
                  <option value="">No</option>
                  <option value="partial">Partial</option>
                  <option value="full">Full accommodation</option>
                </select>
              </label>
              {form.owner_collected_type === 'partial' && (
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                  Amount
                  <input
                    type="number"
                    min="0"
                    className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none"
                    value={form.owner_collected_amount}
                    onChange={(e) =>
                      setForm((cur) => ({ ...cur, owner_collected_amount: e.target.value }))
                    }
                  />
                </label>
              )}
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                Broker name
                <input
                  className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none"
                  value={form.broker_name}
                  onChange={(e) => setForm((cur) => ({ ...cur, broker_name: e.target.value }))}
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                Broker / night
                <input
                  type="number"
                  min="0"
                  className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none"
                  value={form.broker_amount_per_night}
                  onChange={(e) =>
                    setForm((cur) => ({ ...cur, broker_amount_per_night: e.target.value }))
                  }
                />
              </label>
              {!form.is_owner_reservation && (
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
                  Utilities override / night
                  <input
                    type="number"
                    min="0"
                    className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none"
                    value={form.utilities_cost_override}
                    onChange={(e) =>
                      setForm((cur) => ({ ...cur, utilities_cost_override: e.target.value }))
                    }
                    placeholder={
                      selectedUnit?.utilities_cost
                        ? `Default ${selectedUnit.utilities_cost}`
                        : 'Unit default'
                    }
                  />
                </label>
              )}
              {brokerPerNight > 0 && nights > 0 && (
                <p className="text-xs text-soul-muted md:col-span-2">
                  Broker total: {money(brokerPerNight * nights)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer — same pattern as guest BookingDrawer */}
      <div className="border-t border-soul-line bg-white px-6 py-5">
        <div className="grid gap-3 rounded-3xl border border-soul-line bg-soul-blue-50/40 p-4">
          <div className="flex items-center justify-between text-sm text-soul-muted">
            <span>Average / night</span>
            <span className="font-semibold text-soul-blue">
              {nights ? money(form.price_per_night) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-soul-muted">
            <span>Accommodation ({nights || '—'} nights)</span>
            <span className="font-semibold text-soul-blue">{nights ? money(total) : '—'}</span>
          </div>
          {housekeeping > 0 && (
            <div className="flex items-center justify-between text-sm text-soul-muted">
              <span>Housekeeping</span>
              <span className="font-semibold text-soul-blue">{money(housekeeping)}</span>
            </div>
          )}
          {downPayment > 0 && (
            <div className="flex items-center justify-between text-sm text-soul-muted">
              <span>Down payment</span>
              <span className="font-semibold text-soul-blue">− {money(downPayment)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-soul-line pt-3 text-sm text-soul-muted">
            <span>Still to collect</span>
            <span className="text-lg font-bold text-soul-blue">{money(toCollect)}</span>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-soul-line px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-soul-blue hover:bg-soul-blue-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="inline-flex flex-[1.4] items-center justify-center rounded-full bg-soul-blue px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-white hover:bg-soul-blue-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? 'Saving…' : 'Create reservation'}
          </button>
        </div>
      </div>
    </div>
  );
}
