/**
 * Website live chat: the same chatbot as Instagram and Messenger, in a chat bubble on the guest site.
 * A visitor's chat is identified by a random token kept in their browser. After a hand-off, agents
 * answer from the Live Inbox and their replies appear here.
 */
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/db');
const { loadSettings, getSettings } = require('../lib/inbox/settings');
const assistant = require('../lib/chatbot/assistant');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many chats from this device. Try again later.' } });
const messageLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'You are sending messages too fast. Please wait a moment.' } });

async function enabled() {
  await loadSettings();
  return Boolean(getSettings().chatbot_website) && Boolean(assistant.activeProvider());
}

async function sessionByToken(token) {
  if (!/^[a-f0-9]{24,64}$/.test(String(token || ''))) return null;
  const { rows } = await query(`SELECT * FROM chatbot_sessions WHERE token = $1 AND mode = 'website'`, [token]);
  return rows[0] || null;
}

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

/** What the visitor sees: their messages, the bot's, and the team's (no internal notes). */
async function visitorView(session) {
  const view = await assistant.sessionView(session.id);
  return {
    status: view.status === 'handed_off' ? 'team' : 'bot',
    bot_typing: view.bot_typing,
    messages: view.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ id: m.id, role: m.role, body: m.body, units: m.units || null, created_at: m.created_at })),
  };
}

router.get('/config', wrap(async (_req, res) => {
  res.json({ enabled: await enabled() });
}));

router.post('/sessions', createLimiter, wrap(async (_req, res) => {
  if (!(await enabled())) return res.status(503).json({ error: 'Chat is not available right now' });
  const session = await assistant.createSession({ channelKind: 'website', mode: 'website' });
  res.status(201).json({ token: session.token, ...(await visitorView(session)) });
}));

router.get('/sessions/:token', wrap(async (req, res) => {
  const session = await sessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Chat not found' });
  res.json(await visitorView(session));
}));

router.post('/sessions/:token/messages', messageLimiter, wrap(async (req, res) => {
  const session = await sessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Chat not found' });
  if (!(await enabled()) && session.status !== 'handed_off') return res.status(503).json({ error: 'Chat is not available right now' });
  await assistant.accept(session.id, req.body?.text);
  res.status(202).json(await visitorView(session));
}));

/** A photo or a voice note (8 MB max). */
router.post('/sessions/:token/files', messageLimiter, upload.single('file'), wrap(async (req, res) => {
  const session = await sessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'Chat not found' });
  const file = req.file;
  const mime = String(file?.mimetype || '').toLowerCase();
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : null;
  if (!file || !type) return res.status(400).json({ error: 'Send a photo or a voice note' });
  const { uploadBufferToCloudinary } = require('../config/cloudinary');
  const uploaded = await uploadBufferToCloudinary(file.buffer, file.originalname || `${type}.${type === 'audio' ? 'webm' : 'jpg'}`, mime, { folder: 'soul/website-chat' });
  // Browsers record voice notes as WebM; Cloudinary serves the same file as MP3, which the AI can hear.
  const url = type === 'audio' ? String(uploaded.secure_url).replace(/\.[a-z0-9]+$/i, '.mp3') : uploaded.secure_url;
  await assistant.accept(session.id, req.body?.text || '', [{ type, url, mime: type === 'audio' ? 'audio/mpeg' : mime }]);
  res.status(202).json(await visitorView(session));
}));

module.exports = router;
