const express = require('express');
const { q, audit } = require('../../../lib/inbox/db');
const { badRequest, forbidden, int, wrap } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const {
  changeStage, completeFollowUp, createFollowUp, getLead, updateLead, linkReservation,
} = require('../../../lib/inbox/leads');
const { broadcast } = require('../../../lib/inbox/realtime');
const { availableUnits } = require('../../../lib/inbox/pmsLink');
const { businessSeconds } = require('../../../lib/inbox/hours');

const router = express.Router();

/** Staff see the leads they own and the leads of chats they are on; managers see every lead. */
const MINE_SQL = `(l.owner_user_id = ? OR EXISTS (
  SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = l.conversation_id AND a.user_id = ?
) OR EXISTS (SELECT 1 FROM inbox_conversations cc WHERE cc.id = l.conversation_id AND cc.assigned_user_id = ?))`;

async function canTouchLead(user, lead) {
  if (can(user, 'conv.view_all') || lead.owner_user_id === user.id) return true;
  if (!lead.conversation_id) return false;
  return Boolean(await q.get(
    `SELECT 1 AS x FROM inbox_conversations c WHERE c.id = ? AND (c.assigned_user_id = ? OR EXISTS (
       SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id AND a.user_id = ?))`,
    lead.conversation_id, user.id, user.id,
  ));
}

router.get('/leads', wrap(async (req, res) => {
  const { stage, owner, project, source, search, from, to } = req.query;
  const where = ['1 = 1'];
  const params = [];
  const all = can(req.inbox, 'conv.view_all');
  if (!all) { where.push(MINE_SQL); params.push(req.inbox.id, req.inbox.id, req.inbox.id); }
  if (stage === 'open') where.push("s.kind = 'open'");
  else if (stage) { where.push('l.stage_key = ?'); params.push(String(stage)); }
  if (owner && all) { where.push('l.owner_user_id = ?'); params.push(Number(owner) || 0); }
  if (project) { where.push('l.project = ?'); params.push(String(project)); }
  if (source) { where.push('l.source = ?'); params.push(String(source)); }
  if (from) { where.push('l.created_at >= ?'); params.push(Number(from) || 0); }
  if (to) { where.push('l.created_at < ?'); params.push(Number(to) || 0); }
  if (search) {
    const like = `%${String(search).trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`;
    where.push('(cu.name ILIKE ? OR cu.phone LIKE ? OR l.booking_ref ILIKE ?)');
    params.push(like, like, like);
  }
  const items = await q.all(
    `SELECT l.*, s.kind AS stage_kind, s.name_en AS stage_name, cu.name AS customer_name, cu.phone, cu.email,
       u.name AS owner_name, c.channel_kind, c.status AS chat_status, c.type AS chat_type,
       lr.name_en AS lost_reason, mk.name AS created_by_name,
       (SELECT MIN(f.due_at) FROM inbox_follow_ups f WHERE f.lead_id = l.id AND f.status = 'open') AS next_follow_up,
       (SELECT COUNT(*) FROM inbox_messages m WHERE m.conversation_id = l.conversation_id AND m.direction = 'in') AS guest_messages,
       (SELECT COUNT(*) FROM inbox_messages m WHERE m.conversation_id = l.conversation_id AND m.direction = 'out' AND m.sender_type = 'agent') AS agent_messages,
       (SELECT MIN(m.created_at) FROM inbox_messages m WHERE m.conversation_id = l.conversation_id AND m.direction = 'in') AS first_message_at,
       (SELECT MAX(m.created_at) FROM inbox_messages m WHERE m.conversation_id = l.conversation_id AND m.direction = 'in') AS last_guest_message_at
     FROM inbox_leads l
     LEFT JOIN inbox_lost_reasons lr ON lr.key = l.lost_reason_key
     LEFT JOIN inbox_users mk ON mk.id = l.created_by
     JOIN inbox_lead_stages s ON s.key = l.stage_key
     JOIN inbox_customers cu ON cu.id = l.customer_id
     LEFT JOIN inbox_users u ON u.id = l.owner_user_id
     LEFT JOIN inbox_conversations c ON c.id = l.conversation_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.updated_at DESC LIMIT ${req.query.export ? 5000 : 500}`,
    ...params,
  );
  // Response time per lead: working-hours time from each guest message to the reply, averaged.
  const convIds = [...new Set(items.map((l) => l.conversation_id).filter(Boolean))];
  const replies = convIds.length
    ? await q.all(
      'SELECT conversation_id, awaiting_since, responded_at, is_first FROM inbox_responses WHERE conversation_id = ANY(?::int[])',
      convIds,
    )
    : [];
  const byConv = new Map();
  for (const r of replies) {
    const seconds = businessSeconds(Number(r.awaiting_since), Number(r.responded_at));
    const e = byConv.get(r.conversation_id) || { total: 0, count: 0, first: null };
    e.total += seconds;
    e.count += 1;
    if (r.is_first && e.first == null) e.first = seconds;
    byConv.set(r.conversation_id, e);
  }
  for (const l of items) {
    const e = byConv.get(l.conversation_id);
    l.avg_response_seconds = e?.count ? Math.round(e.total / e.count) : null;
    l.first_response_seconds = e?.first ?? null;
    l.replies_count = e?.count || 0;
  }
  const withTimes = items.filter((l) => l.avg_response_seconds != null);
  res.json({
    items,
    can_see_all: all,
    summary: {
      avg_response_seconds: withTimes.length
        ? Math.round(withTimes.reduce((a, l) => a + l.avg_response_seconds, 0) / withTimes.length)
        : null,
    },
  });
}));

