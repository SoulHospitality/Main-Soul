const express = require('express');
const rateLimit = require('express-rate-limit');
const { soullyReply } = require('../../lib/soully/chat');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `soully:${req.user?.id || 'anon'}`,
  message: { error: 'Easy. I am one assistant, not a call center. Give me a minute.' },
});

function cleanMessages(body) {
  const list = Array.isArray(body?.messages) ? body.messages : [];
  const messages = list
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').trim().slice(0, 2000),
    }))
    .filter((item) => item.content)
    .slice(-16);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  if (messages.some((item, index) => index > 0 && item.role === messages[index - 1].role)) {
    const folded = [];
    for (const item of messages) {
      if (folded.length && folded[folded.length - 1].role === item.role) {
        folded[folded.length - 1] = item;
      } else {
        folded.push(item);
      }
    }
    if (!folded.length || folded[folded.length - 1].role !== 'user') return null;
    return folded;
  }
  return messages;
}

router.post('/soully/chat', limiter, async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Soully is for the admin only right now' });
    }
    const messages = cleanMessages(req.body);
    if (!messages) {
      return res.status(400).json({ error: 'Send a message first. I cannot banter with silence.' });
    }
    const reply = await soullyReply(req.user, messages);
    res.json({ reply });
  } catch (err) {
    if (err.status === 503 || err.status === 403) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.status === 502) {
      console.error('[soully]', err.geminiStatus || '', err.message);
      return res.status(502).json({
        error: err.publicMessage || 'I tripped over a cable. Ask again in a second.',
      });
    }
    next(err);
  }
});

module.exports = router;
