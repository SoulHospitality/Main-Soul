/**
 * Notifications for staff requests (holiday, excuse, mission, work from home, loan).
 *
 * - When a request is sent, whoever can act on it now gets a notification.
 * - When someone accepts a step, the requester hears about it and the next reviewer is told it's their turn.
 * - When it's approved or rejected, the requester is told.
 * Everyone involved also gets a `pms:requests` event so their sidebar counts refresh without reloading.
 */
const { query } = require('../config/db');
const { notifyStaff } = require('../services/pmsNotifications');
const { emitToUsers } = require('../config/socket');
const { eligibleReviewSlots, leaveTypeApprovalMode, normalizeExcuseLeaveType } = require('./hrRules');

const LEAVE_LABELS = {
  casual: 'Casual leave',
  annual: 'Annual leave',
  unpaid: 'Unpaid leave',
  sick: 'Sick leave',
  paid_excuse: 'Excuse',
  unpaid_excuse: 'Excuse',
  early_leave: 'Excuse',
  mission: 'Mission',
  meeting: 'Meeting',
};

const ENTITY = { leave: 'leave_request', wfh: 'wfh_request', loan: 'loan_request' };

/** Which bucket a request is counted in (sidebar and page counts). */
function requestCategory(kind, leaveType) {
  if (kind === 'wfh') return 'wfh';
  if (kind === 'loan') return 'loan';
  const t = normalizeExcuseLeaveType(leaveType);
  if (t === 'paid_excuse' || t === 'unpaid_excuse') return 'excuse';
  if (t === 'mission') return 'mission';
  return 'holiday';
}

/** Postgres DATE columns arrive as Date objects (local midnight) or as 'YYYY-MM-DD' text. */
function isoDay(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value || '').slice(0, 10);
}

