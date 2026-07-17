const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

router.post('/validate', async (req, res, next) => {
  try {
    const { code, amount } = req.body;
    const { rows } = await query(
      `SELECT * FROM promo_codes WHERE upper(code) = upper($1) AND active = true
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)`,
      [code]
    );
    const promo = rows[0];
    if (!promo) return res.status(404).json({ valid: false, error: 'Invalid promo code' });

    let discounted = Number(amount || 0);
    if (promo.discount_percent) discounted = Math.round(discounted * (1 - Number(promo.discount_percent) / 100));
    if (promo.discount_amount) discounted = Math.max(0, discounted - Number(promo.discount_amount));

    res.json({
      valid: true,
      code: promo.code,
      discount_percent: promo.discount_percent,
      discount_amount: promo.discount_amount,
      discounted_total: discounted,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
