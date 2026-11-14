const REQUEST_ENTITY_KIND = {
  leave_request: 'leave',
  wfh_request: 'wfh',
  loan_request: 'loan',
};

/** Notifications about the reader's own request open "My requests"; the rest open the review queue. */
const OWN_REQUEST_TYPES = new Set(['request_approved', 'request_rejected', 'request_progress']);

export const NOTIFICATION_ICONS = {
  new_booking: '🏠',
  booking_accepted: '✅',
  booking_rejected: '❌',
  reservation_created: '📝',
  cancel_request: '⚠️',
  payment_pending: '💳',
  checkin_reminder: '📅',
  checkin: '📅',
  payment: '💳',
  request_submitted: '📨',
  request_progress: '⏳',
  request_approved: '✅',
  request_rejected: '❌',
  owner_comment: '💬',
  owner_comment_reply: '💬',
  unit_inspection: '🔍',
  default: '🔔',
};

export function notificationIcon(n) {
  return NOTIFICATION_ICONS[n?.type] || NOTIFICATION_ICONS[n?.entity_type] || NOTIFICATION_ICONS.default;
}

/** Where a notification takes you when it's opened. */
export function notificationHref(n) {
  const requestKind = REQUEST_ENTITY_KIND[n.entity_type];
  if (requestKind) {
    const tab = OWN_REQUEST_TYPES.has(n.type) ? 'mine' : 'review';
    return `/admin/requests?tab=${tab}${n.entity_id ? `&open=${requestKind}:${n.entity_id}` : ''}`;
  }
  if (n.type === 'new_booking') return '/admin/website-bookings/unassigned';
  if (n.entity_type === 'booking') return '/admin/website-bookings';
  if (n.entity_type === 'owner_comment') {
    if (n.type === 'owner_comment_reply') return '/admin/owner/comments';
    return `/admin/owner-comments${n.entity_id ? `?thread=${n.entity_id}` : ''}`;
  }
  if (n.entity_type === 'unit_inspection') {
    if (n.type === 'owner_unit_inspection') return '/admin/owner/inspections';
    return `/admin/operations?tab=inspections${n.entity_id ? `&inspection=${n.entity_id}` : ''}`;
  }
  if (n.entity_type === 'reservation' && n.entity_id) {
    return `/admin/reservations?view=${n.entity_id}`;
  }
  if (n.type === 'booking_accepted' || n.type === 'booking_rejected') {
    return '/admin/website-bookings/history';
  }
  if (n.entity_type === 'kpi_target') return '/admin/kpi';
  // Owner payouts: the owner lands on their Payouts page, finance on the owners' withdrawal queue.
  if (n.entity_type === 'owner_payout_request') {
    return n.type === 'owner_payout_requested' ? '/admin/financial-system?tool=owners' : '/admin/owner/payouts';
  }
  return '/admin/reservations';
}
