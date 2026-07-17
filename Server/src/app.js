const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const staffAuthRoutes = require('./routes/staffAuth');
const unitsRoutes = require('./routes/units');
const bookingsRoutes = require('./routes/bookings');
const paymentsRoutes = require('./routes/payments');
const inquiriesRoutes = require('./routes/inquiries');
const wishlistRoutes = require('./routes/wishlist');
const promoRoutes = require('./routes/promoCodes');
const recruitmentRoutes = require('./routes/recruitment');
const salesRoutes = require('./routes/sales');
const icalRoutes = require('./routes/ical');
const pmsRoutes = require('./routes/pms');
const { refreshIcalBlocks } = require('./services/ical');

function createApp() {
  const app = express();

  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || origins.includes(origin) || origins.includes('*')) return cb(null, true);
        return cb(null, true); // permissive in unified local monorepo
      },
      credentials: true,
    })
  );

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
      limit: '2mb',
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.use(
    '/api/',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 800,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'main-soul-backend', ts: new Date().toISOString() });
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/staff/auth', staffAuthRoutes);
  app.use('/api/units', unitsRoutes);
  app.use('/api/projects', require('./routes/projects'));
  app.use('/api/bookings', bookingsRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/inquiries', inquiriesRoutes);
  app.use('/api/wishlist', wishlistRoutes);
  app.use('/api/promo-codes', promoRoutes);
  app.use('/api/recruitment', recruitmentRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/calendar', icalRoutes);
  app.use('/api/pms', pmsRoutes);
  app.use('/api/fx', require('./routes/fx'));
  app.use('/api/reviews', require('./routes/reviews').router);

  // Cron trigger (Vercel-style / manual)
  app.get('/api/cron/refresh-ical-blocks', async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const result = await refreshIcalBlocks();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
