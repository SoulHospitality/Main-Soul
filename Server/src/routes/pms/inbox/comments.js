const express = require('express');
const { q, tx, audit } = require('../../../lib/inbox/db');
const { badRequest, forbidden, int, notFound, wrap } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const { createLead } = require('../../../lib/inbox/leads');
const { replyToCommentPrivately, replyToCommentPublicly } = require('../../../lib/inbox/meta');
const { broadcast } = require('../../../lib/inbox/realtime');

const router = express.Router();

const isSimulated = (c) => String(c.author_external_id || '').startsWith('sim-');

async function load(id) {
  const c = await q.get('SELECT * FROM inbox_comments WHERE id = ?', id);
  if (!c) throw notFound('Comment not found');
  return c;
}

function ensureCanAct(c, user) {
  if (can(user, 'comments.manage') || !c.assigned_user_id || c.assigned_user_id === user.id) return;
  throw forbidden('This comment is assigned to another agent');
}

router.get('/comments', wrap(async (req, res) => {
  const { status = 'open', platform } = req.query;
  const where = [];
  const params = [];
  if (status === 'open') where.push("c.status = 'new'");
  else if (status !== 'all') { where.push('c.status = ?'); params.push(String(status)); }
  if (platform) { where.push('c.platform = ?'); params.push(String(platform)); }
  const items = await q.all(
    `SELECT c.*, ch.name AS channel_name, u.name AS assigned_name, l.stage_key
     FROM inbox_comments c JOIN inbox_channels ch ON ch.id = c.channel_id
     LEFT JOIN inbox_users u ON u.id = c.assigned_user_id
     LEFT JOIN inbox_leads l ON l.id = c.lead_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE WHEN c.status = 'new' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 300`,
    ...params,
  );
  const counts = await q.get(
    `SELECT COUNT(*) FILTER (WHERE status = 'new') AS open,
            COUNT(*) FILTER (WHERE status = 'replied') AS replied,
            COUNT(*) FILTER (WHERE status = 'handled') AS handled
     FROM inbox_comments`,
  );
  res.json({ items, counts, now: Date.now() });
}));

router.post('/comments/:id/reply', wrap(async (req, res) => {
  const c = await load(int(req.params.id));
  ensureCanAct(c, req.inbox);
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!text) throw badRequest('Reply is empty');
  if (!isSimulated(c)) {
    const channel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', c.channel_id);
    await replyToCommentPublicly(channel, c.platform, c.external_id, text);
  }
  const now = Date.now();
  await q.run(
    `UPDATE inbox_comments SET public_reply = ?, public_reply_at = ?, public_reply_by = ?, status = 'replied',
       assigned_user_id = COALESCE(assigned_user_id, ?) WHERE id = ?`,
    text, now, req.inbox.id, req.inbox.id, c.id,
  );
  await audit({ userId: req.inbox.id, type: 'comment_replied', data: { comment_id: c.id, public: true } });
  broadcast('comment', { id: c.id });
  res.json({ comment: await load(c.id) });
}));

router.post('/comments/:id/private', wrap(async (req, res) => {
  const c = await load(int(req.params.id));
  ensureCanAct(c, req.inbox);
  if (c.private_reply_at) throw badRequest('Meta allows only one private reply per comment');
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!text) throw badRequest('Message is empty');
  if (!isSimulated(c)) {
    const channel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', c.channel_id);
    await replyToCommentPrivately(channel, c.external_id, text);
  }
  const now = Date.now();
  await q.run(
    `UPDATE inbox_comments SET private_reply_at = ?, private_reply_by = ?,
       status = CASE WHEN status = 'new' THEN 'replied' ELSE status END,
       assigned_user_id = COALESCE(assigned_user_id, ?) WHERE id = ?`,
    now, req.inbox.id, req.inbox.id, c.id,
  );
  await audit({ userId: req.inbox.id, type: 'comment_replied', data: { comment_id: c.id, private: true } });
  broadcast('comment', { id: c.id });
  res.json({ comment: await load(c.id) });
}));

router.post('/comments/:id/assign', wrap(async (req, res) => {
  const c = await load(int(req.params.id));
  const to = req.body?.user_id ? int(req.body.user_id, 'user') : null;
  if (!can(req.inbox, 'comments.manage') && to !== req.inbox.id) throw forbidden();
  await q.run('UPDATE inbox_comments SET assigned_user_id = ? WHERE id = ?', to, c.id);
  await audit({ userId: req.inbox.id, type: 'comment_assigned', data: { comment_id: c.id, to } });
  broadcast('comment', { id: c.id });
  res.json({ comment: await load(c.id) });
}));

router.post('/comments/:id/handled', wrap(async (req, res) => {
  const c = await load(int(req.params.id));
  ensureCanAct(c, req.inbox);
  await q.run("UPDATE inbox_comments SET status = 'handled', handled_at = ?, handled_by = ? WHERE id = ?", Date.now(), req.inbox.id, c.id);
  await audit({ userId: req.inbox.id, type: 'comment_handled', data: { comment_id: c.id } });
  broadcast('comment', { id: c.id });
  res.json({ comment: await load(c.id) });
}));

/** Turn a commenter into a lead so the sales case is tracked even before they DM us. */
router.post('/comments/:id/lead', wrap(async (req, res) => {
  const c = await load(int(req.params.id));
  ensureCanAct(c, req.inbox);
  if (c.lead_id) throw badRequest('A lead already exists for this comment');
  const lead = await tx(async () => {
    let customerId = c.customer_id;
    if (!customerId) {
      const now = Date.now();
      customerId = (await q.insert(
        'INSERT INTO inbox_customers (name, notes, is_simulated, created_at, updated_at) VALUES (?,?,?,?,?)',
        c.author_name || 'Commenter', `From ${c.platform} comment: ${String(c.body || '').slice(0, 200)}`, isSimulated(c) ? 1 : 0, now, now,
      )).id;
    }
    const l = await createLead({
      customerId,
      userId: req.inbox.id,
      fields: { source: c.platform === 'instagram' ? 'instagram_comment' : 'facebook_comment', campaign: c.post_id, ...(req.body || {}) },
    });
    await q.run('UPDATE inbox_leads SET owner_user_id = COALESCE(owner_user_id, ?) WHERE id = ?', req.inbox.id, l.id);
    await q.run(
      'UPDATE inbox_comments SET customer_id = ?, lead_id = ?, assigned_user_id = COALESCE(assigned_user_id, ?) WHERE id = ?',
      customerId, l.id, req.inbox.id, c.id,
    );
    return l;
  });
  broadcast('comment', { id: c.id });
  res.json({ lead, comment: await load(c.id) });
}));

module.exports = router;
