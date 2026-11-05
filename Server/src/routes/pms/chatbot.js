/**
 * Guest chatbot test page (CEO only while it's being tested). Each test chat pretends to come from
 * Instagram or Messenger; hand-offs land in the Live Inbox as simulated conversations.
 */
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { createSession, receive, sessionView, activeProvider } = require('../../lib/chatbot/assistant');

const router = express.Router();
const TEST_ROLES = ['admin'];

function wrap(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

router.get('/chatbot/status', requireRoles(...TEST_ROLES), wrap(async (_req, res) => {
  const p = activeProvider();
  res.json({ ai_configured: Boolean(p), provider: p?.name || null, model: p?.model || null, effort: p?.name === 'claude' ? process.env.CHATBOT_EFFORT || 'low' : null });
}));

router.get('/chatbot/sessions', requireRoles(...TEST_ROLES), wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.customer_name, s.channel_kind, s.status, s.handoff_reason, s.inbox_conversation_id, s.created_at, s.updated_at,
            s.input_tokens, s.output_tokens,
            (SELECT body FROM chatbot_messages m WHERE m.session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message
     FROM chatbot_sessions s ORDER BY s.updated_at DESC LIMIT 50`
  );
  res.json(rows);
}));

router.post('/chatbot/sessions', requireRoles(...TEST_ROLES), wrap(async (req, res) => {
  const session = await createSession({
    customerName: req.body?.customer_name,
    channelKind: req.body?.channel_kind,
    createdBy: req.user.id,
  });
  res.status(201).json(await sessionView(session.id));
}));

router.get('/chatbot/sessions/:id', requireRoles(...TEST_ROLES), wrap(async (req, res) => {
  const view = await sessionView(Number(req.params.id));
  if (!view) return res.status(404).json({ error: 'Chat not found' });
  res.json(view);
}));

router.post('/chatbot/sessions/:id/messages', requireRoles(...TEST_ROLES), wrap(async (req, res) => {
  await receive(Number(req.params.id), req.body?.text);
  res.json(await sessionView(Number(req.params.id)));
}));

router.delete('/chatbot/sessions/:id', requireRoles(...TEST_ROLES), wrap(async (req, res) => {
  await query(`DELETE FROM chatbot_sessions WHERE id = $1`, [Number(req.params.id)]);
  res.json({ ok: true });
}));

module.exports = router;
