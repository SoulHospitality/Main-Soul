const express = require('express');
const { q } = require('../../../lib/inbox/db');
const { badRequest, wrap } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const { getSettings } = require('../../../lib/inbox/settings');
const { localHour, localDay } = require('../../../lib/inbox/hours');

const router = express.Router();

function stats(values) {
  if (!values.length) return { count: 0, avg: null, median: null, p90: null, min: null, max: null };
  const s = [...values].sort((a, b) => a - b);
  const pick = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return {
    count: s.length,
    avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    median: pick(0.5),
    p90: pick(0.9),
    min: s[0],
    max: s[s.length - 1],
  };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * KPI definitions (all for the selected period unless marked "now"):
 *  - Response time: business-hours seconds from the first unanswered customer message to the human reply.
 *  - SLA compliance: replies within the SLA target / all replies.
 *  - Lead conversion: leads created in the period that are Won / leads created in the period (cohort).
 *  - Qualified conversion (official KPI): Won / leads that reached a "qualified" stage.
 */
router.get('/analytics', wrap(async (req, res) => {
  const now = Date.now();
  const to = Number(req.query.to) || now;
  const from = Number(req.query.from) || to - 7 * 86400000;
  if (from >= to || to - from > 400 * 86400000) throw badRequest('Invalid period');
  const team = can(req.inbox, 'analytics.team');
  const only = team ? (req.query.user ? Number(req.query.user) || null : null) : req.inbox.id;
  const s = getSettings();
  const byOnly = (sql) => (only ? sql : '');
  const onlyP = only ? [only] : [];

  const users = await q.all('SELECT id, name, role, presence, active, in_rotation FROM inbox_users WHERE role IS NOT NULL ORDER BY name');
  const stages = await q.all('SELECT * FROM inbox_lead_stages ORDER BY position');
  const stageByKey = Object.fromEntries(stages.map((st) => [st.key, st]));

  const responses = await q.all(
    `SELECT * FROM inbox_responses WHERE responded_at >= ? AND responded_at < ?
     ${byOnly('AND (user_id = ? OR (user_id IS NULL AND assigned_user_id = ?))')}`,
    from, to, ...(only ? [only, only] : []),
  );
  const conversations = await q.all(
    `SELECT id, channel_kind, source, created_at, assigned_user_id FROM inbox_conversations WHERE created_at >= ? AND created_at < ?
     ${byOnly('AND id IN (SELECT conversation_id FROM inbox_assignments WHERE to_user_id = ?)')}`,
    from, to, ...onlyP,
  );
  const leads = await q.all(
    `SELECT l.*, c.channel_kind FROM inbox_leads l LEFT JOIN inbox_conversations c ON c.id = l.conversation_id
     WHERE l.created_at >= ? AND l.created_at < ? ${byOnly('AND l.owner_user_id = ?')}`,
    from, to, ...onlyP,
  );
  const wonInPeriod = await q.all(
    `SELECT l.*, c.channel_kind FROM inbox_leads l LEFT JOIN inbox_conversations c ON c.id = l.conversation_id
     JOIN inbox_lead_stages s ON s.key = l.stage_key
     WHERE s.kind = 'won' AND l.won_at >= ? AND l.won_at < ? ${byOnly('AND l.owner_user_id = ?')}`,
    from, to, ...onlyP,
  );
  const lostInPeriod = await q.all(
    `SELECT l.lost_reason_key, l.owner_user_id FROM inbox_leads l JOIN inbox_lead_stages s ON s.key = l.stage_key
     WHERE s.kind = 'lost' AND l.closed_at >= ? AND l.closed_at < ? ${byOnly('AND l.owner_user_id = ?')}`,
    from, to, ...onlyP,
  );
  const breaches = await q.all(
    `SELECT * FROM inbox_sla_events WHERE kind = 'breach' AND at >= ? AND at < ? ${byOnly('AND user_id = ?')}`,
    from, to, ...onlyP,
  );
  const assignments = await q.all('SELECT * FROM inbox_assignments WHERE at >= ? AND at < ?', from, to);
  const sent = await q.all(
    `SELECT user_id, COUNT(*) AS n FROM inbox_messages
     WHERE direction = 'out' AND sender_type = 'agent' AND created_at >= ? AND created_at < ? GROUP BY user_id`,
    from, to,
  );
  const inbound = await q.all(
    `SELECT m.created_at FROM inbox_messages m ${only ? 'JOIN inbox_conversations c ON c.id = m.conversation_id' : ''}
     WHERE m.direction = 'in' AND m.created_at >= ? AND m.created_at < ? ${byOnly('AND c.assigned_user_id = ?')}`,
    from, to, ...onlyP,
  );
  const followUpsDone = await q.all(
    "SELECT assigned_user_id, done_at, due_at FROM inbox_follow_ups WHERE status = 'done' AND done_at >= ? AND done_at < ?",
    from, to,
  );

  // ---- now (live operational snapshot)
  const live = await q.get(
    `SELECT
       COUNT(*) FILTER (WHERE status <> 'closed') AS open,
       COUNT(*) FILTER (WHERE status = 'needs_reply') AS needs_reply,
       COUNT(*) FILTER (WHERE status = 'needs_reply' AND sla_due_at IS NOT NULL AND sla_due_at <= ?) AS overdue,
       COUNT(*) FILTER (WHERE status = 'needs_reply' AND sla_due_at IS NOT NULL AND sla_due_at > ? AND sla_due_at - ? <= ?) AS at_risk,
       COUNT(*) FILTER (WHERE status = 'needs_reply' AND assigned_user_id IS NULL) AS unassigned,
       COUNT(*) FILTER (WHERE status = 'waiting_customer') AS waiting_customer,
       COUNT(*) FILTER (WHERE status <> 'closed' AND type = 'unknown') AS unclassified
     FROM inbox_conversations WHERE 1 = 1 ${byOnly('AND assigned_user_id = ?')}`,
    now, now, now, (s.sla_target_min - s.sla_warning_min) * 60000, ...onlyP,
  );
  const liveFollowUps = await q.get(
    `SELECT COUNT(*) FILTER (WHERE due_at <= ?) AS due, COUNT(*) FILTER (WHERE due_at <= ?) AS overdue
     FROM inbox_follow_ups WHERE status = 'open' ${byOnly('AND assigned_user_id = ?')}`,
    now, now - s.follow_up_escalate_min * 60000, ...onlyP,
  );
  const openComments = await q.get(
    "SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE created_at <= ?) AS overdue FROM inbox_comments WHERE status = 'new'",
    now - s.comment_sla_min * 60000,
  );

  // ---- overview
  const rt = stats(responses.map((r) => r.seconds_sla));
  const first = stats(responses.filter((r) => r.is_first).map((r) => r.seconds_sla));
  const withinSla = responses.filter((r) => r.within_sla).length;
  const isWon = (l) => stageByKey[l.stage_key]?.kind === 'won';
  const qualified = leads.filter((l) => l.qualified_at || isWon(l));
  const cohortWon = leads.filter(isWon);
  const overview = {
    conversations: conversations.length,
    inbound_messages: inbound.length,
    replies: responses.length,
    response: rt,
    first_response: first,
    sla_compliance: pct(withinSla, responses.length),
    sla_breaches: breaches.length,
    leads: leads.length,
    qualified: qualified.length,
    won_cohort: cohortWon.length,
    lost_cohort: leads.filter((l) => stageByKey[l.stage_key]?.kind === 'lost').length,
    conversion_lead: pct(cohortWon.length, leads.length),
    conversion_qualified: pct(cohortWon.length, qualified.length),
    conversion_conversation: pct(cohortWon.filter((l) => l.conversation_id).length, conversations.length),
    bookings: wonInPeriod.length,
    bookings_linked: wonInPeriod.filter((l) => l.reservation_id).length,
    booking_value: wonInPeriod.reduce((a, l) => a + (Number(l.booking_value) || 0), 0),
    sla_target_min: s.sla_target_min,
  };

  // ---- per agent
  const waitingByUser = new Map(
    (await q.all(
      `SELECT assigned_user_id AS id, COUNT(*) AS n, COUNT(*) FILTER (WHERE sla_due_at <= ?) AS overdue
       FROM inbox_conversations WHERE status = 'needs_reply' AND assigned_user_id IS NOT NULL GROUP BY assigned_user_id`,
      now,
    )).map((r) => [r.id, r]),
  );
  const agents = (only ? users.filter((u) => u.id === only) : users.filter((u) => u.active)).map((u) => {
    const mine = responses.filter((r) => r.user_id === u.id);
    const myLeads = leads.filter((l) => l.owner_user_id === u.id);
    const myQualified = myLeads.filter((l) => l.qualified_at || isWon(l));
    const myWon = myLeads.filter(isWon);
    const myWonPeriod = wonInPeriod.filter((l) => l.owner_user_id === u.id);
    const waiting = waitingByUser.get(u.id) || { n: 0, overdue: 0 };
    const myStats = stats(mine.map((r) => r.seconds_sla));
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      presence: u.presence,
      chats_assigned: new Set(assignments.filter((a) => a.to_user_id === u.id).map((a) => a.conversation_id)).size,
      messages_sent: sent.find((x) => x.user_id === u.id)?.n || 0,
      replies: mine.length,
      avg_response: myStats.avg,
      median_response: myStats.median,
      sla_compliance: pct(mine.filter((r) => r.within_sla).length, mine.length),
      breaches: breaches.filter((b) => b.user_id === u.id).length,
      moved_away: assignments.filter((a) => a.from_user_id === u.id && a.reason === 'sla_breach').length,
      leads: myLeads.length,
      qualified: myQualified.length,
      won: myWon.length,
      lost: lostInPeriod.filter((l) => l.owner_user_id === u.id).length,
      conversion: pct(myWon.length, myQualified.length),
      bookings: myWonPeriod.length,
      booking_value: myWonPeriod.reduce((a, l) => a + (Number(l.booking_value) || 0), 0),
      follow_ups_done: followUpsDone.filter((f) => f.assigned_user_id === u.id).length,
      waiting_now: waiting.n || 0,
      overdue_now: waiting.overdue || 0,
    };
  }).filter((a) => only || a.role !== 'admin' || a.replies || a.leads);

  // ---- per channel
  const channels = ['messenger', 'instagram', 'whatsapp'].map((kind) => {
    const r = responses.filter((x) => x.channel_kind === kind);
    const l = leads.filter((x) => x.channel_kind === kind);
    const w = l.filter(isWon);
    return {
      kind,
      conversations: conversations.filter((c) => c.channel_kind === kind).length,
      leads: l.length,
      won: w.length,
      conversion: pct(w.length, l.length),
      avg_response: stats(r.map((x) => x.seconds_sla)).avg,
      sla_compliance: pct(r.filter((x) => x.within_sla).length, r.length),
      booking_value: wonInPeriod.filter((x) => x.channel_kind === kind).reduce((a, x) => a + (Number(x.booking_value) || 0), 0),
    };
  });

  // ---- funnel: a lead "reached" every open stage up to the furthest one it touched
  const history = leads.length
    ? await q.all('SELECT lead_id, to_stage FROM inbox_lead_stage_history WHERE lead_id = ANY(?::int[])', leads.map((l) => l.id))
    : [];
  const openStages = stages.filter((st) => st.kind === 'open' && st.active);
  const wonStage = stages.find((st) => st.kind === 'won' && st.active);
  const furthest = new Map();
  for (const l of leads) furthest.set(l.id, 0);
  for (const h of history) {
    const st = stageByKey[h.to_stage];
    if (!st) continue;
    const rank = st.kind === 'won' ? Infinity : st.kind === 'open' ? st.position : 0;
    if (rank > furthest.get(h.lead_id)) furthest.set(h.lead_id, rank);
  }
  const funnel = openStages.map((st) => ({
    key: st.key, name_en: st.name_en, name_ar: st.name_ar,
    count: [...furthest.values()].filter((r) => r >= st.position).length,
  }));
  if (wonStage) {
    funnel.push({
      key: wonStage.key, name_en: wonStage.name_en, name_ar: wonStage.name_ar,
      count: [...furthest.values()].filter((r) => r === Infinity).length,
    });
  }

  // ---- breakdowns
  const lostReasons = (await q.all('SELECT * FROM inbox_lost_reasons ORDER BY position')).map((r) => ({
    key: r.key, name_en: r.name_en, name_ar: r.name_ar, count: lostInPeriod.filter((l) => l.lost_reason_key === r.key).length,
  })).filter((r) => r.count);

  const group = (list, key) => {
    const m = new Map();
    for (const l of list) {
      const k = l[key] || 'unknown';
      const e = m.get(k) || { key: k, leads: 0, won: 0, booking_value: 0 };
      e.leads += 1;
      if (isWon(l)) { e.won += 1; e.booking_value += Number(l.booking_value) || 0; }
      m.set(k, e);
    }
    return [...m.values()].map((e) => ({ ...e, conversion: pct(e.won, e.leads) })).sort((a, b) => b.leads - a.leads);
  };

  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, messages: 0 }));
  for (const m of inbound) hourly[localHour(m.created_at)].messages += 1;

  const days = new Map();
  for (let t = from; t < to; t += 86400000) days.set(localDay(t), { day: localDay(t), conversations: 0, leads: 0, bookings: 0 });
  const bump = (ts, field) => { const d = days.get(localDay(ts)); if (d) d[field] += 1; };
  for (const c of conversations) bump(c.created_at, 'conversations');
  for (const l of leads) bump(l.created_at, 'leads');
  for (const l of wonInPeriod) bump(l.won_at, 'bookings');

  const buckets = [
    { label: '< 5m', max: 300 }, { label: '5-15m', max: 900 }, { label: '15-30m', max: 1800 },
    { label: '30-60m', max: 3600 }, { label: '1-4h', max: 14400 }, { label: '> 4h', max: Infinity },
  ].map((b, i, arr) => ({
    label: b.label,
    count: responses.filter((r) => r.seconds_sla < b.max && (i === 0 || r.seconds_sla >= arr[i - 1].max)).length,
  }));

  res.json({
    period: { from, to },
    scope: only ? 'user' : 'team',
    live: {
      ...live,
      follow_ups_due: liveFollowUps?.due || 0,
      follow_ups_overdue: liveFollowUps?.overdue || 0,
      comments_open: openComments?.n || 0,
      comments_overdue: openComments?.overdue || 0,
    },
    overview,
    agents,
    channels,
    funnel,
    lostReasons,
    bySource: group(leads, 'source'),
    byProject: group(leads, 'project'),
    hourly,
    daily: [...days.values()],
    responseBuckets: buckets,
  });
}));

module.exports = router;
