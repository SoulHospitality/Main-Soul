const express = require('express');
const { config } = require('../../../lib/inbox/config');
const { q } = require('../../../lib/inbox/db');
const { HttpError, badRequest, wrap } = require('../../../lib/inbox/http');
const { randomToken } = require('../../../lib/inbox/security');
const { ingestComment, ingestInbound } = require('../../../lib/inbox/ingest');
const { requirePerm } = require('./common');

// Lets the team train and test the whole flow (routing, SLA, stages, analytics) before
// Meta approves the app. Simulated customers never trigger real API calls.
const router = express.Router();

router.use('/sim', (req, res, next) => {
  if (!config.simulatorEnabled) return next(new HttpError(404, 'Simulator is disabled'));
  return next();
}, requirePerm('simulator'));

async function demoChannel(kind) {
  const existing = await q.get('SELECT * FROM inbox_channels WHERE kind = ? AND external_id = ?', kind, `demo-${kind}`);
  if (existing) return existing;
  const names = { messenger: 'Demo Facebook Page', instagram: 'Demo Instagram', whatsapp: 'Demo WhatsApp' };
  const { id } = await q.insert(
    `INSERT INTO inbox_channels (kind, name, external_id, page_id, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT (kind, external_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    kind, names[kind], `demo-${kind}`, kind === 'instagram' ? 'demo-page' : null, Date.now(),
  );
  return q.get('SELECT * FROM inbox_channels WHERE id = ?', id);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').slice(0, 40);

router.post('/sim/inbound', wrap(async (req, res) => {
  const { kind = 'whatsapp', name, text, phone, ad } = req.body || {};
  if (!['messenger', 'instagram', 'whatsapp'].includes(kind)) throw badRequest('Invalid channel');
  if (!String(name || '').trim() || !String(text || '').trim()) throw badRequest('Name and message are required');
  const channel = await demoChannel(kind);
  const externalUserId = kind === 'whatsapp' && phone ? String(phone).replace(/\D/g, '') : `sim-${slug(name)}`;
  const result = await ingestInbound({
    channel,
    externalUserId,
    phone: kind === 'whatsapp' ? phone || null : null,
    profile: { name: String(name).trim().slice(0, 120) },
    simulated: true,
    message: {
      externalId: `sim-${randomToken(9)}`,
      text: String(text).slice(0, 4000),
      timestamp: Date.now(),
      referral: ad
        ? { source: 'ADS', type: 'OPEN_THREAD', ad_id: String(ad), source_url: kind === 'instagram' ? 'https://instagram.com' : 'https://facebook.com' }
        : null,
    },
  });
  res.json(result || {});
}));

router.post('/sim/comment', wrap(async (req, res) => {
  const { platform = 'facebook', name, text } = req.body || {};
  if (!String(name || '').trim() || !String(text || '').trim()) throw badRequest('Name and comment are required');
  const channel = await demoChannel(platform === 'instagram' ? 'instagram' : 'messenger');
  const id = await ingestComment({
    channel,
    platform: platform === 'instagram' ? 'instagram' : 'facebook',
    comment: {
      externalId: `sim-${randomToken(9)}`, postId: 'demo-post-summer-offer', postLink: null,
      authorId: `sim-${slug(name)}`, authorName: String(name).trim().slice(0, 120), text: String(text).slice(0, 2000), createdAt: Date.now(),
    },
  });
  res.json({ id });
}));

module.exports = router;
