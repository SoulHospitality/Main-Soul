import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Eye, Ban, CreditCard, CalendarDays, Upload, Download, CheckCircle, AlertCircle, Lock, Trash2, Maximize2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SearchableSelect from '../components/ui/SearchableSelect';
import SortTh from '../components/ui/SortTh';
import BookingCalendar from '../components/ui/BookingCalendar';
import { currency, formatDate, nightsText, BOOKING_SOURCES, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import { calcReservationFinancials, commissionModeLabel, appliedPctLabel } from '../utils/commission';
import WebsiteBookingRequests from '../components/WebsiteBookingRequests';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';

const EMPTY_FORM = {
  unit_id: '', guest_name: '', guest_email: '', guest_phone: '', guest_nationality: '',
  check_in: '', check_out: '', price_per_night: '', total_amount: '',
  down_payment: '', housekeeping_fees: '', insurance: '',
  booking_source: '', sales_person_id: '', is_owner_reservation: false, notes: '',
  owner_collected_type: '',   // '' | 'partial' | 'full'
  owner_collected_amount: '',
  utilities_cost_override: '',
  broker_name: '',
  broker_amount_per_night: '',
};
const EMPTY_PMT = { amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'cash', reference_number: '', notes: '' };

function calcNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const d = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  return d > 0 ? d : 0;
}

