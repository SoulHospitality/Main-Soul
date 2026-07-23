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
  // Reservation / owner portal status
  confirmed:   { label: 'Confirmed',   className: 'badge-blue'   },
  pending:     { label: 'Pending',     className: 'badge-yellow' },
  rejected:    { label: 'Rejected',    className: 'badge-red'    },
  checked_in:  { label: 'Checked In',  className: 'badge-green'  },
  checked_out: { label: 'Checked Out', className: 'badge-gray'   },
  cancelled:   { label: 'Cancelled',   className: 'badge-red'    },
  // Payment status
  partial:     { label: 'Partial',     className: 'badge-orange' },
  paid:        { label: 'Paid',        className: 'badge-green'  },
  // Unit status
  available:   { label: 'Available',   className: 'badge-green'  },
  occupied:    { label: 'Occupied',    className: 'badge-blue'   },
  maintenance: { label: 'Maintenance', className: 'badge-yellow' },
};

export const getStatusConfig = (status) =>
  STATUS_CONFIG[status] || { label: status, className: 'badge-gray' };

export const BOOKING_SOURCES = ['Private', 'Broker', 'Campaign', 'Facebook Post'];
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'credit_card', 'online'];
export const PAYMENT_METHOD_LABELS = { cash: 'Cash', bank_transfer: 'Bank Transfer', credit_card: 'Credit Card', online: 'Online' };
export const UNIT_TYPES = ['Apartment', 'Studio', 'Villa', 'Penthouse', 'Chalet', 'Hotel Room'];

/** Townhouse / town home → Villa; otherwise keep known casing. */
export function normalizePropertyType(type) {
  const raw = String(type || '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'townhouse' || key === 'townhome') return 'Villa';
  const known = UNIT_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return known || raw;
}
