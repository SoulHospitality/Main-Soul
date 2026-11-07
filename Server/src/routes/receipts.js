const express = require('express');
const { idFromToken, guestReceipt } = require('../lib/receiptLink');

// Public: a guest opens their receipt from the link sent on WhatsApp.
const router = express.Router();

router.get('/:token', async (req, res, next) => {
  try {
    const id = idFromToken(req.params.token);
    if (!id) return res.status(404).json({ error: 'Receipt not found' });
    const receipt = await guestReceipt(id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.set('Cache-Control', 'private, no-store');
    res.json(receipt);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
