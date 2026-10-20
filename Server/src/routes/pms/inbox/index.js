const express = require('express');
const { wrap } = require('../../../lib/inbox/http');
const { inboxAuth } = require('./common');
const account = require('./account');

// Mounted inside the PMS router (staff auth already applied) under /api/pms/inbox.
const inner = express.Router();
inner.use(account.publicRouter);
inner.use(wrap(inboxAuth));
inner.use(account.router);
inner.use(require('./conversations'));
inner.use(require('./leads'));
inner.use(require('./comments'));
inner.use(require('./analytics'));
const admin = require('./admin');
// The admin app calls /api/pms/inbox/admin/...; keep the unprefixed routes too.
inner.use('/admin', admin);
inner.use(admin);
inner.use(require('./simulator'));

const router = express.Router();
router.use('/inbox', inner);

module.exports = router;