router.patch('/leads/:id', wrap(async (req, res) => {
  const lead = await getLead(int(req.params.id));
  if (!(await canTouchLead(req.inbox, lead))) throw forbidden();
  res.json({ lead: await updateLead(lead.id, req.body || {}, req.inbox) });
}));

router.post('/leads/:id/stage', wrap(async (req, res) => {
  const lead = await getLead(int(req.params.id));
  if (!(await canTouchLead(req.inbox, lead))) throw forbidden();
  const { stage, ...opts } = req.body || {};
  delete opts.reservation_id; // only set through /reservation
  res.json({ lead: await changeStage(lead.id, String(stage || ''), opts, req.inbox) });
}));

/** Close the lead as won from a PMS reservation (value and reference come from the reservation). */
router.post('/leads/:id/reservation', wrap(async (req, res) => {
  const lead = await getLead(int(req.params.id));
  if (!(await canTouchLead(req.inbox, lead))) throw forbidden();
  const reservationId = int(req.body?.reservation_id, 'reservation');
  res.json({ lead: await linkReservation(lead.id, reservationId, req.inbox) });
}));

router.post('/leads/:id/owner', wrap(async (req, res) => {
  if (!can(req.inbox, 'conv.assign')) throw forbidden('Only supervisors can change the lead owner');
  const lead = await getLead(int(req.params.id));
  const to = int(req.body?.user_id, 'user');
  if (!(await q.get('SELECT 1 AS x FROM inbox_users WHERE id = ? AND active = 1 AND role IS NOT NULL', to))) {
    throw badRequest('User not found');
  }
  await q.run('UPDATE inbox_leads SET owner_user_id = ?, updated_at = ? WHERE id = ?', to, Date.now(), lead.id);
  await q.run("UPDATE inbox_follow_ups SET assigned_user_id = ? WHERE lead_id = ? AND status = 'open'", to, lead.id);
  await audit({
    conversationId: lead.conversation_id, leadId: lead.id, userId: req.inbox.id, type: 'lead_owner_changed',
    data: { from: lead.owner_user_id, to },
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  broadcast('lead', { id: lead.id });
  res.json({ lead: await getLead(lead.id) });
}));

/** Free units for the lead's dates with the prices on file (or ad-hoc dates from the query string). */
/** Destinations (areas) and their projects (compounds) with published units, for the stay search. */
router.get('/availability/places', wrap(async (_req, res) => {
  const rows = await q.all(
    `SELECT COALESCE(NULLIF(trim(area), ''), 'Other') AS destination, NULLIF(trim(compound), '') AS project, COUNT(*)::int AS units
     FROM units WHERE status = 'published' AND COALESCE(listing_type, 'rent') <> 'long_term'
     GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.destination)) map.set(r.destination, { destination: r.destination, projects: [] });
    if (r.project) map.get(r.destination).projects.push(r.project);
  }
  res.json({ items: [...map.values()] });
}));

router.get('/availability', wrap(async (req, res) => {
  const { check_in: checkIn, check_out: checkOut, project, destination, guests, bedrooms } = req.query;
  const items = await availableUnits({ checkIn, checkOut, project, destination, guests, bedrooms, limit: 80 });
  if (!items) throw badRequest('Choose valid check-in and check-out dates');
  res.json({ items });
}));

router.get('/follow-ups', wrap(async (req, res) => {
  const mine = req.query.scope !== 'team' || !can(req.inbox, 'conv.view_all');
  const items = await q.all(
    `SELECT f.*, cu.name AS customer_name, u.name AS assigned_name, l.stage_key, l.project
     FROM inbox_follow_ups f
     LEFT JOIN inbox_leads l ON l.id = f.lead_id
     LEFT JOIN inbox_customers cu ON cu.id = l.customer_id
     LEFT JOIN inbox_users u ON u.id = f.assigned_user_id
     WHERE f.status = 'open' ${mine ? 'AND f.assigned_user_id = ?' : ''}
     ORDER BY f.due_at LIMIT 500`,
    ...(mine ? [req.inbox.id] : []),
  );
  res.json({ items, now: Date.now() });
}));

router.post('/follow-ups', wrap(async (req, res) => {
  const { lead_id: leadId, due_at: dueAt, note } = req.body || {};
  const lead = await getLead(int(leadId, 'lead'));
  if (!(await canTouchLead(req.inbox, lead))) throw forbidden();
  const f = await createFollowUp({
    leadId: lead.id, conversationId: lead.conversation_id, dueAt, note,
    assignedUserId: lead.owner_user_id || req.inbox.id, userId: req.inbox.id,
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  broadcast('follow_up', { id: f.id });
  res.json({ followUp: f });
}));

router.post('/follow-ups/:id/done', wrap(async (req, res) => {
  const f = await completeFollowUp(int(req.params.id), req.inbox, req.body?.cancel ? 'cancelled' : 'done');
  if (f.conversation_id) broadcast('conversation', { id: f.conversation_id });
  broadcast('follow_up', { id: f.id });
  res.json({ followUp: f });
}));

module.exports = router;
