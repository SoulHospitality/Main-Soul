import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Upload } from 'lucide-react';
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
import {
  appliedPctLabel,
  calcReservationFinancials,
  commissionModeLabel,
} from '../utils/commission';

const money = (value) =>
  `EGP ${Number(value || 0).toLocaleString('en-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const fieldClass =
  'w-full rounded-[10px] border border-[#e6ebf2] bg-white px-3 py-2.5 text-sm text-[#0f1c2e] outline-none placeholder:text-[#8b97aa] focus:border-[#1e5fbf] focus:ring-2 focus:ring-[#eef4ff]';

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
    <p className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
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
  const brokerTotal = brokerPerNight * nights;
  const utilitiesPerNight = form.is_owner_reservation
    ? 0
    : Number(form.utilities_cost_override || selectedUnit?.utilities_cost) || 0;
  const commissionFinancials = selectedUnit
    ? calcReservationFinancials(selectedUnit, {
        ...form,
        nights,
        broker_total: brokerTotal,
        utilities_amount: utilitiesPerNight * nights,
      })
    : null;

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
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
      <div className="space-y-5">
          <div>
            <Label>Unit <span className="text-[#ff7a59]">*</span></Label>
            <SearchableSelect
              value={form.unit_id}
              onChange={selectUnit}
              placeholder="Search or select a unit…"
              options={[
                { value: '', label: 'Select a unit…' },
                ...units.map((unit) => ({
                  value: String(unit.id),
                  label: `${unit.unit_number || 'Unit'} — ${unit.name} (${unit.project})`,
                })),
              ]}
            />
          </div>

          <div>
            <Label>Check-in / Check-out <span className="text-[#ff7a59]">*</span></Label>
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
                  <p className="mt-2 text-xs text-[#5b6b80]">Loading availability…</p>
                )}
              </>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[#e6ebf2] bg-[#f6f8fb] px-4 py-8 text-center text-sm text-[#5b6b80]">
                Select a unit to view its calendar, nightly prices, and blocked dates.
              </div>
            )}
          </div>

          {nights > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nights</Label>
                <div className={`${fieldClass} bg-[#f6f8fb] font-semibold`}>{nights}</div>
              </div>
              <div>
                <Label>Accommodation total</Label>
                <div className={`${fieldClass} bg-[#f6f8fb] font-semibold`}>{money(total)}</div>
              </div>
            </div>
          )}

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            Guest
          </div>
          <div>
            <Label>Name <span className="text-[#ff7a59]">*</span></Label>
            <input
              value={form.guest_name}
              onChange={(e) => setForm((cur) => ({ ...cur, guest_name: e.target.value }))}
              className={fieldClass}
              placeholder="Guest full name"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Phone <span className="text-[#ff7a59]">*</span></Label>
              <input
                value={form.guest_phone}
                onChange={(e) => setForm((cur) => ({ ...cur, guest_phone: e.target.value }))}
                className={fieldClass}
                placeholder="+20…"
              />
            </div>
            <div>
              <Label>Email</Label>
              <input
                type="email"
                value={form.guest_email}
                onChange={(e) => setForm((cur) => ({ ...cur, guest_email: e.target.value }))}
                className={fieldClass}
                placeholder="optional"
              />
            </div>
          </div>
          <div>
            <Label>Nationality</Label>
            <input
              value={form.guest_nationality}
              onChange={(e) => setForm((cur) => ({ ...cur, guest_nationality: e.target.value }))}
              className={fieldClass}
              placeholder="optional"
            />
          </div>

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            Booking
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Booking source</Label>
              <SearchableSelect
                value={form.booking_source}
                onChange={(value) => setForm((cur) => ({ ...cur, booking_source: value }))}
                placeholder="Select source…"
                options={[
                  { value: '', label: 'Select source…' },
                  ...BOOKING_SOURCES.map((source) => ({ value: source, label: source })),
                ]}
              />
            </div>
            <div>
              <Label>Sales person{!form.is_owner_reservation ? ' *' : ''}</Label>
              {lockSalesPerson ? (
                <div className={`${fieldClass} bg-[#f6f8fb] text-[#5b6b80]`}>
                  {currentUserName || 'Assigned to you'}
                </div>
              ) : (
                <SearchableSelect
                  value={form.sales_person_id}
                  onChange={(value) => setForm((cur) => ({ ...cur, sales_person_id: value }))}
                  placeholder="Select salesperson…"
                  options={[
                    { value: '', label: 'None' },
                    ...users.map((user) => ({ value: String(user.id), label: user.full_name })),
                  ]}
                />
              )}
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] px-3 py-2.5">
            <input
              type="checkbox"
              checked={Boolean(form.is_owner_reservation)}
              onChange={(event) =>
                setForm((cur) => ({ ...cur, is_owner_reservation: event.target.checked }))
              }
              className="mt-0.5 h-4 w-4 accent-[#1e5fbf]"
            />
            <span>
              <span className="block text-sm font-semibold text-[#0f1c2e]">Owner reservation</span>
              <span className="block text-[12.5px] text-[#5b6b80]">
                Mark owner stays and skip utilities deduction.
              </span>
            </span>
          </label>

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            Payment & commission
          </div>

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
                      className={`rounded-[10px] border px-3 py-2.5 text-sm font-semibold transition ${
                        active
                          ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                          : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Down payment</Label>
              <input
                type="number"
                min="0"
                value={form.down_payment}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, down_payment: event.target.value }))
                }
                className={fieldClass}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Insurance</Label>
              <input
                type="number"
                min="0"
                value={form.insurance}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, insurance: event.target.value }))
                }
                className={fieldClass}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Broker name</Label>
              <input
                value={form.broker_name}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, broker_name: event.target.value }))
                }
                className={fieldClass}
                placeholder="optional"
              />
            </div>
            <div>
              <Label>Broker amount / night</Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.broker_amount_per_night}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, broker_amount_per_night: event.target.value }))
                }
                className={fieldClass}
                placeholder="0"
              />
            </div>
          </div>

          {brokerPerNight > 0 && (
            <p className="rounded-[10px] bg-[#faf5ff] px-3 py-2 text-[12.5px] text-purple-800">
              Broker total: <strong>{nights ? money(brokerTotal) : 'select dates'}</strong>
              {nights > 0 && (
                <> · Net nightly rate after broker: <strong>{money(Math.max(0, Number(form.price_per_night) - brokerPerNight))}</strong></>
              )}
            </p>
          )}

          {selectedUnit && (
            <div className="rounded-[10px] border border-[#dbe7f8] bg-[#eef4ff] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#0f1c2e]">Company commission</p>
                  <p className="mt-0.5 text-[12px] text-[#5b6b80]">
                    {commissionModeLabel(selectedUnit)}
                  </p>
                </div>
                <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#1e5fbf]">
                  {appliedPctLabel(commissionFinancials, selectedUnit)}
                </span>
              </div>
              {nights > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                  <span className="text-[#5b6b80]">Company commission</span>
                  <strong className="text-right text-[#0f1c2e]">
                    {money(commissionFinancials?.companyCommission)}
                  </strong>
                  <span className="text-[#5b6b80]">Estimated owner net</span>
                  <strong className="text-right text-[#0f7d3a]">
                    {money(commissionFinancials?.ownerNet)}
                  </strong>
                  {commissionFinancials?.tenantDeduction > 0 && (
                    <>
                      <span className="text-[#5b6b80]">Tenant deduction</span>
                      <strong className="text-right text-[#0f1c2e]">
                        {money(commissionFinancials.tenantDeduction)}
                      </strong>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="flex w-full items-center justify-between rounded-[10px] border border-[#e6ebf2] px-3 py-2.5 text-sm font-semibold text-[#1e5fbf] hover:bg-[#eef4ff]"
          >
            Owner collection & utilities
            <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Owner collected</Label>
                  <select
                    className={fieldClass}
                    value={form.owner_collected_type}
                    onChange={(event) =>
                      setForm((cur) => ({
                        ...cur,
                        owner_collected_type: event.target.value,
                        owner_collected_amount:
                          event.target.value === 'full' ? cur.total_amount : '',
                      }))
                    }
                  >
                    <option value="">No</option>
                    <option value="partial">Partial</option>
                    <option value="full">Full accommodation</option>
                  </select>
                </div>
                {form.owner_collected_type === 'partial' && (
                  <div>
                    <Label>Amount collected</Label>
                    <input
                      type="number"
                      min="0"
                      className={fieldClass}
                      value={form.owner_collected_amount}
                      onChange={(event) =>
                        setForm((cur) => ({
                          ...cur,
                          owner_collected_amount: event.target.value,
                        }))
                      }
                    />
                  </div>
                )}
              </div>
              {!form.is_owner_reservation && (
                <div>
                  <Label>Utilities override / night</Label>
                  <input
                    type="number"
                    min="0"
                    className={fieldClass}
                    value={form.utilities_cost_override}
                    onChange={(event) =>
                      setForm((cur) => ({
                        ...cur,
                        utilities_cost_override: event.target.value,
                      }))
                    }
                    placeholder={
                      selectedUnit?.utilities_cost
                        ? `Default ${selectedUnit.utilities_cost}`
                        : 'Unit default'
                    }
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Notes (internal)</Label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((cur) => ({ ...cur, notes: event.target.value }))}
              className={`${fieldClass} resize-none`}
              placeholder="Payment details, guest requests, or internal notes…"
            />
          </div>

          <div>
            <Label>Transfer proof</Label>
            <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-[#e6ebf2] px-3 py-2.5 text-sm text-[#5b6b80] hover:border-[#1e5fbf] hover:bg-[#eef4ff]">
              <Upload className="h-4 w-4" />
              <span>{transferProof?.name || 'Upload image or PDF (optional)'}</span>
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(event) => onTransferProofChange?.(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] p-3 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-[#5b6b80]">Accommodation ({nights || '—'} nights)</span>
              <strong className="text-[#0f1c2e]">{nights ? money(total) : '—'}</strong>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#5b6b80]">Housekeeping</span>
              <strong className="text-[#0f1c2e]">{money(housekeeping)}</strong>
            </div>
            {downPayment > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">Down payment</span>
                <strong className="text-[#0f7d3a]">− {money(downPayment)}</strong>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-[#e6ebf2] pt-3">
              <span className="font-semibold text-[#0f1c2e]">Still to collect</span>
              <strong className="text-base text-[#1e5fbf]">{money(toCollect)}</strong>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-[12px] bg-[#1e5fbf] px-6 py-3 font-semibold text-white hover:bg-[#16489a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Create reservation'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-semibold text-[#5b6b80] hover:text-[#0f1c2e]"
            >
              Cancel
            </button>
          </div>

          <p className="text-[12.5px] text-[#5b6b80]">
            These dates will immediately block the unit calendar after the reservation is created.
          </p>
      </div>
    </div>
  );
}
