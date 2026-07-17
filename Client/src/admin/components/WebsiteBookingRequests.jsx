import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Badge from './ui/Badge';
import LoadingSpinner from './ui/LoadingSpinner';
import { currency, formatDate } from '../utils/formatters';

function toIdPhotos(booking) {
  if (Array.isArray(booking?.id_photo_urls)) {
    return booking.id_photo_urls.filter(Boolean);
  }
  return [];
}

export default function WebsiteBookingRequests() {
  const qc = useQueryClient();
  const [previewPhotos, setPreviewPhotos] = useState([]);
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState(0);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['website-bookings-pending'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'pending' } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const acceptMutation = useMutation({
    mutationFn: (id) => api.post(`/website-bookings/${id}/accept`),
    onSuccess: () => {
      toast.success('Booking accepted');
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

  if (isLoading) return <LoadingSpinner />;
  if (!bookings.length) return null;

  return (
    <>
      <div className="card p-4 space-y-3 border-amber-200 bg-amber-50/40">
        <div>
          <h2 className="font-semibold text-gray-900">Website requests awaiting confirmation</h2>
          <p className="text-xs text-gray-500">
            Review guest ID photos, then Accept or Reject. Pending holds from guest checkout (Paymob / cash / InstaPay).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Dates</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">ID Photos</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => {
                const idPhotos = toIdPhotos(b);
                return (
                  <tr key={b.id} className="border-t border-amber-100/80">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{b.guest_name}</div>
                      <div className="text-xs text-gray-500">{b.guest_phone}</div>
                      {b.guest_email ? <div className="text-xs text-gray-400">{b.guest_email}</div> : null}
                    </td>
                    <td className="py-2.5 pr-3">{b.unit_title || b.listing_title}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {formatDate(b.checkin)} → {formatDate(b.checkout)}
                    </td>
                    <td className="py-2.5 pr-3">{currency(b.total_egp)}</td>
                    <td className="py-2.5 pr-3">
                      <Badge status={b.payment_status || 'pending'} />
                      <div className="text-[10px] text-gray-400 mt-0.5">{b.payment_method}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1.5 min-w-[5rem]">
                        {idPhotos.length > 0 ? idPhotos.map((photo) => (
                          <button
                            key={photo}
                            type="button"
                            onClick={() => openPreview(idPhotos, photo)}
                            className="relative"
                            title="Review ID photo"
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
                        )) : (
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
                          onClick={() => acceptMutation.mutate(b.id)}
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

      {previewPhotos.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
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
