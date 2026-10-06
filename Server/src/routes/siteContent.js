const express = require('express');
const { getSiteContent } = require('../lib/siteSettings');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await getSiteContent());
  } catch (e) {
    next(e);
  }
});

module.exports = router;
