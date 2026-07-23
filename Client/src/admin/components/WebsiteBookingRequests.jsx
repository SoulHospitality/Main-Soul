import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Maximize2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Badge from './ui/Badge';
import LoadingSpinner from './ui/LoadingSpinner';
import Modal from './ui/Modal';
import { currency, formatDate } from '../utils/formatters';

function toIdPhotos(booking) {
  if (Array.isArray(booking?.id_photo_urls)) {
    return booking.id_photo_urls.filter(Boolean);
  }
  return [];
}

function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const ms = new Date(checkout) - new Date(checkin);
  return Math.max(1, Math.round(ms / 86400000));
}

function isPrepaid(booking) {
  const method = String(booking?.payment_method || '').toLowerCase();
  return (
    booking?.payment_status === 'paid' ||
    method.includes('paymob') ||
    method.includes('card')
  );
}

function needsDeposit(booking) {
  return !isPrepaid(booking);
}

function resolveAmountPaid(booking, paymentMode, customAmount, total, halfAmount) {
  if (!booking) return 0;
  if (isPrepaid(booking)) return total;
  if (paymentMode === 'half') return halfAmount;
  if (paymentMode === 'full') return total;
  const n = Number(customAmount);
  return Number.isFinite(n) ? n : 0;
}

export default function WebsiteBookingRequests() {
  const qc = useQueryClient();
  const [previewPhotos, setPreviewPhotos] = useState([]);
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState(0);
  const [acceptBooking, setAcceptBooking] = useState(null);
  const [paymentMode, setPaymentMode] = useState('half');
  const [customAmount, setCustomAmount] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['website-bookings-pending'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'pending' } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const acceptTotal = Number(acceptBooking?.total_egp) || 0;
  const halfAmount = Math.round(acceptTotal * 0.5 * 100) / 100;
  const amountPaid = resolveAmountPaid(
    acceptBooking,
    paymentMode,
    customAmount,
    acceptTotal,
    halfAmount
  );
  const remaining = Math.max(0, Math.round((acceptTotal - amountPaid) * 100) / 100);

  const acceptMutation = useMutation({
    mutationFn: ({ id, formData }) =>
      api.post(`/website-bookings/${id}/accept`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    onSuccess: () => {
      toast.success('Booking accepted');
      closeAcceptModal();
      qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Accept failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id) => api.post(`/website-bookings/${id}/reject`, { reason: 'rejected_by_staff' }),
    onSuccess: () => {
      toast.success('Booking rejected');
      qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Reject failed'),
  });

  const openPreview = (photos, startUrl) => {
    const list = photos.filter(Boolean);
    if (!list.length) return;
    setPreviewPhotos(list);
    setPreviewPhotoIndex(Math.max(0, list.indexOf(startUrl)));
  };

  const openAcceptModal = (booking) => {
    setAcceptBooking(booking);
    setPaymentMode('half');
    setCustomAmount(String(Math.round((Number(booking.total_egp) || 0) * 0.5 * 100) / 100));
    setEvidenceFile(null);
  };

  const closeAcceptModal = () => {
    setAcceptBooking(null);
    setEvidenceFile(null);
  };

  const submitAccept = () => {
    if (!acceptBooking) return;

    if (needsDeposit(acceptBooking)) {
      if (!(amountPaid > 0)) {
        toast.error('Enter how much the guest paid');
        return;
      }
      if (amountPaid + 0.009 < halfAmount) {
        toast.error(`Minimum deposit is 50% (${currency(halfAmount)})`);
        return;
      }
      if (amountPaid > acceptTotal + 0.5) {
        toast.error('Paid amount cannot exceed the total');
        return;
      }
      if (!evidenceFile) {
        toast.error('Upload payment evidence to accept');
        return;
      }
    }

    const fd = new FormData();
    if (needsDeposit(acceptBooking)) {
      fd.append('payment_mode', paymentMode);
      fd.append('amount_paid', String(amountPaid));
      if (evidenceFile) fd.append('evidence', evidenceFile);
    }
    acceptMutation.mutate({ id: acceptBooking.id, formData: fd });
  };

  if (isLoading) return <LoadingSpinner />;
  if (!bookings.length) return null;

  return (
    <>
      <div className="card p-4 space-y-3 border-amber-200 bg-amber-50/40">
        <div>
          <h2 className="font-semibold text-gray-900">Website requests awaiting confirmation</h2>
          <p className="text-xs text-gray-500">
            Review guest name, guests, duration, ID photos, and total. For InstaPay/Cash, collect at least 50%
            with evidence before accepting.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Guests</th>
                <th className="py-2 pr-3">Duration</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">Guest photos</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => {
                const idPhotos = toIdPhotos(b);
                const nights = nightsBetween(b.checkin, b.checkout);
                return (
                  <tr key={b.id} className="border-t border-amber-100/80">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{b.guest_name}</div>
                      <div className="text-xs text-gray-500">{b.guest_phone}</div>
                      {b.guest_email ? <div className="text-xs text-gray-400">{b.guest_email}</div> : null}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {b.guests != null ? b.guests : '—'}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <div>
                        {nights} night{nights === 1 ? '' : 's'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatDate(b.checkin)} → {formatDate(b.checkout)}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">{b.unit_title || b.listing_title}</td>
                    <td className="py-2.5 pr-3 font-medium">{currency(b.total_egp)}</td>
                    <td className="py-2.5 pr-3">
                      <Badge status={b.payment_status || 'pending'} />
                      <div className="text-[10px] text-gray-400 mt-0.5">{b.payment_method}</div>
                      {needsDeposit(b) ? (
                        <div className="text-[10px] text-amber-700 mt-0.5">Min 50% to accept</div>
                      ) : (
                        <div className="text-[10px] text-emerald-700 mt-0.5">Already paid</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1.5 min-w-[5rem]">
                        {idPhotos.length > 0 ? (
                          idPhotos.map((photo) => (
                            <button
                              key={photo}
                              type="button"
                              onClick={() => openPreview(idPhotos, photo)}
                              className="relative"
                              title="Review guest photo"
                            >
                              <img
                                src={photo}
                                alt="Guest ID"
                                className="h-12 w-12 rounded-md border border-amber-200 object-cover bg-white"
                              />
                              <span className="absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-700 text-white">
                                <Maximize2 className="h-2 w-2" strokeWidth={2} aria-hidden="true" />
                              </span>
                            </button>
                          ))
                        ) : (
                          <span className="text-xs italic text-gray-400">No photos</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={acceptMutation.isPending}
                          onClick={() => openAcceptModal(b)}
                        >
                          <Check className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs text-red-600"
                          disabled={rejectMutation.isPending}
                          onClick={() => rejectMutation.mutate(b.id)}
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!acceptBooking}
        onClose={closeAcceptModal}
        title="Accept reservation"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeAcceptModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={acceptMutation.isPending}
              onClick={submitAccept}
            >
              {acceptMutation.isPending ? 'Accepting…' : 'Confirm accept'}
            </button>
          </>
        }
      >
        {acceptBooking ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-500">Name</div>
                <div className="font-medium text-gray-900">{acceptBooking.guest_name}</div>
                <div className="text-xs text-gray-500">{acceptBooking.guest_phone}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Guests</div>
                <div className="font-medium">{acceptBooking.guests ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Duration</div>
                <div className="font-medium">
                  {nightsBetween(acceptBooking.checkin, acceptBooking.checkout)} night
                  {nightsBetween(acceptBooking.checkin, acceptBooking.checkout) === 1 ? '' : 's'}
                </div>
                <div className="text-xs text-gray-500">
                  {formatDate(acceptBooking.checkin)} → {formatDate(acceptBooking.checkout)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Total</div>
                <div className="font-semibold text-lg text-gray-900">{currency(acceptTotal)}</div>
                <div className="text-xs text-gray-500">{acceptBooking.payment_method}</div>
              </div>
            </div>

            <div>
              <div className="text-xs uppercase text-gray-500 mb-2">Guest photos</div>
              <div className="flex flex-wrap gap-2">
                {toIdPhotos(acceptBooking).length ? (
                  toIdPhotos(acceptBooking).map((photo) => (
                    <button
                      key={photo}
                      type="button"
                      onClick={() => openPreview(toIdPhotos(acceptBooking), photo)}
                    >
                      <img
                        src={photo}
                        alt="Guest"
                        className="h-16 w-16 rounded-md border object-cover"
                      />
                    </button>
                  ))
                ) : (
                  <span className="text-sm text-gray-400 italic">No photos uploaded</span>
                )}
              </div>
            </div>

            {needsDeposit(acceptBooking) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-4">
                <p className="text-sm text-amber-900">
                  InstaPay / Cash: guest must pay at least 50% ({currency(halfAmount)}) before you can accept.
                </p>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Amount received
                  </label>
                  <select
                    className="input w-full"
                    value={paymentMode}
                    onChange={(e) => {
                      const mode = e.target.value;
                      setPaymentMode(mode);
                      if (mode === 'half') setCustomAmount(String(halfAmount));
                      if (mode === 'full') setCustomAmount(String(acceptTotal));
                    }}
                  >
                    <option value="half">50% deposit ({currency(halfAmount)})</option>
                    <option value="full">Full amount ({currency(acceptTotal)})</option>
                    <option value="other">Other amount</option>
                  </select>
                </div>

                {paymentMode === 'other' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Enter amount paid (EGP)
                    </label>
                    <input
                      type="number"
                      min={halfAmount}
                      max={acceptTotal}
                      step="0.01"
                      className="input w-full"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                    />
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-white border px-3 py-2">
                    <div className="text-xs text-gray-500">Deducted now</div>
                    <div className="font-semibold">{currency(amountPaid)}</div>
                  </div>
                  <div className="rounded-lg bg-white border px-3 py-2">
                    <div className="text-xs text-gray-500">Remaining balance</div>
                    <div className="font-semibold text-amber-800">{currency(remaining)}</div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Payment evidence
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-3 text-sm hover:border-amber-400">
                    <Upload className="h-4 w-4 text-gray-500" />
                    <span className="truncate">
                      {evidenceFile ? evidenceFile.name : 'Upload transfer / cash receipt'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
                This booking is already paid online. No deposit entry needed.
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {previewPhotos.length > 0 && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewPhotos([])}
        >
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
                  onClick={() =>
                    setPreviewPhotoIndex((i) => (i - 1 + previewPhotos.length) % previewPhotos.length)
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-white">
                  {previewPhotoIndex + 1} / {previewPhotos.length}
                </span>
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
    </>
  );
}