function ReservationForm({ form, setForm, units, users, isNew, transferProof, onTransferProofChange, editId, allowPastDates }) {
  // Auto-fill price_per_night from selected unit
  const selectedUnit = units.find(u => String(u.id) === String(form.unit_id));

  useEffect(() => {
    if (selectedUnit && isNew && !form.price_per_night) {
      setForm(f => ({ ...f, price_per_night: selectedUnit.price_per_night || '' }));
    }
  }, [form.unit_id]);

  // Fixed housekeeping by property type (villa 2500, else 1500)
  useEffect(() => {
    if (!selectedUnit) return;
    const fee = housekeepingFeeForUnit(selectedUnit);
    setForm((f) => (Number(f.housekeeping_fees) === fee ? f : { ...f, housekeeping_fees: String(fee) }));
  }, [form.unit_id, selectedUnit?.property_type, selectedUnit?.type]);

  const nights = calcNights(form.check_in, form.check_out);

  // Auto-calculate total when nights or price changes
  useEffect(() => {
    if (nights > 0 && form.price_per_night) {
      const total = nights * parseFloat(form.price_per_night);
      setForm(f => ({ ...f, total_amount: total.toFixed(2) }));
    }
  }, [nights, form.price_per_night]);

  const total = parseFloat(form.total_amount) || 0;
  const downPmt = parseFloat(form.down_payment) || 0;
  const hkFees = selectedUnit
    ? housekeepingFeeForUnit(selectedUnit)
    : (parseFloat(form.housekeeping_fees) || 0);
  const ins     = parseFloat(form.insurance) || 0;
  const ownerCollectedAmt = parseFloat(form.owner_collected_amount) || 0;

  // Amount WE still need to collect from tenant:
  let amountToPay;
  if (form.owner_collected_type === 'full') {
    // Owner collected everything — we only collect housekeeping + insurance
    amountToPay = hkFees + ins - downPmt;
  } else if (form.owner_collected_type === 'partial') {
    amountToPay = total - ownerCollectedAmt - downPmt;
  } else {
    amountToPay = total - downPmt;
  }

  return (
    <div className="space-y-5">
      {/* Unit + Guest */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Unit *</label>
          <SearchableSelect
            value={form.unit_id} onChange={v => setForm(f => ({ ...f, unit_id: v, price_per_night: '' }))}
            placeholder="Select unit…"
            options={[{ value: '', label: 'Select unit…' }, ...units.map(u => ({ value: String(u.id), label: `${u.unit_number} — ${u.name} (${u.project})` }))]}
          />
        </div>
        <div>
          <label className="label">Booking Source</label>
          <SearchableSelect
            value={form.booking_source} onChange={v => setForm(f => ({ ...f, booking_source: v }))}
            placeholder="Select source…"
            options={[{ value: '', label: 'Select source…' }, ...BOOKING_SOURCES.map(s => ({ value: s, label: s }))]}
          />
        </div>
        <div><label className="label">Tenant Name *</label><input className="input" value={form.guest_name} onChange={e => setForm(f => ({ ...f, guest_name: e.target.value }))} placeholder="Full name" /></div>
        <div><label className="label">Mobile No. *</label><input className="input" value={form.guest_phone} onChange={e => setForm(f => ({ ...f, guest_phone: e.target.value }))} placeholder="+20..." /></div>
        <div><label className="label">Email</label><input type="email" className="input" value={form.guest_email} onChange={e => setForm(f => ({ ...f, guest_email: e.target.value }))} /></div>
        <div><label className="label">Nationality</label><input className="input" value={form.guest_nationality} onChange={e => setForm(f => ({ ...f, guest_nationality: e.target.value }))} /></div>
      </div>

      {/* Dates */}
      <div>
        <label className="label mb-2">Dates *</label>
        {allowPastDates ? (
          /* Admin / Finance / Owner Experience: simple date inputs — allow any past date */
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs text-gray-500">Check-in *</label>
              <input
                type="date"
                className="input"
                value={form.check_in}
                onChange={e => setForm(f => ({ ...f, check_in: e.target.value, check_out: f.check_out && e.target.value >= f.check_out ? '' : f.check_out }))}
              />
            </div>
            <div>
              <label className="label text-xs text-gray-500">Check-out *</label>
              <input
                type="date"
                className="input"
                value={form.check_out}
                min={form.check_in ? form.check_in : undefined}
                onChange={e => setForm(f => ({ ...f, check_out: e.target.value }))}
              />
            </div>
            <p className="col-span-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              ⚠️ Past dates allowed — please verify there are no conflicts
            </p>
          </div>
        ) : (
          /* All other roles: interactive calendar with availability check */
          <BookingCalendar
            checkIn={form.check_in}
            checkOut={form.check_out}
            onChange={(ci, co) => setForm(f => ({ ...f, check_in: ci, check_out: co }))}
            unitId={form.unit_id}
            excludeId={editId}
          />
        )}
        <input type="hidden" value={form.check_in} />
        <input type="hidden" value={form.check_out} />
      </div>

      {/* Financials */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-semibold text-blue-900">💰 Financial Details</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Price per Night (EGP) *</label>
            <input type="number" min="0" step="0.01" className="input" value={form.price_per_night}
              onChange={e => setForm(f => ({ ...f, price_per_night: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Total Amount (EGP) <span className="text-blue-400 text-xs">(auto)</span></label>
            <input type="number" min="0" step="0.01" className="input bg-blue-50" value={form.total_amount}
              onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Down Payment collected by us (EGP)</label>
            <input type="number" min="0" step="0.01" className="input" value={form.down_payment}
              onChange={e => setForm(f => ({ ...f, down_payment: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Housekeeping Fees (EGP)</label>
            <div className="input bg-gray-50 text-gray-700 font-medium">
              {selectedUnit
                ? `EGP ${hkFees.toLocaleString('en-EG')} (${String(selectedUnit.type || selectedUnit.property_type || '').toLowerCase() === 'villa' ? 'Villa' : 'Standard'})`
                : 'Select a unit'}
            </div>
            <p className="text-xs text-gray-400 mt-1">Fixed: 1,500 EGP · Villas 2,500 EGP</p>
          </div>
          <div>
            <label className="label">Insurance (EGP)</label>
            <input type="number" min="0" step="0.01" className="input" value={form.insurance}
              onChange={e => setForm(f => ({ ...f, insurance: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className="label">We Still Need to Collect (EGP)</label>
            <div className={`input font-semibold ${amountToPay > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'}`}>
              {total > 0 || form.owner_collected_type === 'full'
                ? `EGP ${amountToPay.toLocaleString('en-EG', { minimumFractionDigits: 2 })}`
                : '—'}
            </div>
          </div>
        </div>

        {/* Owner Collected Payment */}
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="owner_collected_toggle"
              checked={!!form.owner_collected_type}
              onChange={e => setForm(f => ({
                ...f,
                owner_collected_type: e.target.checked ? 'partial' : '',
                owner_collected_amount: '',
              }))}
              className="w-4 h-4 rounded border-amber-400 text-amber-600"
            />
            <label htmlFor="owner_collected_toggle" className="text-sm font-semibold text-amber-800">
              🏠 Owner collected payment from tenant
            </label>
          </div>

          {form.owner_collected_type && (
            <div className="space-y-3 pl-1">
              {/* Radio: partial vs full */}
              <div className="flex gap-4">
                <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-colors text-sm font-medium
                  ${form.owner_collected_type === 'partial'
                    ? 'border-amber-500 bg-amber-100 text-amber-800'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}>
                  <input
                    type="radio" name="owner_collected_type" value="partial"
                    checked={form.owner_collected_type === 'partial'}
                    onChange={() => setForm(f => ({ ...f, owner_collected_type: 'partial' }))}
                    className="accent-amber-600"
                  />
                  Partial Down Payment
                </label>
                <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-colors text-sm font-medium
                  ${form.owner_collected_type === 'full'
                    ? 'border-green-500 bg-green-100 text-green-800'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}>
                  <input
                    type="radio" name="owner_collected_type" value="full"
                    checked={form.owner_collected_type === 'full'}
                    onChange={() => setForm(f => ({ ...f, owner_collected_type: 'full', owner_collected_amount: form.total_amount }))}
                    className="accent-green-600"
                  />
                  Full Payment
                </label>
              </div>

              {/* Amount field — only for partial */}
              {form.owner_collected_type === 'partial' && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-amber-700 font-medium whitespace-nowrap">Amount collected by owner:</label>
                  <input
                    type="number" min="0" step="0.01"
                    className="input w-40"
                    value={form.owner_collected_amount}
                    onChange={e => setForm(f => ({ ...f, owner_collected_amount: e.target.value }))}
                    placeholder="0.00"
                  />
                  <span className="text-sm text-amber-600">EGP</span>
                </div>
              )}

              {/* Summary note */}
              <div className={`text-xs rounded-lg px-3 py-2 font-medium
                ${form.owner_collected_type === 'full'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-amber-100 text-amber-800'}`}>
                {form.owner_collected_type === 'full'
                  ? `✓ Owner collected full reservation amount. We only collect housekeeping${ins > 0 ? ' + insurance' : ''} = EGP ${(hkFees + ins).toLocaleString('en-EG', { minimumFractionDigits: 2 })}. Commission still charged on full total.`
                  : ownerCollectedAmt > 0
                    ? `Owner collected EGP ${ownerCollectedAmt.toLocaleString('en-EG', { minimumFractionDigits: 2 })} — deducted from what we collect. Commission still charged on full total.`
                    : 'Enter amount the owner collected from the tenant.'}
              </div>
            </div>
          )}
        </div>

        {/* Broker */}
        <div className="border border-purple-200 bg-purple-50 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="broker_toggle"
              checked={!!form.broker_amount_per_night}
              onChange={e => setForm(f => ({ ...f, broker_amount_per_night: e.target.checked ? '' : '', broker_name: e.target.checked ? f.broker_name : '' }))}
              className="w-4 h-4 rounded border-purple-400 text-purple-600"
            />
            <label htmlFor="broker_toggle" className="text-sm font-semibold text-purple-800">
              🤝 Broker Commission
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs text-purple-700">Broker Name</label>
              <input
                type="text"
                className="input"
                value={form.broker_name}
                onChange={e => setForm(f => ({ ...f, broker_name: e.target.value }))}
                placeholder="e.g. Ahmed Ali"
              />
            </div>
            <div>
              <label className="label text-xs text-purple-700">Broker Amount / Night (EGP)</label>
              <input
                type="number" min="0" step="0.01"
                className="input"
                value={form.broker_amount_per_night}
                onChange={e => setForm(f => ({ ...f, broker_amount_per_night: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>
          {form.broker_amount_per_night > 0 && nights > 0 && (
            <div className="text-xs bg-purple-100 text-purple-800 rounded-lg px-3 py-2 space-y-1">
              <div>🤝 Broker total: <strong>EGP {(parseFloat(form.broker_amount_per_night) * nights).toFixed(2)}</strong> ({nights} nights × EGP {form.broker_amount_per_night})</div>
              <div>💰 Net price/night (after broker): <strong>EGP {(parseFloat(form.price_per_night || 0) - parseFloat(form.broker_amount_per_night)).toFixed(2)}</strong></div>
            </div>
          )}
        </div>

        {selectedUnit && !form.is_owner_reservation && (
          <div className="border border-blue-200 bg-blue-50 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-blue-800 whitespace-nowrap">⚡ Utilities/night (EGP)</span>
              <input
                type="number" min="0" step="0.01"
                className="input w-36 text-sm"
                value={form.utilities_cost_override}
                onChange={e => setForm(f => ({ ...f, utilities_cost_override: e.target.value }))}
                placeholder={selectedUnit?.utilities_cost ? `${selectedUnit.utilities_cost} (default)` : '0.00'}
              />
              {form.utilities_cost_override && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, utilities_cost_override: '' }))}
                  className="text-xs text-blue-500 hover:text-blue-700 underline"
                >reset to default</button>
              )}
            </div>
            <div className="text-xs text-blue-700">
              {form.utilities_cost_override
                ? <>Using override: <strong>EGP {form.utilities_cost_override}/night</strong>{nights > 0 && ` → total EGP ${(parseFloat(form.utilities_cost_override) * nights).toFixed(2)}`}</>
                : selectedUnit?.utilities_cost > 0
                  ? <>Unit default: <strong>EGP {selectedUnit.utilities_cost}/night</strong>{nights > 0 && ` → total EGP ${(selectedUnit.utilities_cost * nights).toFixed(2)}`}</>
                  : 'Leave blank to use unit default (currently EGP 0)'
              }
            </div>
          </div>
        )}
      </div>

      {/* Owner flag + sales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <input type="checkbox" id="is_owner_res" checked={!!form.is_owner_reservation}
            onChange={e => setForm(f => ({ ...f, is_owner_reservation: e.target.checked }))}
            className="w-4 h-4 rounded border-gray-300 text-primary-600" />
          <label htmlFor="is_owner_res" className="text-sm font-medium text-amber-800">Owner Reservation — no utilities deduction</label>
        </div>
        <div>
          <label className="label">Sales Person {!form.is_owner_reservation && <span className="text-red-500">*</span>}</label>
          <SearchableSelect
            value={form.sales_person_id} onChange={v => setForm(f => ({ ...f, sales_person_id: v }))}
            placeholder="Select sales person…"
            options={[{ value: '', label: 'None' }, ...users.map(u => ({ value: String(u.id), label: u.full_name }))]}
          />
        </div>
      </div>

      <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>

      {/* Transfer proof (new reservations only) */}
      {isNew && (
        <div className="border border-dashed border-gray-300 rounded-lg px-4 py-3">
          <label className="label flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" />Transfer Proof (optional)</label>
          <input type="file" accept="image/*,.pdf" onChange={e => onTransferProofChange(e.target.files[0] || null)}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
          {transferProof && <p className="text-xs text-green-600 mt-1">✓ {transferProof.name}</p>}
        </div>
      )}
    </div>
  );
}

function PaymentForm({ form, setForm, onFileChange }) {
  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div><label className="label">Amount (EGP) *</label><input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
        <div><label className="label">Date *</label><input type="date" className="input" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} /></div>
        <div>
          <label className="label">Method *</label>
          <SearchableSelect
            value={form.payment_method} onChange={v => setForm(f => ({ ...f, payment_method: v }))}
            options={PAYMENT_METHODS.map(m => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
          />
        </div>
        <div><label className="label">Reference #</label><input className="input" value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} /></div>
      </div>
      <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      {onFileChange && (
        <div>
          <label className="label">Payment Receipt / Document</label>
          <input type="file" accept="image/*,.pdf" onChange={e => onFileChange(e.target.files[0])}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100" />
          <p className="text-xs text-gray-400 mt-1">Upload payment proof (image or PDF, max 10MB)</p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, bold }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-28 flex-shrink-0">{label}:</span>
      <span className={`text-gray-900 ${bold ? 'font-semibold' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function ReservationDetail({ reservation, onAddPayment, canPay, canApprove, onApprovePayment }) {
  if (!reservation) return null;
  const downPmt   = parseFloat(reservation.down_payment) || 0;
  const total     = parseFloat(reservation.total_amount) || 0;
  const hkFees    = parseFloat(reservation.housekeeping_fees) || 0;
  const ins       = parseFloat(reservation.insurance) || 0;
  const ownerAmt  = parseFloat(reservation.owner_collected_amount) || 0;
  let amountToPay;
  if (reservation.owner_collected_type === 'full') {
    amountToPay = hkFees + ins - downPmt;
  } else if (reservation.owner_collected_type === 'partial') {
    amountToPay = total - ownerAmt - downPmt;
  } else {
    amountToPay = total - downPmt;
  }

  // Commission engine — reservation carries unit commission fields from the JOIN
  const fin = calcReservationFinancials(
    {
      commission_mode:             reservation.commission_mode,
      company_commission_pct:      reservation.company_commission_pct,
      company_commission_owner_pct: reservation.company_commission_owner_pct,
      commission_tenant_pct:       reservation.commission_tenant_pct,
      utilities_cost:              reservation.unit_utilities_cost,
    },
    reservation
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <InfoRow label="Unit" value={reservation.unit_name} />
          <InfoRow label="Tenant" value={reservation.guest_name} />
          <InfoRow label="Mobile" value={reservation.guest_phone} />
          <InfoRow label="Email" value={reservation.guest_email} />
          <InfoRow label="Nationality" value={reservation.guest_nationality} />
          <InfoRow label="Source" value={reservation.booking_source} />
        </div>
        <div className="space-y-2">
          <InfoRow label="Check-in" value={formatDate(reservation.check_in)} />
          <InfoRow label="Check-out" value={formatDate(reservation.check_out)} />
          <InfoRow label="Nights" value={nightsText(reservation.nights)} />
          <InfoRow label="Price/Night" value={reservation.price_per_night > 0 ? currency(reservation.price_per_night) : '—'} />
          <InfoRow label="Total" value={currency(total)} bold />
          <InfoRow label="Down Payment" value={currency(downPmt)} />
        </div>
      </div>

      {/* Financial summary */}
      <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
        {/* Owner collected block */}
        {reservation.owner_collected_type && (
          <div className={`flex justify-between rounded-lg px-2 py-1 mb-1
            ${reservation.owner_collected_type === 'full' ? 'bg-green-50' : 'bg-amber-50'}`}>
            <span className={reservation.owner_collected_type === 'full' ? 'text-green-700' : 'text-amber-700'}>
              🏠 Owner collected ({reservation.owner_collected_type === 'full' ? 'full payment' : 'down payment'})
            </span>
            <span className={`font-semibold ${reservation.owner_collected_type === 'full' ? 'text-green-700' : 'text-amber-700'}`}>
              {currency(reservation.owner_collected_amount)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">We Need to Collect</span>
          <span className={`font-semibold ${amountToPay > 0 ? 'text-red-600' : 'text-green-600'}`}>{currency(amountToPay)}</span>
        </div>
        {reservation.housekeeping_fees > 0 && (
          <div className="flex justify-between"><span className="text-gray-500">Housekeeping</span><span>{currency(reservation.housekeeping_fees)}</span></div>
        )}
        {reservation.insurance > 0 && (
          <div className="flex justify-between"><span className="text-gray-500">Insurance</span><span>{currency(reservation.insurance)}</span></div>
        )}
        {fin.utilitiesDeduction > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500">Utilities</span>
            <span className="text-orange-600">{currency(fin.utilitiesDeduction)} (deducted from revenue)</span>
          </div>
        )}
        {fin.tenantDeduction > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500">Tenant Commission</span>
            <span className="text-orange-600">− {currency(fin.tenantDeduction)}</span>
          </div>
        )}
        {fin.companyCommission > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500">Company Commission <span className="text-xs text-gray-400">({appliedPctLabel(fin, reservation)})</span></span>
            <span className="text-red-600">− {currency(fin.companyCommission)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-gray-200 pt-1.5">
          <span className="text-gray-500 font-medium">Owner Net</span>
          <span className="font-semibold text-primary-700">{currency(fin.ownerNet)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-200 pt-1.5">
          <span className="text-gray-500">Amount Paid</span>
          <span className="font-semibold text-green-600">{currency(reservation.amount_paid)}</span>
        </div>
      </div>

      {reservation.notes && (
        <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Notes: </span>{reservation.notes}
        </div>
      )}

      {reservation.transfer_proof_path && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm">
          <span className="font-medium text-blue-800">Transfer Proof: </span>
          <a href={reservation.transfer_proof_path} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
            📎 {reservation.transfer_proof_name || 'View File'}
          </a>
        </div>
      )}

      {/* Payments */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-gray-900 text-sm">Payments</h4>
          {canPay && reservation.payment_status !== 'paid' && (
            <button onClick={onAddPayment} className="btn-primary btn-sm"><CreditCard className="w-3.5 h-3.5" />Add Payment</button>
          )}
        </div>
        {reservation.payments?.length > 0 ? (
          <div className="space-y-2">
            {reservation.payments.map(p => (
              <div key={p.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{currency(p.amount)}</span>
                    <span className="text-gray-400 mx-2">·</span>
                    <span className="text-gray-600">{PAYMENT_METHOD_LABELS[p.payment_method]}</span>
                    {p.reference_number && <span className="text-gray-400 ml-2">#{p.reference_number}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">{formatDate(p.payment_date)}</span>
                    {p.is_approved ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Approved</span>
                    ) : (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Pending</span>
                    )}
                    {!p.is_approved && canApprove && (
                      <button onClick={() => onApprovePayment(p.id)} className="text-xs bg-primary-600 text-white px-2 py-0.5 rounded-full hover:bg-primary-700">Approve</button>
                    )}
                  </div>
                </div>
                {p.document_path && (
                  <div className="mt-1">
                    <a href={p.document_path} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                      📎 {p.document_name || 'View Document'}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-gray-400 text-sm">No payments recorded</p>}
      </div>

      {/* Commissions */}
      {reservation.commissions?.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 text-sm mb-2">Commissions</h4>
          <div className="space-y-1.5">
            {reservation.commissions.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-yellow-50 rounded-lg px-3 py-2">
                <span className="text-gray-700">{c.full_name} — <span className="capitalize">{c.commission_type.replace(/_/g, ' ')}</span></span>
                <span className="font-medium text-yellow-700">{c.percentage}% = {currency(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Permits Tab ─────────────────────────────────────────────────────────────
function calcNetPricePerNight(r) {
  const gross      = parseFloat(r.total_amount)    || 0;
  const utilities  = parseFloat(r.utilities_amount) || 0;
  const broker     = parseFloat(r.broker_total)     || 0;
  const nights     = Math.max(parseInt(r.nights) || 1, 1);
  const mode       = String(r.commission_mode || 'A').toUpperCase();
  const tenantPct  = parseFloat(r.commission_tenant_pct) || 0;
  const isOwner    = Boolean(parseInt(r.is_owner_reservation) || r.is_owner_reservation === true);

  const netBase = gross - utilities - broker;
  const tenantDeduction = (mode === 'C' && tenantPct > 0 && !isOwner)
    ? Math.round((netBase * tenantPct / 100) * 100) / 100
    : 0;
  const subtotal = netBase - tenantDeduction;
  return nights > 0 ? Math.round((subtotal / nights) * 100) / 100 : 0;
}

function PermitsTab() {
  const qc = useQueryClient();
  const [search,           setSearch]           = useState('');
  const [filterProject,    setFilterProject]    = useState('');
  const [filterUnit,       setFilterUnit]       = useState('');
  const [filterCheckInFrom,setFilterCheckInFrom]= useState('');
  const [filterCheckInTo,  setFilterCheckInTo]  = useState('');
  const [sortKey,          setSortKey]          = useState('created_at');
  const [sortDir,          setSortDir]          = useState('desc');
  const [editingNote,      setEditingNote]      = useState({});

  const { data: allReservations = [], isLoading } = useQuery({
    queryKey: ['reservations-permits'],
    queryFn: () => api.get('/reservations').then(r => r.data.filter(x => x.status !== 'cancelled')),
    refetchInterval: 30000,
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then(r => r.data),
  });

  const projects = [...new Set(units.map(u => u.project).filter(Boolean))].sort();

  const filtered = allReservations.filter(r => {
    if (search && !r.guest_name?.toLowerCase().includes(search.toLowerCase()) &&
        !r.guest_phone?.includes(search)) return false;
    if (filterProject && r.project !== filterProject) return false;
    if (filterUnit && String(r.unit_id) !== filterUnit) return false;
    if (filterCheckInFrom && r.check_in < filterCheckInFrom) return false;
    if (filterCheckInTo   && r.check_in > filterCheckInTo)   return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
    if (sortKey === 'nights') { va = parseInt(va) || 0; vb = parseInt(vb) || 0; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortArrow = ({ col }) => {
    if (sortKey !== col) return <span style={{ color: '#d1d5db', marginLeft: 3, fontSize: 10 }}>⇅</span>;
    return <span style={{ color: '#6366f1', marginLeft: 3, fontSize: 10 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, field, value }) => api.patch(`/reservations/${id}/permit`, { [field]: value }),
    onSuccess: () => qc.invalidateQueries(['reservations-permits']),
  });

  const noteMutation = useMutation({
    mutationFn: ({ id, note }) => api.patch(`/reservations/${id}/permit`, { permit_feedback_note: note }),
    onSuccess: () => qc.invalidateQueries(['reservations-permits']),
  });

  const toggle = (id, field, current) => toggleMutation.mutate({ id, field, value: !current });

  const CHECKS = [
    { field: 'permit_owner_notified', label: 'تم ابلاغ الاونر بالحجز',  color: '#b45309' },
    { field: 'permit_contacted',     label: 'كلمناه وخدنا البطايق',     color: '#2563eb' },
    { field: 'permit_sent',          label: 'عملنا التصريح واتبعت',      color: '#7c3aed' },
    { field: 'permit_feedback',      label: 'خدنا الـ Feedback',         color: '#059669' },
  ];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <SearchFilter value={search} onChange={setSearch} placeholder="Search name, phone...">
        <SearchableSelect value={filterProject}
          onChange={v => { setFilterProject(v); setFilterUnit(''); }}
          placeholder="All Projects"
          options={[{ value: '', label: 'All Projects' }, ...projects.map(p => ({ value: p, label: p }))]}
        />
        <SearchableSelect value={filterUnit} onChange={setFilterUnit}
          placeholder="All Units"
          options={[{ value: '', label: 'All Units' }, ...units.filter(u => !filterProject || u.project === filterProject).map(u => ({ value: String(u.id), label: `${u.unit_number} — ${u.project}` }))]}
        />
        <DateRangeFilter
          label="Check-in"
          from={filterCheckInFrom} to={filterCheckInTo}
          onFromChange={setFilterCheckInFrom} onToChange={setFilterCheckInTo}
          onClear={() => { setFilterCheckInFrom(''); setFilterCheckInTo(''); }}
        />
      </SearchFilter>

      {/* ── Table ── */}
      {sorted.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No reservations" subtitle="Confirmed reservations will appear here" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-xs">
              <thead>
                <tr>
                  {[
                    { key: 'check_in',    label: 'Check-in'   },
                    { key: 'check_out',   label: 'Check-out'  },
                    { key: 'guest_name',  label: 'Guest Name' },
                    { key: 'guest_phone', label: 'Phone'      },
                    { key: 'unit_number', label: 'Unit No.'   },
                    { key: 'nights',      label: 'Nights'     },
                    { key: 'net_ppn',     label: 'سعر الليلة Net' },
                  ].map(col => (
                    <th key={col.key}
                      className="whitespace-nowrap cursor-pointer select-none hover:bg-gray-100"
                      onClick={() => handleSort(col.key)}>
                      {col.label}<SortArrow col={col.key} />
                    </th>
                  ))}
                  {CHECKS.map(c => (
                    <th key={c.field} className="text-center whitespace-nowrap" style={{ minWidth: 140 }}>
                      {c.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap" style={{ minWidth: 200 }}>Feedback Note</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const allDone = CHECKS.every(c => r[c.field]);
                  const noteVal = editingNote[r.id] !== undefined
                    ? editingNote[r.id]
                    : (r.permit_feedback_note || '');
                  return (
                    <tr key={r.id} style={allDone ? { background: '#f0fdf4' } : {}}>
                      <td className="whitespace-nowrap font-medium">{formatDate(r.check_in)}</td>
                      <td className="whitespace-nowrap">{formatDate(r.check_out)}</td>
                      <td className="whitespace-nowrap">{r.guest_name}</td>
                      <td className="whitespace-nowrap text-gray-500">{r.guest_phone}</td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-mono text-xs">
                          {r.unit_number}
                        </span>
                      </td>
                      <td className="text-center">{r.nights}</td>
                      <td className="text-center whitespace-nowrap font-medium text-indigo-700">
                        {calcNetPricePerNight(r).toLocaleString('en-EG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      {CHECKS.map(c => (
                        <td key={c.field} className="text-center">
                          <button
                            onClick={() => toggle(r.id, c.field, r[c.field])}
                            disabled={toggleMutation.isPending}
                            style={{
                              width: 24, height: 24, borderRadius: 6, border: '2px solid',
                              borderColor: r[c.field] ? c.color : '#d1d5db',
                              background:  r[c.field] ? c.color : '#fff',
                              cursor: 'pointer', display: 'inline-flex',
                              alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s',
                            }}
                          >
                            {r[c.field] && (
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                <path d="M2 7L5 10L11 3" stroke="white" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                        </td>
                      ))}
                      <td>
                        <input
                          type="text"
                          className="input text-xs py-1"
                          placeholder="Add note…"
                          value={noteVal}
                          onChange={e => setEditingNote(n => ({ ...n, [r.id]: e.target.value }))}
                          onBlur={() => {
                            if (noteVal !== (r.permit_feedback_note || ''))
                              noteMutation.mutate({ id: r.id, note: noteVal });
                            setEditingNote(n => { const c = { ...n }; delete c[r.id]; return c; });
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                          style={{ minWidth: 160 }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
            <span>{sorted.length} reservation{sorted.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span className="text-green-600 font-medium">
              {sorted.filter(r => CHECKS.every(c => r[c.field])).length} completed
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Compact date-range filter pill ─────────────────────────────────────────
function DateRangeFilter({ label, from, to, onFromChange, onToChange, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isActive = Boolean(from || to);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Short date: "Jun 24"
  const fmt = d => {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const display = isActive
    ? [from && fmt(from), to && fmt(to)].filter(Boolean).join(' → ')
    : null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
          border: `1px solid ${isActive ? '#93c5fd' : '#e5e7eb'}`,
          background: isActive ? '#eff6ff' : '#fff',
          color: isActive ? '#1d4ed8' : '#6b7280',
          cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'border-color 0.15s',
        }}
      >
        <CalendarDays style={{ width: 13, height: 13 }} />
        <span>{display || label}</span>
        {isActive && (
          <span
            onClick={e => { e.stopPropagation(); onClear(); }}
            style={{ marginLeft: 2, color: '#93c5fd', fontWeight: 700, lineHeight: 1 }}
            onMouseEnter={e => e.target.style.color = '#ef4444'}
            onMouseLeave={e => e.target.style.color = '#93c5fd'}
          >✕</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 999,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.10)', padding: 14, minWidth: 210,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 3 }}>From</label>
              <input type="date" className="input" style={{ fontSize: 12, padding: '5px 8px' }}
                value={from} onChange={e => onFromChange(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 3 }}>To</label>
              <input type="date" className="input" style={{ fontSize: 12, padding: '5px 8px' }}
                value={to} onChange={e => onToChange(e.target.value)} />
            </div>
            {isActive && (
              <button
                onClick={() => { onClear(); setOpen(false); }}
                style={{ fontSize: 11, color: '#ef4444', background: '#fef2f2', border: 'none', borderRadius: 6, padding: '4px 0', cursor: 'pointer', marginTop: 2 }}
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Reservations() {
  const qc = useQueryClient();
  const { isAdmin, canManageReservations, canAccessFinance } = usePermissions();
  const allowPastDates = isAdmin;
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [filterStatus,      setFilterStatus]      = useState('');
  const [filterPayment,     setFilterPayment]     = useState('');
  const [filterProject,     setFilterProject]     = useState('');
  const [filterUnit,        setFilterUnit]        = useState('');
  const [filterUnitNumber,  setFilterUnitNumber]  = useState('');
  const [filterCreatedFrom,  setFilterCreatedFrom]  = useState('');
  const [filterCreatedTo,    setFilterCreatedTo]    = useState('');
  const [filterCheckInFrom,  setFilterCheckInFrom]  = useState('');
  const [filterCheckInTo,    setFilterCheckInTo]    = useState('');
  const [filterCheckOutFrom, setFilterCheckOutFrom] = useState('');
  const [filterCheckOutTo,   setFilterCheckOutTo]   = useState('');
  const [activeTab, setActiveTab] = useState('reservations'); // 'reservations' | 'permits'
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [viewRes, setViewRes] = useState(null);
  const [cancelId, setCancelId] = useState(null);
  // cancelled reservations are always visible
  // Cancel-request workflow
  const [cancelReqOpen,  setCancelReqOpen]  = useState(false);
  const [cancelReqId,    setCancelReqId]    = useState(null);
  const [cancelReason,   setCancelReason]   = useState('');
  const [cancelType,     setCancelType]     = useState('non_refundable');
  // Approve-cancel review modal (Finance/Admin sees reason + type before confirming)
  const [approveCancelReview, setApproveCancelReview] = useState(null); // full reservation object
  const [approveCancelType, setApproveCancelType] = useState('non_refundable'); // Finance/Admin override
  // Refund-done workflow
  const [refundDoneOpen, setRefundDoneOpen] = useState(false);
  const [refundDoneId,   setRefundDoneId]   = useState(null);
  const [refundFile,     setRefundFile]     = useState(null);
  const [pmtModal, setPmtModal] = useState(false);
  const [pmtForm, setPmtForm] = useState(EMPTY_PMT);
  const [pmtFile, setPmtFile] = useState(null);
  const [transferProof, setTransferProof] = useState(null);
  const [previewPhotos, setPreviewPhotos] = useState([]);
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState(0);

  // Block nights (owner stay)
  const [blockModal, setBlockModal] = useState(false);
  const [blockForm, setBlockForm] = useState({ unit_id: '', owner_name: '', check_in: '', check_out: '', notes: '' });

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ['reservations', search, filterStatus, filterPayment, filterUnit, filterCreatedFrom, filterCreatedTo, filterCheckInFrom, filterCheckInTo, filterCheckOutFrom, filterCheckOutTo],
    queryFn: () => api.get('/reservations', { params: {
      search:          search              || undefined,
      status:          filterStatus        || undefined,
      payment_status:  filterPayment       || undefined,
      unit_id:         filterUnit          || undefined,
      created_from:    filterCreatedFrom   || undefined,
      created_to:      filterCreatedTo     || undefined,
      check_in_from:   filterCheckInFrom   || undefined,
      check_in_to:     filterCheckInTo     || undefined,
      check_out_from:  filterCheckOutFrom  || undefined,
      check_out_to:    filterCheckOutTo    || undefined,
    }}).then(r => r.data),
  });

  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => api.get('/units').then(r => r.data) });
  const { data: users = [] } = useQuery({ queryKey: ['users-sales'], queryFn: () => api.get('/users/sales').then(r => r.data) });

  const { data: viewDetail } = useQuery({
    queryKey: ['reservation', viewRes],
    queryFn: () => api.get(`/reservations/${viewRes}`).then(r => r.data),
    enabled: !!viewRes,
  });

  const saveMutation = useMutation({
    mutationFn: (d) => {
      if (d instanceof FormData) return api.post('/reservations', d, { headers: { 'Content-Type': 'multipart/form-data' } });
      return editId ? api.put(`/reservations/${editId}`, d) : api.post('/reservations', d);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reservations'] }); toast.success(editId ? 'Updated' : 'Reservation created'); setModal(null); setTransferProof(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => api.delete(`/reservations/${id}`),
    onSuccess: (_data, id) => {
      qc.setQueriesData({ queryKey: ['reservations'] }, (old) =>
        Array.isArray(old) ? old.filter((r) => r.id !== id) : old
      );
      qc.invalidateQueries({ queryKey: ['reservations'] });
      toast.success('Reservation deleted');
      setCancelId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting'),
  });

  // Submit cancellation request (any staff)
  const cancelRequestMutation = useMutation({
    mutationFn: ({ id, reason, type }) =>
      api.post(`/reservations/${id}/cancel-request`, { reason, cancel_type: type }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      toast.success('Cancellation request submitted');
      setCancelReqOpen(false); setCancelReqId(null); setCancelReason(''); setCancelType('non_refundable');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error submitting request'),
  });

  // Approve cancellation (Finance/Admin) — passes override cancel_type in body
  const approveCancelMutation = useMutation({
    mutationFn: ({ id, cancel_type }) => api.delete(`/reservations/${id}`, { data: { cancel_type } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reservations'] }); toast.success('Reservation cancelled'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error cancelling'),
  });

  // Reject cancellation request (Finance/Admin) — keeps reservation active, clears request
  const rejectCancelMutation = useMutation({
    mutationFn: (id) => api.post(`/reservations/${id}/reject-cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      toast.success('Cancellation request rejected');
      setApproveCancelReview(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error rejecting request'),
  });

  // Mark refund done (Finance/Admin)
  const refundDoneMutation = useMutation({
    mutationFn: ({ id, file }) => {
      const fd = new FormData();
      if (file) fd.append('proof', file);
      return api.post(`/reservations/${id}/refund-done`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      toast.success('Refund marked as done');
      setRefundDoneOpen(false); setRefundDoneId(null); setRefundFile(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error marking refund done'),
  });

  const pmtMutation = useMutation({
    mutationFn: (d) => api.post('/payments', d, d instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reservations'] }); qc.invalidateQueries({ queryKey: ['reservation', viewRes] }); toast.success('Payment recorded'); setPmtModal(false); setPmtForm(EMPTY_PMT); setPmtFile(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error recording payment'),
  });

  const approveMutation = useMutation({
    mutationFn: (pmtId) => api.put(`/payments/${pmtId}/approve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reservation', viewRes] }); toast.success('Payment approved'); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error approving'),
  });

  const blockMutation = useMutation({
    mutationFn: (d) => api.post('/reservations', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      toast.success('Nights blocked successfully');
      setBlockModal(false);
      setBlockForm({ unit_id: '', owner_name: '', check_in: '', check_out: '', notes: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error blocking nights'),
  });

  const handleBlockSave = () => {
    if (!blockForm.unit_id || !blockForm.check_in || !blockForm.check_out) {
      toast.error('Unit and dates are required');
      return;
    }
    blockMutation.mutate({
      unit_id: blockForm.unit_id,
      guest_name: blockForm.owner_name || 'Owner Stay',
      check_in: blockForm.check_in,
      check_out: blockForm.check_out,
      total_amount: 0,
      is_owner_reservation: true,
      notes: blockForm.notes || '',
    });
  };

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setTransferProof(null); setModal('form'); };
  const openEdit = (r) => {
    setForm({
      unit_id: r.unit_id, guest_name: r.guest_name, guest_email: r.guest_email || '',
      guest_phone: r.guest_phone || '', guest_nationality: r.guest_nationality || '',
      check_in: r.check_in, check_out: r.check_out,
      price_per_night: r.price_per_night || '',
      total_amount: r.total_amount,
      down_payment: r.down_payment || '',
      housekeeping_fees: r.housekeeping_fees || '',
      insurance: r.insurance || '',
      booking_source: r.booking_source || '',
      sales_person_id: r.sales_person_id || '',
      is_owner_reservation: !!r.is_owner_reservation,
      notes: r.notes || '', status: r.status,
      owner_collected_type:   r.owner_collected_type   || '',
      owner_collected_amount: r.owner_collected_amount || '',
      utilities_cost_override: r.utilities_cost_override != null ? String(r.utilities_cost_override) : '',
      broker_name: r.broker_name || '',
      broker_amount_per_night: r.broker_amount_per_night != null ? String(r.broker_amount_per_night) : '',
    });
    setEditId(r.id); setModal('form');
  };

  const handleSave = () => {
    if (!form.guest_phone?.trim())
      return toast.error('Mobile number is required');
    if (!form.is_owner_reservation && !form.sales_person_id)
      return toast.error('Please select a Sales Person or mark as Owner Reservation');
    const selectedUnit = units.find((u) => String(u.id) === String(form.unit_id));
    const payload = {
      ...form,
      housekeeping_fees: selectedUnit
        ? housekeepingFeeForUnit(selectedUnit)
        : form.housekeeping_fees,
    };
    if (!editId && transferProof) {
      const fd = new FormData();
      Object.entries(payload).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined)
          fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
      });
      fd.append('transfer_proof', transferProof);
      saveMutation.mutate(fd);
    } else {
      saveMutation.mutate(payload);
    }
  };

  const handleAddPayment = () => { setPmtForm(EMPTY_PMT); setPmtModal(true); };

  const openCancelReq  = (id) => { setCancelReqId(id); setCancelReason(''); setCancelType('non_refundable'); setCancelReqOpen(true); };
  const openRefundDone = (id) => { setRefundDoneId(id); setRefundFile(null); setRefundDoneOpen(true); };
  const handleCancelReq = () => {
    if (!cancelReason.trim()) { toast.error('Reason is required'); return; }
    cancelRequestMutation.mutate({ id: cancelReqId, reason: cancelReason, type: cancelType });
  };
  const handleRefundDone = () => refundDoneMutation.mutate({ id: refundDoneId, file: refundFile });
  const handlePmtSave = () => {
    const fd = new FormData();
    fd.append('reservation_id', viewRes);
    Object.entries(pmtForm).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) fd.append(k, v); });
    if (pmtFile) fd.append('document', pmtFile);
    pmtMutation.mutate(fd);
  };

  const canWrite = canManageReservations;
  const canPay = canAccessFinance;
  const canApprove = isAdmin;

  const canSeeOwnerStays = isAdmin;

  // Split: blocked nights (owner stay, total = 0) vs everything else (including owner reservations with amount)
  const allFiltered = reservations.filter(r => {
    if (filterProject && r.project !== filterProject) return false;
    if (filterUnitNumber && !String(r.unit_number || '').toLowerCase().includes(filterUnitNumber.toLowerCase())) return false;
    return true;
  });
  const isBlocked      = r => r.is_owner_reservation && (parseFloat(r.total_amount) || 0) === 0;
  const filteredByUnit = allFiltered.filter(r => !isBlocked(r));
  const ownerStays     = allFiltered.filter(r =>  isBlocked(r));
  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(filteredByUnit, 'created_at', 'desc');
  const { sorted: ownerSorted, sortKey: ownerSortKey, sortDir: ownerSortDir, handleSort: ownerHandleSort } = useSortableTable(ownerStays, 'check_in', 'desc');

  const exportExcel = () => {
    const rows = reservations
      .map(r => {
        const total = parseFloat(r.total_amount) || 0;
        const paid = parseFloat(r.amount_paid) || parseFloat(r.down_payment) || 0;
        return {
          Name: r.guest_name || '',
          Phone: r.guest_phone || '',
          'Check-in': r.check_in ? String(r.check_in).split('T')[0] : '',
          'Check-out': r.check_out ? String(r.check_out).split('T')[0] : '',
          Email: r.guest_email || '',
          'Total to be paid': Math.max(0, total - paid),
          'ID Photos': Array.isArray(r.id_photo_urls) ? r.id_photo_urls.filter(Boolean).join(', ') : '',
        };
      });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reservations');
    XLSX.writeFile(wb, `reservations_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <WebsiteBookingRequests />
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Reservations</h1>
          <p className="page-subtitle">{filteredByUnit.length} reservation{filteredByUnit.length !== 1 ? 's' : ''}{ownerStays.length > 0 && canSeeOwnerStays ? ` · ${ownerStays.length} owner stay${ownerStays.length !== 1 ? 's' : ''}` : ''}</p>
        </div>
        <div className="flex gap-2">
          {(isAdmin) && activeTab === 'reservations' && <button onClick={exportExcel} className="btn-secondary"><Download className="w-4 h-4" />Export Excel</button>}
          {canWrite && activeTab === 'reservations' && (
            <button onClick={() => setBlockModal(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 text-sm font-medium transition-colors">
              <Lock className="w-4 h-4" />Block Nights
            </button>
          )}
          {canWrite && activeTab === 'reservations' && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />New Reservation</button>}
        </div>
      </div>

      {activeTab === 'reservations' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => { setFilterStatus(''); setFilterPayment(''); }}
            className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-[#283f5e]/30"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Total</p>
            <p className="mt-2 text-3xl font-bold text-[#283f5e]">{filteredByUnit.length}</p>
          </button>
          <button
            type="button"
            onClick={() => { setFilterStatus('confirmed'); setFilterPayment('pending'); }}
            className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-left shadow-sm hover:border-amber-400"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Pending payment</p>
            <p className="mt-2 text-3xl font-bold text-amber-800">
              {filteredByUnit.filter((r) => r.payment_status === 'pending' && r.status !== 'cancelled').length}
            </p>
          </button>
          <button
            type="button"
            onClick={() => { setFilterStatus('confirmed'); setFilterPayment(''); }}
            className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left shadow-sm hover:border-emerald-400"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Confirmed</p>
            <p className="mt-2 text-3xl font-bold text-emerald-800">
              {filteredByUnit.filter((r) => r.status === 'confirmed' || r.status === 'checked_in').length}
            </p>
          </button>
        </div>
      )}

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'reservations', label: 'Reservations', always: true },
          { key: 'permits',      label: 'التصاريح',    always: false },
        ].filter(t => t.always || isAdmin).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Permits tab ── */}
      {activeTab === 'permits' && isAdmin && <PermitsTab />}

      {/* ── Reservations tab ── */}
      {activeTab === 'reservations' && (
      <>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search tenant, email, phone...">
        <SearchableSelect className="w-40" value={filterStatus} onChange={setFilterStatus}
          placeholder="All Status"
          options={[{ value: '', label: 'All Status' }, ...['confirmed','checked_in','checked_out','cancelled'].map(s => ({ value: s, label: s.replace(/_/g,' ') }))]}
        />
        <SearchableSelect className="w-40" value={filterPayment} onChange={setFilterPayment}
          placeholder="All Payments"
          options={[{ value: '', label: 'All Payments' }, ...['pending','partial','paid'].map(s => ({ value: s, label: s }))]}
        />
        <SearchableSelect className="w-44" value={filterProject}
          onChange={v => { setFilterProject(v); setFilterUnit(''); }}
          placeholder="All Projects"
          options={[{ value: '', label: 'All Projects' }, ...[...new Set(units.map(u => u.project).filter(Boolean))].sort().map(p => ({ value: p, label: p }))]}
        />
        <SearchableSelect className="w-44" value={filterUnit} onChange={setFilterUnit}
          placeholder="All Units"
          options={[{ value: '', label: 'All Units' }, ...units.filter(u => !filterProject || u.project === filterProject).map(u => ({ value: String(u.id), label: `${u.unit_number} — ${u.project}` }))]}
        />
        <div className="relative">
          <input
            type="text"
            className="input text-xs py-1.5 w-28 pr-6"
            placeholder="Unit No."
            value={filterUnitNumber}
            onChange={e => setFilterUnitNumber(e.target.value)}
          />
          {filterUnitNumber && (
            <button onClick={() => setFilterUnitNumber('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs">✕</button>
          )}
        </div>
        <DateRangeFilter
          label="Check-in"
          from={filterCheckInFrom} to={filterCheckInTo}
          onFromChange={setFilterCheckInFrom} onToChange={setFilterCheckInTo}
          onClear={() => { setFilterCheckInFrom(''); setFilterCheckInTo(''); }}
        />
        <DateRangeFilter
          label="Check-out"
          from={filterCheckOutFrom} to={filterCheckOutTo}
          onFromChange={setFilterCheckOutFrom} onToChange={setFilterCheckOutTo}
          onClear={() => { setFilterCheckOutFrom(''); setFilterCheckOutTo(''); }}
        />
        <DateRangeFilter
          label="Date Added"
          from={filterCreatedFrom} to={filterCreatedTo}
          onFromChange={setFilterCreatedFrom} onToChange={setFilterCreatedTo}
          onClear={() => { setFilterCreatedFrom(''); setFilterCreatedTo(''); }}
        />
      </SearchFilter>

      {isLoading ? <LoadingSpinner /> : reservations.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No reservations found"
          action={canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />New Reservation</button>} />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-xs">
              <thead>
                <tr>
                  <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="whitespace-nowrap">Name</SortTh>
                  <SortTh col="guest_phone" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="whitespace-nowrap">Phone</SortTh>
                  <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="whitespace-nowrap">Check-in</SortTh>
                  <SortTh col="check_out" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="whitespace-nowrap">Check-out</SortTh>
                  <SortTh col="guest_email" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="whitespace-nowrap">Email</SortTh>
                  <th className="whitespace-nowrap text-right">Total to be paid</th>
                  <th className="whitespace-nowrap">ID Photos</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const total = parseFloat(r.total_amount) || 0;
                  const paid = parseFloat(r.amount_paid) || parseFloat(r.down_payment) || 0;
                  const amtToPay = Math.max(0, total - paid);
                  const idPhotos = Array.isArray(r.id_photo_urls) ? r.id_photo_urls.filter(Boolean) : [];
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium text-gray-900">{r.guest_name || '—'}</div>
                      </td>
                      <td className="text-gray-600 whitespace-nowrap">{r.guest_phone || '—'}</td>
                      <td className="whitespace-nowrap">{formatDate(r.check_in)}</td>
                      <td className="whitespace-nowrap">{formatDate(r.check_out)}</td>
                      <td className="text-gray-600">{r.guest_email || '—'}</td>
                      <td className={`text-right font-medium whitespace-nowrap ${amtToPay > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {currency(amtToPay)}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5 min-w-[5rem]">
                          {idPhotos.length > 0 ? idPhotos.map((photo) => (
                            <button
                              key={photo}
                              type="button"
                              onClick={() => { setPreviewPhotos(idPhotos); setPreviewPhotoIndex(idPhotos.indexOf(photo)); }}
                              className="relative"
                              title="View ID photo"
                            >
                              <img src={photo} alt="ID" className="h-10 w-10 rounded-md border border-gray-200 object-cover" />
                              <span className="absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-700 text-white">
                                <Maximize2 className="h-2 w-2" strokeWidth={2} aria-hidden="true" />
                              </span>
                            </button>
                          )) : (
                            <span className="text-gray-400 italic">No photos</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-1 flex-wrap">
                          {canWrite && (
                            <button onClick={() => setCancelId(r.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete reservation">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Owner Stays / Blocked Nights Table ──────────────────────────────── */}
      {canSeeOwnerStays && ownerStays.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-500" />
              <h2 className="text-base font-semibold text-gray-800">Blocked Nights</h2>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
              {ownerStays.length} record{ownerStays.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="card p-0">
            <div className="table-wrapper">
              <table className="table text-xs">
                <thead>
                  <tr>
                    <SortTh col="check_in" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap">Check In</SortTh>
                    <SortTh col="check_out" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap">Check Out</SortTh>
                    <SortTh col="unit_number" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap">Unit No.</SortTh>
                    <SortTh col="guest_name" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap">Name</SortTh>
                    <SortTh col="nights" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap text-center">Nights</SortTh>
                    <SortTh col="total_amount" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap text-right">Total</SortTh>
                    <SortTh col="status" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap">Status</SortTh>
                    <th className="whitespace-nowrap">Notes</th>
                    <SortTh col="created_at" sortKey={ownerSortKey} sortDir={ownerSortDir} onSort={ownerHandleSort} className="whitespace-nowrap">Added</SortTh>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ownerSorted.map(r => {
                    const total = parseFloat(r.total_amount) || 0;
                    const isBlocked = total === 0;
                    return (
                      <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-60 bg-red-50' : 'bg-purple-50/30'}>
                        <td className="whitespace-nowrap">{formatDate(r.check_in)}</td>
                        <td className="whitespace-nowrap">{formatDate(r.check_out)}</td>
                        <td>
                          <div className="font-medium">{r.unit_number || '—'}</div>
                          <div className="text-gray-400">{r.project}</div>
                        </td>
                        <td>
                          <div className="font-medium text-gray-900">{r.guest_name}</div>
                          <span className="text-xs font-medium text-purple-600">🔒 Blocked</span>
                        </td>
                        <td className="text-center">{r.nights}n</td>
                        <td className="text-right font-medium">{total > 0 ? currency(total) : '—'}</td>
                        <td><Badge status={r.status} /></td>
                        <td>
                          <div className="w-40 whitespace-normal break-words text-xs text-gray-600">
                            {r.notes || <span className="text-gray-300">—</span>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-gray-400 text-xs">
                          {r.created_at ? formatDate(r.created_at) : '—'}
                        </td>
                        <td>
                          <div className="flex gap-1 flex-wrap">
                            <button onClick={() => setViewRes(r.id)} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50" title="View"><Eye className="w-3.5 h-3.5" /></button>
                            {(isAdmin) && r.status !== 'cancelled' && (
                              <button onClick={() => openEdit(r)} className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                            )}
                            {(isAdmin) && r.status !== 'cancelled' && (
                              <button onClick={() => openCancelReq(r.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Cancel"><Ban className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Block Nights Modal */}
      <Modal open={blockModal} onClose={() => setBlockModal(false)}
        title="Block Nights — Owner Stay" size="sm"
        footer={<>
          <button onClick={() => setBlockModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleBlockSave} disabled={blockMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white hover:bg-purple-700 font-medium text-sm transition-colors">
            <Lock className="w-4 h-4" />{blockMutation.isPending ? 'Blocking...' : 'Block Nights'}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-sm text-purple-800">
            هذه الليالي ستُحجز كـ <strong>Owner Stay</strong> — بدون دفع أو عمولة، وتظهر بالأرجواني في الجدول.
          </div>
          <div>
            <label className="label">Unit *</label>
            <SearchableSelect
              value={blockForm.unit_id}
              onChange={v => setBlockForm(f => ({ ...f, unit_id: v }))}
              placeholder="Select unit…"
              options={[{ value: '', label: 'Select unit…' }, ...units.map(u => ({ value: String(u.id), label: `${u.unit_number} — ${u.name} (${u.project})` }))]}
            />
          </div>
          <div>
            <label className="label">Owner Name <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input" value={blockForm.owner_name}
              onChange={e => setBlockForm(f => ({ ...f, owner_name: e.target.value }))}
              placeholder="e.g. Mr. Ahmed — defaults to 'Owner Stay'" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Check-in *</label>
              <input type="date" className="input" value={blockForm.check_in}
                onChange={e => setBlockForm(f => ({ ...f, check_in: e.target.value }))} />
            </div>
            <div><label className="label">Check-out *</label>
              <input type="date" className="input" value={blockForm.check_out}
                onChange={e => setBlockForm(f => ({ ...f, check_out: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea className="input resize-none" rows={2} value={blockForm.notes}
              onChange={e => setBlockForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this stay…" />
          </div>
        </div>
      </Modal>

      {/* Form Modal */}
      <Modal open={modal === 'form'} onClose={() => { setModal(null); setTransferProof(null); }}
        title={editId ? 'Edit Reservation' : 'New Reservation'} size="xl"
        footer={<>
          <button onClick={() => { setModal(null); setTransferProof(null); }} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saveMutation.isPending} className="btn-primary">
            {saveMutation.isPending ? 'Saving...' : editId ? 'Save Changes' : 'Create Reservation'}
          </button>
        </>}
      >
        <ReservationForm form={form} setForm={setForm} units={units} users={users}
          isNew={!editId} editId={editId} transferProof={transferProof} onTransferProofChange={setTransferProof}
          allowPastDates={allowPastDates} />
      </Modal>

      {/* View Modal */}
      <Modal open={!!viewRes} onClose={() => setViewRes(null)} title={`Reservation #${viewRes}`} size="lg"
        footer={<button onClick={() => setViewRes(null)} className="btn-secondary">Close</button>}
      >
        <ReservationDetail reservation={viewDetail} onAddPayment={handleAddPayment}
          canPay={canPay} canApprove={canApprove} onApprovePayment={(pmtId) => approveMutation.mutate(pmtId)} />
      </Modal>

      {/* Payment Modal */}
      <Modal open={pmtModal} onClose={() => setPmtModal(false)} title="Record Payment" size="md"
        footer={<>
          <button onClick={() => setPmtModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={handlePmtSave} disabled={pmtMutation.isPending} className="btn-primary">
            {pmtMutation.isPending ? 'Saving...' : 'Record Payment'}
          </button>
        </>}
      >
        <PaymentForm form={pmtForm} setForm={setPmtForm} onFileChange={setPmtFile} />
      </Modal>

      <ConfirmDialog open={!!cancelId} onClose={() => setCancelId(null)}
        onConfirm={() => cancelMutation.mutate(cancelId)} loading={cancelMutation.isPending}
        title="Delete Reservation" message="Are you sure you want to permanently delete this reservation? It will be removed from the list." confirmText="Delete" danger />

      {previewPhotos.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewPhotos([])}>
          <div className="relative max-h-[90vh] max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -right-2 -top-2 z-10 rounded-full bg-white p-1.5 text-gray-700 shadow"
              onClick={() => setPreviewPhotos([])}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewPhotos[previewPhotoIndex]}
              alt="ID preview"
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
            {previewPhotos.length > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3">
                <button
                  type="button"
                  className="rounded-full bg-white/90 p-2 text-gray-700 shadow"
                  onClick={() => setPreviewPhotoIndex((i) => (i - 1 + previewPhotos.length) % previewPhotos.length)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-white">{previewPhotoIndex + 1} / {previewPhotos.length}</span>
                <button
                  type="button"
                  className="rounded-full bg-white/90 p-2 text-gray-700 shadow"
                  onClick={() => setPreviewPhotoIndex((i) => (i + 1) % previewPhotos.length)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Approve Cancel Review Modal (Finance/Admin) ── */}
      <Modal
        open={!!approveCancelReview}
        onClose={() => setApproveCancelReview(null)}
        title="Review Cancellation Request"
        size="sm"
        footer={<>
          <button onClick={() => setApproveCancelReview(null)} className="btn-secondary">Close</button>
          <button
            onClick={() => rejectCancelMutation.mutate(approveCancelReview.id)}
            disabled={rejectCancelMutation.isPending || approveCancelMutation.isPending}
            className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-300 disabled:opacity-50">
            {rejectCancelMutation.isPending ? 'Rejecting…' : 'Reject Request'}
          </button>
          <button
            onClick={() => { approveCancelMutation.mutate({ id: approveCancelReview.id, cancel_type: approveCancelType }); setApproveCancelReview(null); }}
            disabled={approveCancelMutation.isPending || rejectCancelMutation.isPending}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {approveCancelMutation.isPending ? 'Cancelling…' : 'Approve & Cancel'}
          </button>
        </>}
      >
        {approveCancelReview && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Reservation</p>
                <p className="font-medium text-gray-900">{approveCancelReview.guest_name}</p>
                <p className="text-sm text-gray-500">{approveCancelReview.unit_name} · {formatDate(approveCancelReview.check_in)} → {formatDate(approveCancelReview.check_out)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Cancel Reason</p>
                <p className="text-sm text-gray-800">{approveCancelReview.cancel_reason || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
                  Refund Type
                  {approveCancelReview.cancel_type !== approveCancelType && (
                    <span className="ml-2 text-amber-600 normal-case font-normal">(changed from requested)</span>
                  )}
                </p>
                {/* Editable radio buttons — Finance/Admin can override the requester's choice */}
                <div className="flex gap-3 mt-1">
                  <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-colors
                    ${approveCancelType === 'refundable'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                    <input
                      type="radio"
                      name="approveCancelType"
                      value="refundable"
                      checked={approveCancelType === 'refundable'}
                      onChange={() => setApproveCancelType('refundable')}
                      className="accent-blue-600"
                    />
                    <span className="text-sm font-medium">↩ Refundable</span>
                  </label>
                  <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-colors
                    ${approveCancelType === 'non_refundable'
                      ? 'border-gray-500 bg-gray-100 text-gray-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                    <input
                      type="radio"
                      name="approveCancelType"
                      value="non_refundable"
                      checked={approveCancelType === 'non_refundable'}
                      onChange={() => setApproveCancelType('non_refundable')}
                      className="accent-gray-600"
                    />
                    <span className="text-sm font-medium">✕ Non-Refundable</span>
                  </label>
                </div>
              </div>
            </div>
            <p className="text-sm text-red-600 font-medium">
              Approving will cancel this reservation and mark all its payments as
              {approveCancelType === 'refundable' ? ' "Refunded".' : ' "Not Refundable".'}
            </p>
          </div>
        )}
      </Modal>

      {/* ── Cancel Request Modal ── */}
      <Modal
        open={cancelReqOpen}
        onClose={() => setCancelReqOpen(false)}
        title="Request Cancellation"
        size="sm"
        footer={<>
          <button onClick={() => setCancelReqOpen(false)} className="btn-secondary">Close</button>
          <button onClick={handleCancelReq} disabled={cancelRequestMutation.isPending}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {cancelRequestMutation.isPending ? 'Submitting…' : 'Submit Request'}
          </button>
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Reason for Cancellation *</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Describe why this reservation needs to be cancelled…"
            />
          </div>
          <div>
            <label className="label">Refund Type *</label>
            <div className="flex gap-6 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="cancelType" value="refundable"
                  checked={cancelType === 'refundable'}
                  onChange={() => setCancelType('refundable')}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm font-medium text-blue-700">Refundable</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="cancelType" value="non_refundable"
                  checked={cancelType === 'non_refundable'}
                  onChange={() => setCancelType('non_refundable')}
                  className="w-4 h-4 accent-gray-500" />
                <span className="text-sm font-medium text-gray-700">Non-Refundable</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Refund Done Modal ── */}
      <Modal
        open={refundDoneOpen}
        onClose={() => setRefundDoneOpen(false)}
        title="Mark Refund as Done"
        size="sm"
        footer={<>
          <button onClick={() => setRefundDoneOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleRefundDone} disabled={refundDoneMutation.isPending}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {refundDoneMutation.isPending ? 'Saving…' : 'Mark as Done'}
          </button>
        </>}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Upload proof of refund (optional — receipt, transfer screenshot, etc.)</p>
          <label className="flex items-center gap-3 cursor-pointer p-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-green-400 transition-colors">
            <Upload className="w-5 h-5 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-500 truncate">
              {refundFile ? refundFile.name : 'Choose file or drag here…'}
            </span>
            <input type="file" accept="image/*,application/pdf" className="hidden"
              onChange={e => setRefundFile(e.target.files[0] || null)} />
          </label>
        </div>
      </Modal>
      </>
      )}
    </div>
  );
}
