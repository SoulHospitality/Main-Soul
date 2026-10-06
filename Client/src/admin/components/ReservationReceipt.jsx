import { currency } from '../utils/formatters';
import { calcReservationFinancials, appliedPctLabel } from '../utils/commission';
import { reservationBill } from '../utils/reservationBill';

function Line({ label, value, className = '', valueClass = '' }) {
  return (
    <div className={`flex justify-between gap-3 ${className}`}>
      <span className="text-gray-500">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

/** Bill breakdown shared by the Reservations and Schedule detail views. */
export default function ReservationReceipt({ reservation, showCommission = false }) {
  if (!reservation) return null;
  const { total, toCollect: amountToPay, remainingAccommodation } = reservationBill(reservation);
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
  const ownerFull = reservation.owner_collected_type === 'full';

  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
      <Line label="Total (full bill)" value={currency(total)} valueClass="font-semibold text-gray-900" />
      {reservation.owner_collected_type && (
        <div className={`flex justify-between rounded-lg px-2 py-1 ${ownerFull ? 'bg-green-50' : 'bg-amber-50'}`}>
          <span className={ownerFull ? 'text-green-700' : 'text-amber-700'}>
            Owner collected ({ownerFull ? 'full payment' : 'down payment'})
          </span>
          <span className={`font-semibold ${ownerFull ? 'text-green-700' : 'text-amber-700'}`}>
            {currency(reservation.owner_collected_amount)}
          </span>
        </div>
      )}
      <Line
        label="We Need to Collect"
        value={currency(amountToPay)}
        valueClass={`font-semibold ${amountToPay > 0 ? 'text-red-600' : 'text-green-600'}`}
      />
      <Line label="Remaining Accommodation" value={currency(remainingAccommodation)} />
      {Number(reservation.housekeeping_fees) > 0 && <Line label="Housekeeping" value={currency(reservation.housekeeping_fees)} />}
      {Number(reservation.beach_access_fees) > 0 && <Line label="Beach Pass" value={currency(reservation.beach_access_fees)} />}
      {Number(reservation.insurance) > 0 && <Line label="Insurance" value={currency(reservation.insurance)} />}
      {fin.utilitiesDeduction > 0 && (
        <Line label="Utilities" value={`− ${currency(fin.utilitiesDeduction)} (from owner nightly rate)`} valueClass="text-orange-600" />
      )}
      {showCommission && fin.tenantDeduction > 0 && (
        <Line label="Tenant Commission" value={`− ${currency(fin.tenantDeduction)}`} valueClass="text-orange-600" />
      )}
      {fin.brokerDeduction > 0 && (
        <Line
          label={`Broker${reservation.broker_name ? ` (${reservation.broker_name})` : ''}`}
          value={`− ${currency(fin.brokerDeduction)}`}
          valueClass="text-purple-600"
        />
      )}
      {showCommission && fin.companyCommission > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-500">
            Company Commission <span className="text-xs text-gray-400">({appliedPctLabel(fin, reservation)})</span>
          </span>
          <span className="text-red-600">− {currency(fin.companyCommission)}</span>
        </div>
      )}
      {showCommission && (
        <Line
          label="Owner Net"
          value={currency(fin.ownerNet)}
          className="border-t border-gray-200 pt-1.5"
          valueClass="font-semibold text-primary-700"
        />
      )}
      <Line
        label="Amount Paid"
        value={currency(reservation.amount_paid)}
        className={showCommission ? '' : 'border-t border-gray-200 pt-1.5'}
        valueClass="font-semibold text-green-600"
      />
    </div>
  );
}

export function BrokerDetails({ reservation }) {
  if (!reservation) return null;
  const perNight = Number(reservation.broker_amount_per_night) || 0;
  const total = Number(reservation.broker_total) || 0;
  if (!reservation.broker_name && !reservation.broker_phone && !perNight && !total) return null;
  return (
    <div className="rounded-xl border border-purple-100 bg-purple-50/60 px-4 py-3 text-sm">
      <p className="mb-2 font-semibold text-purple-900">Broker</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <Line label="Name" value={reservation.broker_name || '—'} valueClass="text-gray-800" />
        <Line
          label="Phone"
          value={
            reservation.broker_phone ? (
              <a href={`tel:${reservation.broker_phone}`} className="text-primary-600 hover:underline">
                {reservation.broker_phone}
              </a>
            ) : (
              '—'
            )
          }
        />
        <Line label="Per night" value={perNight ? currency(perNight) : '—'} valueClass="text-gray-800" />
        <Line label="Total" value={total ? currency(total) : '—'} valueClass="font-semibold text-purple-700" />
      </div>
    </div>
  );
}
