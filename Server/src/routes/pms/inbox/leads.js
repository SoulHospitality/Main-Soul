const express = require('express');
const { q, audit } = require('../../../lib/inbox/db');
const { badRequest, forbidden, int, wrap } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const {
  changeStage, completeFollowUp, createFollowUp, getLead, updateLead, linkReservation,
} = require('../../../lib/inbox/leads');
const { broadcast } = require('../../../lib/inbox/realtime');
const { availableUnits } = require('../../../lib/inbox/pmsLink');

const router = express.Router();

async function canTouchLead(user, lead) {
  if (can(user, 'conv.view_all') || lead.owner_user_id === user.id) return true;
  if (!lead.conversation_id) return false;
  return Boolean(await q.get(
    'SELECT 1 AS x FROM inbox_conversations WHERE id = ? AND assigned_user_id = ?', lead.conversation_id, user.id,
  ));
}

router.get('/leads', wrap(async (req, res) => {
  const { stage, owner, project, source, search, from, to } = req.query;
  const where = ['1 = 1'];
  const params = [];
  if (!can(req.inbox, 'conv.view_all')) { where.push('l.owner_user_id = ?'); params.push(req.inbox.id); }
  if (stage === 'open') where.push("s.kind = 'open'");
  else if (stage) { where.push('l.stage_key = ?'); params.push(String(stage)); }
  if (owner) { where.push('l.owner_user_id = ?'); params.push(Number(owner) || 0); }
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
    `SELECT l.*, s.kind AS stage_kind, cu.name AS customer_name, cu.phone, u.name AS owner_name, c.channel_kind,
       (SELECT MIN(f.due_at) FROM inbox_follow_ups f WHERE f.lead_id = l.id AND f.status = 'open') AS next_follow_up
     FROM inbox_leads l
     JOIN inbox_lead_stages s ON s.key = l.stage_key
     JOIN inbox_customers cu ON cu.id = l.customer_id
     LEFT JOIN inbox_users u ON u.id = l.owner_user_id
     LEFT JOIN inbox_conversations c ON c.id = l.conversation_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.updated_at DESC LIMIT 500`,
    ...params,
  );
  res.json({ items });
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
router.get('/availability', wrap(async (req, res) => {
  const { check_in: checkIn, check_out: checkOut, project, guests, bedrooms } = req.query;
  const items = await availableUnits({ checkIn, checkOut, project, guests, bedrooms, limit: 80 });
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
