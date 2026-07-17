const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

router.get('/:slug.ics', async (req, res, next) => {
  try {
    const slug = req.params.slug.replace(/\.ics$/, '');
    const { rows: units } = await query(`SELECT * FROM units WHERE slug = $1`, [slug]);
    const unit = units[0];
    if (!unit) return res.status(404).send('Not found');

    const { rows: bookings } = await query(
      `SELECT checkin, checkout, guest_name, id FROM bookings
       WHERE listing_slug = $1 AND status IN ('confirmed','pending','held')`,
      [unit.slug]
    );

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Soul Hospitality//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    for (const b of bookings) {
      const dtStart = String(b.checkin).replace(/-/g, '');
      const dtEnd = String(b.checkout).replace(/-/g, '');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${b.id}@soulhospitality.co`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:Booked`,
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
