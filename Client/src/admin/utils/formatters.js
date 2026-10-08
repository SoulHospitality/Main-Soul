export const currency = (amount, symbol = 'EGP') =>
  `${symbol} ${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (dateStr) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const nightsText = (n) => `${n} night${n !== 1 ? 's' : ''}`;

export const STATUS_CONFIG = {
  
  confirmed:   { label: 'Confirmed',   className: 'badge-blue'   },
  pending:     { label: 'Pending',     className: 'badge-yellow' },
  rejected:    { label: 'Rejected',    className: 'badge-red'    },
  checked_in:  { label: 'Checked In',  className: 'badge-green'  },
  checked_out: { label: 'Checked Out', className: 'badge-gray'   },
  cancelled:   { label: 'Cancelled',   className: 'badge-red'    },
  
  partial:     { label: 'Partial',     className: 'badge-orange' },
  paid:        { label: 'Paid',        className: 'badge-green'  },
  
  available:   { label: 'Available',   className: 'badge-green'  },
  occupied:    { label: 'Occupied',    className: 'badge-blue'   },
  maintenance: { label: 'Maintenance', className: 'badge-yellow' },
};

export const getStatusConfig = (status) =>
  STATUS_CONFIG[status] || { label: status, className: 'badge-gray' };

export const BOOKING_SOURCES = [
  'Website',
  'Airbnb',
  'Booking.com',
  'Manual',
  'Private',
  'Broker',
  'Campaign',
  'Facebook Post',
];
export const PAYMENT_METHODS = ['cash', 'instapay', 'bank_transfer', 'credit_card', 'online'];
export const MANUAL_PAYMENT_METHODS = ['cash', 'instapay', 'other'];
export const PAYMENT_METHOD_LABELS = {
  other: 'Other',
  cash: 'Cash',
  instapay: 'InstaPay',
  bank_transfer: 'Bank Transfer',
  credit_card: 'Credit Card',
  online: 'Online',
  paymob_card: 'Card (Paymob)',
};
export const BANK_ACCOUNTS = ['adib', 'cib'];
export const BANK_ACCOUNT_LABELS = { adib: 'ADIB', cib: 'CIB' };
export const RESERVATION_CURRENCIES = ['EGP', 'USD'];

/** USD reservations are stored in EGP at their exchange rate; returns the dollar figure. */
export function toReservationCurrency(r, egpAmount) {
  const rate = Number(r?.exchange_rate) || 0;
  if (String(r?.currency || '').toUpperCase() !== 'USD' || !(rate > 0)) return Number(egpAmount) || 0;
  return Math.round(((Number(egpAmount) || 0) / rate) * 100) / 100;
}

/** "USD 120.00 (EGP 6,000.00)" for USD reservations, plain EGP otherwise. */
export function reservationMoney(r, egpAmount) {
  if (String(r?.currency || '').toUpperCase() !== 'USD' || !(Number(r?.exchange_rate) > 0)) {
    return currency(egpAmount);
  }
  return `${currency(toReservationCurrency(r, egpAmount), 'USD')} (${currency(egpAmount)})`;
}
export const UNIT_TYPES = ['Apartment', 'Studio', 'Villa', 'Penthouse', 'Chalet', 'Hotel Room'];


export function normalizePropertyType(type) {
  const raw = String(type || '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'townhouse' || key === 'townhome') return 'Villa';
  const known = UNIT_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return known || raw;
}


export function unitCode(u) {
  if (!u) return '';
  return (
    u.unit_number ||
    u.unitNumber ||
    u.unit_name ||
    u.unit_title ||
    u.internal_code ||
    ''
  );
}


export function unitSelectLabel(u, { withProject = true } = {}) {
  const code = unitCode(u) || u?.name || u?.title || 'Unit';
  if (!withProject) return String(code);
  const project = u?.project || u?.compound || '';
  return project ? `${code} — ${project}` : String(code);
}


export function unitDisplay(row, fallback = '—') {
  return unitCode(row) || row?.name || row?.title || fallback;
}
