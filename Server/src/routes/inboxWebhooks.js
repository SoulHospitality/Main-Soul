const express = require('express');
const { config } = require('../lib/inbox/config');
const { verifyMetaSignature } = require('../lib/inbox/security');
const { processPayload } = require('../lib/inbox/webhooks');

// Public Meta webhook (Messenger, Instagram, WhatsApp). Mounted before the API rate limiter.
const router = express.Router();

// Meta calls this once when the callback URL is saved in the app dashboard.
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && config.meta.verifyToken && token === config.meta.verifyToken) {
    return res.status(200).type('text/plain').send(String(challenge));
  }
  return res.sendStatus(403);
});

router.post('/meta', (req, res) => {
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
  if (config.meta.appSecret) {
    if (!verifyMetaSignature(raw, req.get('x-hub-signature-256'), config.meta.appSecret)) return res.sendStatus(401);
  } else if (config.isProduction) {
    return res.sendStatus(503); // never accept unsigned webhooks in production
  }
  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.sendStatus(400);
  // Acknowledge immediately; Meta retries if we are slow. Duplicates are dropped by message id.
  res.sendStatus(200);
  setImmediate(() => processPayload(payload));
  return undefined;
});

module.exports = router;
