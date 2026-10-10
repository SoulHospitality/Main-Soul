import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { salesUsersForActor } from '../utils/permissions';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
import AdminReservationDrawer from '../components/AdminReservationDrawer';
import ManualReservationForm, {
  EMPTY_MANUAL_RESERVATION_FORM,
  manualReservationPaymentError,
} from '../components/ManualReservationForm';
import { inboxApi, errorMessage } from './api';
import { bookingSourceFor, phoneDisplay } from './utils';

/**
 * The PMS manual reservation form, prefilled from the lead. On success the reservation is
 * linked to the lead, which closes it as won with the real booking value.
 */
export default function ReservationFromLead({ open, onClose, lead, customer, unitId, pricePerNight, onCreated }) {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY_MANUAL_RESERVATION_FORM });
  const [proof, setProof] = useState(null);

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
    enabled: open,
  });
  const { data: usersList = [] } = useQuery({
    queryKey: ['users-sales'],
    queryFn: () => api.get('/users/sales').then((r) => r.data),
    enabled: open,
  });
  const salesUsers = useMemo(() => salesUsersForActor(usersList, user), [usersList, user]);

  useEffect(() => {
    if (!open || !lead) return;
    const ownerIsSales = salesUsers.some((u) => String(u.id) === String(lead.owner_user_id));
    setForm({
      ...EMPTY_MANUAL_RESERVATION_FORM,
      unit_id: unitId || lead.unit_id || '',
      guest_name: customer?.name || '',
      guest_phone: phoneDisplay(customer?.phone),
      guest_email: customer?.email || '',
      check_in: lead.check_in || '',
      check_out: lead.check_out || '',
      adults: lead.guests ? String(lead.guests) : '2',
      price_per_night: pricePerNight ? String(Math.round(pricePerNight)) : '',
      booking_source: bookingSourceFor(lead.source),
      sales_person_id: !isAdmin ? String(user?.id || '') : ownerIsSales ? String(lead.owner_user_id) : '',
      payment_method: 'cash',
      notes: `Inbox lead #${lead.id}${lead.campaign ? ` · campaign ${lead.campaign}` : ''}`,
    });
    setProof(null);
    // Prefill once per opening; later edits belong to the agent.
  }, [open, lead?.id]);

  const create = useMutation({
    mutationFn: async (payload) => {
      const res = payload instanceof FormData
        ? await api.post('/reservations', payload, { headers: { 'Content-Type': 'multipart/form-data' } })
        : await api.post('/reservations', payload);
      return res.data;
    },
    onSuccess: async (reservation) => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      try {
        await inboxApi.post(`/leads/${lead.id}/reservation`, { reservation_id: reservation.id });
        toast.success(`Reservation #${reservation.id} created — lead marked as booked`);
      } catch (err) {
        toast.error(`Reservation #${reservation.id} created, but linking failed: ${errorMessage(err)}`);
      }
      onCreated?.(reservation);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, 'Error creating reservation')),
  });

  const submit = () => {
    if (!form.guest_phone?.trim()) return toast.error('Mobile number is required');
    if (!form.is_owner_reservation && !form.sales_person_id) {
      return toast.error('Please select a Sales Person or mark as Owner Reservation');
    }
    if (!form.unit_id || !form.check_in || !form.check_out) return toast.error('Unit and dates are required');
    const adults = Math.max(0, parseInt(form.adults, 10) || 0);
    if (!form.is_owner_reservation && adults < 1) return toast.error('At least 1 adult is required');
    if (!form.is_owner_reservation && (form.utilities_cost_override ?? '') === '') {
      return toast.error('Enter the utilities per night for this stay (0 if none)');
    }
    if (!form.is_owner_reservation && form.payment_method === 'other' && !form.payment_method_note?.trim()) {
      return toast.error('Add a comment for the Other payment method');
    }
    const paymentError = manualReservationPaymentError(form);
    if (paymentError) return toast.error(paymentError);
    const unit = units.find((u) => String(u.id) === String(form.unit_id));
    const payload = {
      ...form,
      adults,
      children: Math.max(0, parseInt(form.children, 10) || 0),
      nanny_count: Math.max(0, parseInt(form.nanny_count, 10) || 0),
      housekeeping_fees:
        form.housekeeping_fees !== '' && form.housekeeping_fees != null
          ? Number(form.housekeeping_fees) || 0
          : form.currency === 'USD'
            ? undefined
            : unit
              ? housekeepingFeeForUnit(unit)
              : 0,
      beach_access_fees: form.is_owner_reservation
        ? 0
        : form.beach_access_fees !== '' && form.beach_access_fees != null
          ? Number(form.beach_access_fees)
          : undefined,
    };
    if (proof) {
      const fd = new FormData();
      Object.entries(payload).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
      });
      fd.append('transfer_proof', proof);
      return create.mutate(fd);
    }
    return create.mutate(payload);
  };

  return (
    <AdminReservationDrawer
      open={open}
      onClose={onClose}
      title="Book this lead"
      subtitle={`Lead #${lead?.id || ''} · the reservation will close the lead as booked`}
    >
      <ManualReservationForm
        form={form}
        setForm={setForm}
        units={units}
        users={salesUsers}
        transferProof={proof}
        onTransferProofChange={setProof}
        lockSalesPerson={!isAdmin}
        currentUserName={user?.full_name || user?.username || ''}
        showCommission={isAdmin}
        allowPastDates={isAdmin}
        onCancel={onClose}
        onSubmit={submit}
        submitting={create.isPending}
      />
    </AdminReservationDrawer>
  );
}
