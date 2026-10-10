const { q, tx, audit } = require('./db');
const { badRequest, forbidden, notFound, normalizePhone } = require('./http');
const { can } = require('./permissions');
const { broadcast } = require('./realtime');

const LEAD_FIELDS = ['source', 'campaign', 'project', 'unit_type', 'unit_id', 'check_in', 'check_out', 'guests', 'budget', 'temperature'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getLead(id) {
  const lead = await q.get('SELECT * FROM inbox_leads WHERE id = ?', id);
  if (!lead) throw notFound('Lead not found');
  return lead;
}

function cleanFields(input) {
  const out = {};
  for (const f of LEAD_FIELDS) {
    if (!(f in input)) continue;
    let v = input[f];
    if (v === '' || v === undefined) v = null;
    if (f === 'guests' && v !== null) {
      v = Number(v);
      if (!Number.isInteger(v) || v < 0 || v > 200) throw badRequest('Guests must be a whole number');
    }
    if ((f === 'check_in' || f === 'check_out') && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw badRequest('Dates must be YYYY-MM-DD');
    }
    if (f === 'temperature' && v !== null && !['hot', 'warm', 'cold'].includes(v)) throw badRequest('Invalid temperature');
    if (f === 'unit_id' && v !== null && !UUID.test(String(v))) throw badRequest('Invalid unit');
    out[f] = v === null ? null : f === 'guests' ? v : String(v).slice(0, 200);
  }
  if (out.check_in && out.check_out && out.check_out <= out.check_in) throw badRequest('Check-out must be after check-in');
  return out;
}

async function createLead({ conversationId = null, customerId, userId = null, fields = {} }) {
  const conv = conversationId ? await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId) : null;
  const now = Date.now();
  const data = cleanFields({ source: conv?.source, ...fields });
  const owner = conv?.assigned_user_id || userId;
  const lead = await tx(async () => {
    const { id } = await q.insert(
      `INSERT INTO inbox_leads (customer_id, conversation_id, stage_key, owner_user_id, source, campaign, project, unit_type, unit_id,
         check_in, check_out, guests, budget, temperature, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      customerId ?? conv.customer_id, conversationId, 'new', owner, data.source, data.campaign ?? conv?.ad_id ?? null,
      data.project, data.unit_type, data.unit_id, data.check_in, data.check_out, data.guests, data.budget, data.temperature,
      userId, now, now,
    );
    await q.run('INSERT INTO inbox_lead_stage_history (lead_id, from_stage, to_stage, user_id, at) VALUES (?,?,?,?,?)', id, null, 'new', userId, now);
    if (conversationId) {
      await q.run(
        "UPDATE inbox_conversations SET current_lead_id = ?, type = CASE WHEN type = 'unknown' THEN 'sales_lead' ELSE type END WHERE id = ?",
        id, conversationId,
      );
    }
    await audit({ conversationId, leadId: id, userId, type: 'lead_created', data, at: now });
    return getLead(id);
  });
  if (conversationId) broadcast('conversation', { id: conversationId });
  broadcast('lead', { id: lead.id });
  return lead;
}

async function updateLead(leadId, input, user) {
  const lead = await getLead(leadId);
  const data = cleanFields(input);
  const keys = Object.keys(data);
  if (!keys.length) return lead;
  const changes = {};
  for (const k of keys) if (String(lead[k] ?? '') !== String(data[k] ?? '')) changes[k] = { from: lead[k], to: data[k] };
  if (!Object.keys(changes).length) return lead;
  await tx(async () => {
    await q.run(
      `UPDATE inbox_leads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...keys.map((k) => data[k]), Date.now(), leadId,
    );
    await audit({ conversationId: lead.conversation_id, leadId, userId: user.id, type: 'lead_updated', data: changes });
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  broadcast('lead', { id: leadId });
  return getLead(leadId);
}

async function createFollowUp({ leadId = null, conversationId = null, dueAt, note = null, assignedUserId, userId }) {
  const due = Number(dueAt);
  if (!Number.isFinite(due)) throw badRequest('Follow-up date is required');
  if (due < Date.now() - 60000) throw badRequest('Follow-up must be in the future');
  const { id } = await q.insert(
    `INSERT INTO inbox_follow_ups (lead_id, conversation_id, assigned_user_id, due_at, note, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    leadId, conversationId, assignedUserId, due, note ? String(note).slice(0, 500) : null, userId, Date.now(),
  );
  await audit({ conversationId, leadId, userId, type: 'follow_up_created', data: { id, due_at: due, note } });
  return q.get('SELECT * FROM inbox_follow_ups WHERE id = ?', id);
}

async function completeFollowUp(id, user, status = 'done') {
  const f = await q.get('SELECT * FROM inbox_follow_ups WHERE id = ?', id);
  if (!f) throw notFound('Follow-up not found');
  if (f.status !== 'open') return f;
  if (f.assigned_user_id !== user.id && !can(user, 'conv.view_all')) throw forbidden();
  await q.run('UPDATE inbox_follow_ups SET status = ?, done_at = ?, done_by = ? WHERE id = ?', status, Date.now(), user.id, id);
  await audit({ conversationId: f.conversation_id, leadId: f.lead_id, userId: user.id, type: `follow_up_${status}`, data: { id } });
  return q.get('SELECT * FROM inbox_follow_ups WHERE id = ?', id);
}

/**
 * Move a lead through the pipeline, enforcing the operational rules:
 *  - stages flagged requires_phone need a customer phone number (Meta's 24h window makes it essential);
 *  - stages flagged requires_follow_up need a scheduled next action;
 *  - Lost needs a reason; reopening a closed lead needs manager rights.
 */
async function changeStage(leadId, toKey, opts, user) {
  const lead = await getLead(leadId);
  const to = await q.get('SELECT * FROM inbox_lead_stages WHERE key = ? AND active = 1', toKey);
  if (!to) throw badRequest('Unknown stage');
  if (lead.stage_key === toKey && !(to.kind === 'won' && opts.reservation_id)) return lead;
  const from = await q.get('SELECT * FROM inbox_lead_stages WHERE key = ?', lead.stage_key);
  const customer = await q.get('SELECT * FROM inbox_customers WHERE id = ?', lead.customer_id);

  // A real PMS reservation is enough evidence to move a closed lead to won.
  if (from.kind !== 'open' && from.key !== toKey && !opts.reservation_id && !can(user, 'leads.reopen')) {
    throw forbidden('Only a manager can reopen a closed lead');
  }
  if (to.requires_phone && !customer.phone) {
    throw badRequest('Add the customer phone number before moving to this stage', 'phone_required');
  }
  if (to.kind === 'lost') {
    const reason = await q.get('SELECT key FROM inbox_lost_reasons WHERE key = ? AND active = 1', opts.lost_reason_key || '');
    if (!reason) throw badRequest('Choose a lost reason', 'lost_reason_required');
  }
  const hasFutureFollowUp = await q.get(
    "SELECT 1 AS x FROM inbox_follow_ups WHERE lead_id = ? AND status = 'open' AND due_at > ?", leadId, Date.now(),
  );
  if (to.requires_follow_up && !opts.follow_up_at && !hasFutureFollowUp) {
    throw badRequest('Schedule a follow-up for this stage', 'follow_up_required');
  }
  let bookingValue = null;
  if (to.kind === 'won' && opts.booking_value !== undefined && opts.booking_value !== '' && opts.booking_value !== null) {
    bookingValue = Number(opts.booking_value);
    if (!Number.isFinite(bookingValue) || bookingValue < 0) throw badRequest('Invalid booking value');
  }

  const now = Date.now();
  await tx(async () => {
    const reachedQualified = to.is_qualified || to.kind === 'won';
    await q.run(
      `UPDATE inbox_leads SET stage_key = ?, updated_at = ?,
         qualified_at = CASE WHEN qualified_at IS NULL AND ?::int = 1 THEN ?::bigint ELSE qualified_at END,
         won_at = CASE WHEN ?::int = 1 THEN ?::bigint ELSE won_at END,
         closed_at = CASE WHEN ?::int = 1 THEN ?::bigint ELSE NULL END,
         lost_reason_key = CASE WHEN ?::int = 1 THEN ?::text ELSE lost_reason_key END,
         lost_note = CASE WHEN ?::int = 1 THEN ?::text ELSE lost_note END,
         booking_ref = CASE WHEN ?::int = 1 THEN ?::text ELSE booking_ref END,
         booking_value = CASE WHEN ?::int = 1 THEN ?::numeric ELSE booking_value END,
         reservation_id = CASE WHEN ?::int = 1 THEN ?::int ELSE reservation_id END
       WHERE id = ?`,
      toKey, now,
      reachedQualified ? 1 : 0, now,
      to.kind === 'won', now,
      to.kind !== 'open', now,
      to.kind === 'lost', opts.lost_reason_key || null,
      to.kind === 'lost', opts.lost_note ? String(opts.lost_note).slice(0, 500) : null,
      to.kind === 'won', opts.booking_ref ? String(opts.booking_ref).slice(0, 100) : null,
      to.kind === 'won', bookingValue,
      Boolean(to.kind === 'won' && opts.reservation_id), opts.reservation_id || null,
      leadId,
    );
    if (lead.stage_key !== toKey) {
      await q.run('INSERT INTO inbox_lead_stage_history (lead_id, from_stage, to_stage, user_id, at) VALUES (?,?,?,?,?)', leadId, lead.stage_key, toKey, user.id, now);
    }
    await audit({
      conversationId: lead.conversation_id, leadId, userId: user.id, type: 'stage_changed',
      data: {
        from: lead.stage_key, to: toKey, lost_reason: opts.lost_reason_key || undefined,
        booking_value: bookingValue ?? undefined, reservation_id: opts.reservation_id || undefined,
      },
      at: now,
    });
    if (opts.follow_up_at) {
      await createFollowUp({
        leadId, conversationId: lead.conversation_id, dueAt: opts.follow_up_at, note: opts.follow_up_note,
        assignedUserId: lead.owner_user_id || user.id, userId: user.id,
      });
    }
    if (to.kind !== 'open') {
      await q.run("UPDATE inbox_follow_ups SET status = 'cancelled', done_at = ?, done_by = ? WHERE lead_id = ? AND status = 'open'", now, user.id, leadId);
    }
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  broadcast('lead', { id: leadId });
  return getLead(leadId);
}

/** A PMS reservation made for this lead closes it as won with the real booking value. */
async function linkReservation(leadId, reservationId, user) {
  const { getReservation } = require('./pmsLink');
  const lead = await getLead(leadId);
  const r = await getReservation(reservationId);
  if (!r) throw badRequest('Reservation not found');
  if (r.status === 'cancelled') throw badRequest('This reservation is cancelled');
  const taken = await q.get('SELECT id FROM inbox_leads WHERE reservation_id = ? AND id <> ?', r.id, leadId);
  if (taken) throw badRequest(`Reservation #${r.id} is already linked to lead #${taken.id}`);
  const won = await q.get("SELECT key FROM inbox_lead_stages WHERE kind = 'won' AND active = 1 ORDER BY position LIMIT 1");
  if (!won) throw badRequest('No active "won" stage is configured');

  const customer = await q.get('SELECT * FROM inbox_customers WHERE id = ?', lead.customer_id);
  const phone = normalizePhone(r.guest_phone);
  if (!customer.phone && phone) {
    await q.run('UPDATE inbox_customers SET phone = ?, updated_at = ? WHERE id = ?', phone, Date.now(), customer.id);
  }
  await q.run(
    `UPDATE inbox_leads SET unit_id = COALESCE(unit_id, ?), project = COALESCE(project, ?),
       check_in = COALESCE(check_in, ?), check_out = COALESCE(check_out, ?), updated_at = ? WHERE id = ?`,
    r.unit_id, r.compound, r.check_in, r.check_out, Date.now(), leadId,
  );
  return changeStage(leadId, won.key, {
    booking_ref: `R-${r.id}`,
    booking_value: Number(r.total_amount) || 0,
    reservation_id: r.id,
  }, user);
}

module.exports = {
  LEAD_FIELDS, getLead, cleanFields, createLead, updateLead, createFollowUp, completeFollowUp, changeStage, linkReservation,
};
