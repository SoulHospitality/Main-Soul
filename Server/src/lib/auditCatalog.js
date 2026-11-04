/**
 * Groups every audit action into a category for the unified Audit Log page.
 * Order matters: the first matching rule wins. Unmatched actions fall into "other".
 */
const AUDIT_CATEGORIES = [
  {
    key: 'reservations',
    actions: [
      'CREATE_RESERVATION',
      'UPDATE_RESERVATION',
      'CANCEL_RESERVATION',
      'DELETE_RESERVATION',
      'TRANSFER_RESERVATION',
      'UPLOAD_RESERVATION_ID',
      'REMOVE_RESERVATION_ID',
      'ACCEPT_WEBSITE_BOOKING',
      'REJECT_WEBSITE_BOOKING',
      'ASSIGN_WEBSITE_BOOKING',
      'UPDATE_WEBSITE_COLLECTED',
    ],
  },
  {
    key: 'payments',
    actions: ['RECORD_PAYMENT', 'CREATE_PAYMENT', 'APPROVE_PAYMENT', 'FINANCE_REVIEW_PAYMENT', 'APPROVE_CANCEL_REFUND'],
  },
  {
    key: 'finance',
    actions: [
      'CREATE_EXPENSE',
      'UPDATE_EXPENSE',
      'DELETE_EXPENSE',
      'MANUAL_ENTRY',
      'EDIT_MANUAL_ENTRY',
      'CLOSE_PERIOD',
      'REOPEN_PERIOD',
      'HOLDBACK_CREATED',
      'BANK_SNAPSHOT',
      'GENERATE_OWNER_SETTLEMENT',
      'UPDATE_OWNER_SETTLEMENT',
      'REQUEST_OWNER_PAYOUT',
      'REVIEW_OWNER_PAYOUT',
    ],
  },
  {
    key: 'acquisition',
    actions: [
      'CREATE_ACQUISITION_LEAD',
      'UPDATE_ACQUISITION_LEAD',
      'DELETE_ACQUISITION_LEAD',
      'CREATE_UNIT_FROM_LEAD',
      'LOG_ACQUISITION_NEGOTIATION',
      'CREATE_ACQUISITION_CONTRACT',
    ],
  },
  {
    key: 'units',
    actions: [
      'CREATE_UNIT',
      'UPDATE_UNIT',
      'DELETE_UNIT',
      'PUBLISH_UNIT',
      'UNPUBLISH_UNIT',
      'UPDATE_DAILY_PRICES',
      'GENERATE_PRICING_RECOMMENDATION',
      'UPDATE_PRICING_RECOMMENDATION',
    ],
  },
  { key: 'owners', actions: ['OWNER_BLOCK_DATES', 'OWNER_UNBLOCK_DATES'] },
  { key: 'operations', prefixes: ['OPS_', 'UNIT_INSPECTION_'], actions: ['CREATE_MAINTENANCE_TICKET'] },
  {
    key: 'housekeeping',
    prefixes: ['HK_'],
    actions: ['CREATE_HOUSEKEEPING_TASK', 'SUBMIT_HOUSEKEEPING_TASK', 'INSPECT_HOUSEKEEPING_TASK', 'CREATE_HK_SERVICE_ORDER'],
  },
  {
    key: 'team',
    actions: [
      'CREATE_STAFF_TASK',
      'UPDATE_STAFF_TASK',
      'DELETE_STAFF_TASK',
      'COMPLETE_STAFF_TASK',
      'REPLY_STAFF_TASK',
      'KPI_TARGET_CREATE',
      'UPSERT_RESERVATION_TARGET',
      'APPLY_RESERVATION_TARGETS',
      'UPDATE_USER_ACCESS',
      'CHANGE_ROLE',
    ],
  },
  { key: 'inbox', prefixes: ['INBOX_'] },
];

const CATEGORY_KEYS = [...AUDIT_CATEGORIES.map((c) => c.key), 'other'];

function categoryOf(action) {
  const a = String(action || '');
  for (const c of AUDIT_CATEGORIES) {
    if (c.actions?.includes(a)) return c.key;
    if (c.prefixes?.some((p) => a.startsWith(p))) return c.key;
  }
  return 'other';
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** SQL CASE expression that maps an action column to its category key. */
function categorySql(column) {
  const whens = [];
  for (const c of AUDIT_CATEGORIES) {
    const tests = [];
    if (c.actions?.length) tests.push(`${column} IN (${c.actions.map(sqlString).join(', ')})`);
    for (const p of c.prefixes || []) tests.push(`${column} LIKE ${sqlString(`${p.replace(/_/g, '\\_')}%`)}`);
    whens.push(`WHEN ${tests.join(' OR ')} THEN ${sqlString(c.key)}`);
  }
  return `CASE ${whens.join(' ')} ELSE 'other' END`;
}

module.exports = { AUDIT_CATEGORIES, CATEGORY_KEYS, categoryOf, categorySql };