function dayLabel(iso) {
  const text = isoDay(iso);
  if (!text) return '';
  const d = new Date(`${text}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function describeRequest(kind, row) {
  if (kind === 'loan') return `Loan · EGP ${Number(row.amount || 0).toLocaleString('en-EG')}`;
  if (kind === 'wfh') return `Work from home · ${dayLabel(row.work_date)}`;
  const label = LEAVE_LABELS[normalizeExcuseLeaveType(row.leave_type)] || 'Leave';
  const start = isoDay(row.start_date);
  const end = row.end_date ? isoDay(row.end_date) : start;
  const time = row.start_time && row.end_time
    ? ` ${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)}`
    : '';
  return start === end ? `${label} · ${dayLabel(start)}${time}` : `${label} · ${dayLabel(start)} – ${dayLabel(end)}`;
}

function kindNoun(kind, row) {
  if (kind === 'loan') return 'loan request';
  if (kind === 'wfh') return 'work-from-home request';
  const cat = requestCategory(kind, row.leave_type);
  if (cat === 'excuse') return 'excuse request';
  if (cat === 'mission') return 'mission request';
  return 'holiday request';
}

async function loadStaff(staffUserId) {
  const { rows } = await query(
    `SELECT u.id, u.role, u.full_name, u.manager_id,
            COALESCE((SELECT array_agg(sm.manager_id) FROM staff_user_managers sm WHERE sm.staff_user_id = u.id), ARRAY[]::int[]) AS manager_ids
     FROM staff_users u WHERE u.id = $1`,
    [staffUserId]
  );
  const s = rows[0];
  if (!s) return null;
  const managerIds = (s.manager_ids || []).map(Number).filter(Number.isFinite);
  if (s.manager_id != null && !managerIds.includes(Number(s.manager_id))) managerIds.push(Number(s.manager_id));
  return { ...s, manager_ids: managerIds };
}

function shapeRequest(kind, row, staff) {
  return {
    ...row,
    role: staff.role,
    manager_id: staff.manager_id,
    manager_ids: staff.manager_ids,
    request_kind: kind,
    approval_mode: row.approval_mode || (row.leave_type ? leaveTypeApprovalMode(row.leave_type) : 'all'),
  };
}

/**
 * People who can act on the request right now. The CEO can always act, so CEOs are only told
 * when nobody else can (otherwise every request in the company would ping them).
 */
async function currentReviewers(kind, row, staff) {
  const { rows } = await query(
    `SELECT id, role FROM staff_users
     WHERE COALESCE(is_active, 1)::int = 1
       AND (role IN ('admin', 'hr_supervisor', 'finance_manager') OR id = ANY($1::int[]))`,
    [staff.manager_ids.length ? staff.manager_ids : [0]]
  );
  const shaped = shapeRequest(kind, row, staff);
  const able = rows.filter((actor) => eligibleReviewSlots(actor, shaped, staff).length > 0);
  const others = able.filter((a) => a.role !== 'admin');
  return { reviewers: (others.length ? others : able).map((a) => Number(a.id)), everyone: rows.map((a) => Number(a.id)) };
}

function hrefParams(kind, row) {
  return { kind, id: row.id, category: requestCategory(kind, row.leave_type) };
}

async function notifyRequestSubmitted(kind, row) {
  const staff = await loadStaff(row.staff_user_id);
  if (!staff) return;
  const { reviewers, everyone } = await currentReviewers(kind, row, staff);
  await notifyStaff({
    userIds: reviewers,
    excludeUserIds: [staff.id],
    type: 'request_submitted',
    title: `New ${kindNoun(kind, row)}`,
    message: `${staff.full_name} · ${describeRequest(kind, row)}`,
    entity_type: ENTITY[kind],
    entity_id: row.id,
  });
  emitToUsers([...everyone, staff.id], 'pms:requests', hrefParams(kind, row));
}

async function notifyRequestReviewed(kind, before, after, actor) {
  const staff = await loadStaff(after.staff_user_id);
  if (!staff) return;
  const { reviewers, everyone } = await currentReviewers(kind, after, staff);
  const what = describeRequest(kind, after);
  const by = actor?.full_name || 'Your manager';
  const note = after.review_note && after.review_note !== before.review_note ? ` — “${String(after.review_note).slice(0, 120)}”` : '';

  if (after.status === 'approved' || after.status === 'rejected') {
    await notifyStaff({
      userIds: [staff.id],
      excludeUserIds: [actor?.id],
      type: after.status === 'approved' ? 'request_approved' : 'request_rejected',
      title: after.status === 'approved' ? `Your ${kindNoun(kind, after)} was approved` : `Your ${kindNoun(kind, after)} was rejected`,
      message: `${what} · by ${by}${note}`,
      entity_type: ENTITY[kind],
      entity_id: after.id,
    });
  } else if (after.status === 'pending') {
    await notifyStaff({
      userIds: [staff.id],
      excludeUserIds: [actor?.id],
      type: 'request_progress',
      title: `${by} accepted your ${kindNoun(kind, after)}`,
      message: `${what} · now waiting for the next approval`,
      entity_type: ENTITY[kind],
      entity_id: after.id,
    });
    await notifyStaff({
      userIds: reviewers,
      excludeUserIds: [actor?.id, staff.id],
      type: 'request_submitted',
      title: `${staff.full_name}’s ${kindNoun(kind, after)} is waiting for you`,
      message: `${what} · accepted by ${by}`,
      entity_type: ENTITY[kind],
      entity_id: after.id,
    });
  }
  emitToUsers([...everyone, staff.id, actor?.id], 'pms:requests', hrefParams(kind, after));
}

/** Fire and forget: a failed notification must never fail the request itself. */
function safely(fn) {
  return (...args) => {
    Promise.resolve()
      .then(() => fn(...args))
      .catch((err) => console.error('[request notifications]', err.message));
  };
}

module.exports = {
  requestCategory,
  describeRequest,
  notifyRequestSubmitted: safely(notifyRequestSubmitted),
  notifyRequestReviewed: safely(notifyRequestReviewed),
  _notifyRequestSubmitted: notifyRequestSubmitted,
  _notifyRequestReviewed: notifyRequestReviewed,
};
