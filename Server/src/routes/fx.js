const express = require('express');
const { getUsdEgpRate } = require('../services/fx');

const router = express.Router();

/** GET /api/fx/usd-egp — EGP per 1 USD for guest display conversion */
router.get('/usd-egp', async (_req, res, next) => {
  try {
    const data = await getUsdEgpRate();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
