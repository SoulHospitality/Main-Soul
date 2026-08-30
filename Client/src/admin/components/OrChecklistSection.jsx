import { useMemo } from 'react';
import { currency, formatDate, unitDisplay } from '../utils/formatters';
import { calcReservationFinancials } from '../utils/commission';
import { isoDateOnly, addOneDayStr } from '../../utils/stayNights';

function localTodayIso() {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function orChecklistNetNightRate(reservation) {
  if (!reservation) return null;
  const fin = calcReservationFinancials(
    {
      commission_mode: reservation.commission_mode,
      company_commission_pct: reservation.company_commission_pct,
      company_commission_owner_pct: reservation.company_commission_owner_pct,
      commission_tenant_pct: reservation.commission_tenant_pct,
      utilities_cost: reservation.unit_utilities_cost,
    },
    reservation
  );
  return fin?.adjustedPricePerNight ?? null;
}

export function countOrChecklistRows(reservations = []) {
  const today = localTodayIso();
  const tomorrow = addOneDayStr(today);
  return reservations.filter((r) => {
    if (String(r.status || '').toLowerCase() === 'cancelled') return false;
    const checkIn = isoDateOnly(r.check_in);
    return checkIn === today || checkIn === tomorrow;
  }).length;
}

export default function OrChecklistSection({ reservations, canEdit, onToggle, savingId }) {
  const today = localTodayIso();
  const tomorrow = addOneDayStr(today);

  const rows = useMemo(() => {
    return reservations
      .filter((r) => {
        if (String(r.status || '').toLowerCase() === 'cancelled') return false;
        const checkIn = isoDateOnly(r.check_in);
        return checkIn === today || checkIn === tomorrow;
      })
      .sort((a, b) => {
        const ai = isoDateOnly(a.check_in);
        const bi = isoDateOnly(b.check_in);
        if (ai !== bi) return ai.localeCompare(bi);
        return String(a.unit_number || '').localeCompare(String(b.unit_number || ''));
      });
  }, [reservations, today, tomorrow]);

  const checkCell = (reservation, field, label) => (
    <td className="py-2 px-2 text-center">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 disabled:opacity-50"
        checked={Boolean(reservation[field])}
        disabled={!canEdit || savingId === reservation.id}
        aria-label={label}
        onChange={(e) => onToggle(reservation.id, field, e.target.checked)}
      />
    </td>
  );

  return (
    <div className="card p-4 space-y-3 border-teal-200 bg-teal-50/30">
      <div>
        <h2 className="font-semibold text-gray-900">Checklist</h2>
        <p className="text-xs text-gray-500">
          Check-ins today ({formatDate(today)}) and tomorrow ({formatDate(tomorrow)}). Net / night is
          after broker, tenant cut, company commission, and utilities.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 py-4 text-center">No check-ins today or tomorrow.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-teal-100">
              <tr>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Check-in</th>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3 text-right">Nights</th>
                <th className="py-2 pr-3 text-right">Net / night</th>
                <th className="py-2 px-2 text-center">Notified Owner</th>
                <th className="py-2 px-2 text-center">IDs Collected</th>
                <th className="py-2 px-2 text-center">Permissions done & sent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const netNight = orChecklistNetNightRate(r);
                const nights = Math.max(parseInt(r.nights, 10) || 1, 1);
                return (
                  <tr key={r.id} className="border-t border-teal-100/80 align-middle">
                    <td className="py-2 pr-3 font-semibold text-gray-900">
                      {r.unit_number || unitDisplay(r)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatDate(r.check_in)}</td>
                    <td className="py-2 pr-3">{r.guest_name || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{nights}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">
                      {currency(netNight)}
                    </td>
                    {checkCell(r, 'or_notified_owner', 'Notified owner')}
                    {checkCell(r, 'or_ids_collected', 'IDs collected')}
                    {checkCell(r, 'or_permissions_done', 'Permissions done and sent')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
