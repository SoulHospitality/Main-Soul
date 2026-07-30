import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  Building2,
  ChevronDown,
  CircleDollarSign,
  FileUp,
  Landmark,
  ReceiptText,
  UserRound,
  UsersRound,
} from 'lucide-react';
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

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-white">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
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
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedUnit = units.find((unit) => String(unit.id) === String(form.unit_id));
  const selectedRange = useMemo(
    () => ({
      start: isoToLocalDate(form.check_in),
      end: isoToLocalDate(form.check_out),
    }),
    [form.check_in, form.check_out]
  );

  const from = new Date().toISOString().slice(0, 10);
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
        .then((response) => response.data),
    enabled: Boolean(form.unit_id),
    staleTime: 30_000,
  });

  const { data: pricing, isLoading: pricingLoading } = useQuery({
    queryKey: ['manual-pricing', form.unit_id, from, to],
    queryFn: () =>
      guestApi
        .get(`/units/${form.unit_id}/pricing`, { params: { from, to } })
        .then((response) => response.data),
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
        (new Date(`${form.check_out}T00:00:00`) -
          new Date(`${form.check_in}T00:00:00`)) /
          86_400_000
      )
    );
  }, [form.check_in, form.check_out]);

  const scheduledStay = useMemo(() => {
    if (!form.check_in || !form.check_out) return { complete: false, total: 0, average: 0 };
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

  let toCollect = total - downPayment;
  if (form.owner_collected_type === 'full') toCollect = housekeeping + insurance - downPayment;
  if (form.owner_collected_type === 'partial') {
    toCollect = total - ownerCollected - downPayment;
  }
  toCollect = Math.max(0, toCollect);

  useEffect(() => {
    if (!selectedUnit) return;
    const fee = housekeepingFeeForUnit(selectedUnit);
    setForm((current) => ({
      ...current,
      housekeeping_fees: String(fee),
    }));
  }, [selectedUnit?.id, setForm]);

  useEffect(() => {
    if (!nights) return;
    if (scheduledStay.complete) {
      setForm((current) => ({
        ...current,
        price_per_night: scheduledStay.average.toFixed(2),
        total_amount: scheduledStay.total.toFixed(2),
        owner_collected_amount:
          current.owner_collected_type === 'full'
            ? scheduledStay.total.toFixed(2)
            : current.owner_collected_amount,
      }));
      return;
    }
    const fallback = Number(selectedUnit?.price_per_night || selectedUnit?.price_fallback) || 0;
    if (fallback > 0) {
      setForm((current) => ({
        ...current,
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
    setForm((current) => ({
      ...current,
      unit_id: value,
      check_in: '',
      check_out: '',
      price_per_night: '',
      total_amount: '',
    }));
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Section
          icon={Building2}
          title="Choose a unit and dates"
          description="The calendar uses the same availability and nightly prices guests see."
        >
          <Field label="Unit" required>
            <SearchableSelect
              value={form.unit_id}
              onChange={selectUnit}
              placeholder="Search by unit number or property"
              options={[
                { value: '', label: 'Select a unit' },
                ...units.map((unit) => ({
                  value: String(unit.id),
                  label: `${unit.unit_number || 'Unit'} — ${unit.name} (${unit.project})`,
                })),
              ]}
            />
          </Field>

          <div className="mt-4">
            {form.unit_id ? (
              <>
                <ListingDatePicker
                  inline
                  value={selectedRange}
                  onChange={({ start, end }) =>
                    setForm((current) => ({
                      ...current,
                      check_in: localDateToIso(start),
                      check_out: localDateToIso(end),
                    }))
                  }
                  blockedDates={blockedDates}
                  dailyPrices={dailyPrices}
                  minNights={1}
                />
                {(availabilityLoading || pricingLoading) && (
                  <p className="mt-2 text-xs text-slate-400">Loading live availability and prices…</p>
                )}
              </>
            ) : (
              <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center">
                <div>
                  <Building2 className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">Select a unit to view its calendar</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section
          icon={UserRound}
          title="Guest details"
          description="Contact information for the reservation."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Guest name" required>
              <input
                className="input"
                value={form.guest_name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guest_name: event.target.value }))
                }
                placeholder="Full name"
              />
            </Field>
            <Field label="Mobile number" required>
              <input
                className="input"
                value={form.guest_phone}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guest_phone: event.target.value }))
                }
                placeholder="+20"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className="input"
                value={form.guest_email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guest_email: event.target.value }))
                }
                placeholder="guest@email.com"
              />
            </Field>
            <Field label="Nationality">
              <input
                className="input"
                value={form.guest_nationality}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guest_nationality: event.target.value }))
                }
                placeholder="Egyptian"
              />
            </Field>
          </div>
        </Section>

        <Section
          icon={UsersRound}
          title="Reservation ownership"
          description="Choose the source, salesperson, and owner/broker handling."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Booking source">
              <SearchableSelect
                value={form.booking_source}
                onChange={(value) =>
                  setForm((current) => ({ ...current, booking_source: value }))
                }
                placeholder="Select source"
                options={[
                  { value: '', label: 'Select source' },
                  ...BOOKING_SOURCES.map((source) => ({ value: source, label: source })),
                ]}
              />
            </Field>
            <Field label="Sales person" required={!form.is_owner_reservation}>
              {lockSalesPerson ? (
                <div className="input bg-slate-50 text-slate-700">
                  {currentUserName || 'Assigned to you'}
                </div>
              ) : (
                <SearchableSelect
                  value={form.sales_person_id}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, sales_person_id: value }))
                  }
                  placeholder="Select salesperson"
                  options={[
                    { value: '', label: 'None' },
                    ...users.map((user) => ({
                      value: String(user.id),
                      label: user.full_name,
                    })),
                  ]}
                />
              )}
            </Field>
          </div>

          <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">Owner reservation</p>
              <p className="text-xs text-amber-700">No utilities deduction will be applied.</p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(form.is_owner_reservation)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  is_owner_reservation: event.target.checked,
                }))
              }
              className="h-4 w-4 accent-amber-600"
            />
          </label>

          <button
            type="button"
            onClick={() => setShowAdvanced((current) => !current)}
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Owner collection, broker and utilities
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 rounded-xl bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Owner collected">
                  <select
                    className="input"
                    value={form.owner_collected_type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        owner_collected_type: event.target.value,
                        owner_collected_amount:
                          event.target.value === 'full' ? current.total_amount : '',
                      }))
                    }
                  >
                    <option value="">No</option>
                    <option value="partial">Partial payment</option>
                    <option value="full">Full accommodation</option>
                  </select>
                </Field>
                {form.owner_collected_type === 'partial' && (
                  <Field label="Amount collected">
                    <input
                      type="number"
                      min="0"
                      className="input"
                      value={form.owner_collected_amount}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          owner_collected_amount: event.target.value,
                        }))
                      }
                    />
                  </Field>
                )}
                <Field label="Broker name">
                  <input
                    className="input"
                    value={form.broker_name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, broker_name: event.target.value }))
                    }
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Broker amount / night">
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={form.broker_amount_per_night}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        broker_amount_per_night: event.target.value,
                      }))
                    }
                    placeholder="0"
                  />
                </Field>
                {!form.is_owner_reservation && (
                  <Field
                    label="Utilities override / night"
                    hint={`Default: ${money(selectedUnit?.utilities_cost)}`}
                  >
                    <input
                      type="number"
                      min="0"
                      className="input"
                      value={form.utilities_cost_override}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          utilities_cost_override: event.target.value,
                        }))
                      }
                      placeholder="Use unit default"
                    />
                  </Field>
                )}
              </div>
              {brokerTotal > 0 && (
                <p className="text-xs font-medium text-purple-700">
                  Broker total: {money(brokerTotal)} for {nights} nights
                </p>
              )}
            </div>
          )}
        </Section>
      </div>

      <aside className="space-y-5 xl:sticky xl:top-0 xl:self-start">
        <Section icon={ReceiptText} title="Price summary">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>{nights || 0} nights</span>
              <span>{nights ? money(total) : '—'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Average / night">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.price_per_night}
                  onChange={(event) => {
                    const rate = event.target.value;
                    setForm((current) => ({
                      ...current,
                      price_per_night: rate,
                      total_amount: nights ? (Number(rate || 0) * nights).toFixed(2) : '',
                    }));
                  }}
                />
              </Field>
              <Field label="Accommodation">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.total_amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, total_amount: event.target.value }))
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Down payment">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.down_payment}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, down_payment: event.target.value }))
                  }
                />
              </Field>
              <Field label="Insurance">
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.insurance}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, insurance: event.target.value }))
                  }
                />
              </Field>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-slate-600">
              <span>Housekeeping</span>
              <span>{selectedUnit ? money(housekeeping) : '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-3 text-white">
              <span className="text-xs font-semibold uppercase tracking-wide">Still to collect</span>
              <strong>{money(toCollect)}</strong>
            </div>
          </div>
        </Section>

        {!form.is_owner_reservation && (
          <Section icon={CircleDollarSign} title="Collection">
            <p className="mb-3 text-xs text-slate-500">
              The reservation remains pending until Finance records or approves payment.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {MANUAL_PAYMENT_METHODS.map((method) => {
                const Icon = method === 'cash' ? Banknote : Landmark;
                const active = form.payment_method === method;
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({ ...current, payment_method: method }))
                    }
                    className={`rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <Icon className="mb-2 h-4 w-4" />
                    <span className="text-sm font-semibold">
                      {PAYMENT_METHOD_LABELS[method]}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <Section icon={FileUp} title="Notes and proof">
          <Field label="Internal notes">
            <textarea
              className="input min-h-20 resize-none"
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder="Anything the operations team should know"
            />
          </Field>
          <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center hover:border-slate-500">
            <FileUp className="mx-auto mb-1 h-5 w-5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">
              {transferProof?.name || 'Upload payment proof'}
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(event) => onTransferProofChange(event.target.files?.[0] || null)}
            />
          </label>
        </Section>
      </aside>
    </div>
  );
}
