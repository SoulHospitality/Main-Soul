const express = require('express');
const { query } = require('../../config/db');
const { authStaff, requireRoles } = require('../../middleware/auth');
const { syncUnitListingStatus } = require('../../lib/unitListingStatus');
const { FINANCIAL_EPOCH, clampFromDate } = require('../../lib/financialEpoch');
const { bookingAssigneeClause, loadReservationAccess, assertReservationOwned, assertBookingAssigned, isAdmin } = require('../../lib/reservationScope');
const { upload, attachCloudinaryUrls } = require('../../config/cloudinary');

/** Extra PMS endpoints expected by the legacy admin SPA (stubs + thin adapters). */
const router = express.Router();
router.use(authStaff);

router.get('/users/sales', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, username, role FROM staff_users
       WHERE is_active = 1 AND role IN ('reservations','admin')`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/payments/all', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const method = req.query.payment_method || null;
    const params = [from];
    let where = `COALESCE(payment_date, created_at::date) >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND COALESCE(payment_date, created_at::date) <= $${params.length}::date`;
    }
    if (method) {
      params.push(method);
      where += ` AND payment_method = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM payments WHERE ${where} ORDER BY payment_date DESC NULLS LAST, created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/commissions/breakdown', requireRoles('admin'), async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const { to_date } = req.query;
    const params = [from_date];
    let where = `r.status <> 'cancelled' AND r.check_in >= $1::date`;
    if (to_date) {
      params.push(to_date);
      where += ` AND r.check_out <= $${params.length}::date`;
    }

    const { rows } = await query(
      `SELECT
         r.id, r.guest_name, r.check_in, r.check_out, r.nights,
         r.total_amount, r.price_per_night, r.utilities_amount, r.housekeeping_fees,
         r.is_owner_reservation,
         COALESCE(u.title, u.unit_number, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound, 'Unassigned') AS project,
         u.commission_mode,
         u.company_commission_pct,
         u.company_commission_owner_pct,
         u.commission_tenant_pct
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE ${where}
       ORDER BY r.check_in DESC`,
      params
    );

    const { calcReservationFinancials, round2 } = require('../../lib/commission');

    let totalGross = 0;
    let totalTenant = 0;
    let totalUtilities = 0;
    let totalHousekeeping = 0;
    let totalCompany = 0;
    let ownerCommission = 0;
    let regularCommission = 0;

    const breakdown = rows.map((r) => {
      const fin = calcReservationFinancials(r, r);
      totalGross += fin.grossAmount;
      totalTenant += fin.tenantDeduction;
      totalUtilities += fin.utilitiesDeduction;
      totalHousekeeping += fin.housekeepingFees;
      totalCompany += fin.companyCommission;
      if (fin.isOwner) ownerCommission += fin.companyCommission;
      else regularCommission += fin.companyCommission;

      return {
        id: r.id,
        guest_name: r.guest_name,
        unit_name: r.unit_name,
        project: r.project,
        check_in: r.check_in,
        check_out: r.check_out,
        nights: r.nights,
        is_owner: fin.isOwner,
        gross: fin.grossAmount,
        tenant_deduction: fin.tenantDeduction,
        utilities: fin.utilitiesDeduction,
        housekeeping: fin.housekeepingFees,
        company_commission: fin.companyCommission,
        owner_net: fin.ownerNet,
        applied_pct: fin.appliedCommissionPct,
        mode: fin.mode,
      };
    });

    res.json({
      breakdown,
      totals: {
        totalGross: round2(totalGross),
        totalTenant: round2(totalTenant),
        totalUtilities: round2(totalUtilities),
        totalHousekeeping: round2(totalHousekeeping),
        totalCompany: round2(totalCompany),
        regularCommission: round2(regularCommission),
        ownerRevenue: round2(ownerCommission),
        // Company commission revenue only (HK + utilities tracked on their own pages)
        grandTotal: round2(totalCompany + totalTenant),
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Finance / Profit hub summary.
 * Total Revenue = rental gross from reservations.
 * Deductible expenses = housekeeping + utilities + salaries + petty cash (out) + expenses table.
 */
router.get('/finance/summary', requireRoles('admin'), async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const to_date = req.query.to_date || null;
    const { calcReservationFinancials, round2 } = require('../../lib/commission');

    const resParams = [from_date];
    let resWhere = `r.status <> 'cancelled' AND r.check_in >= $1::date`;
    if (to_date) {
      resParams.push(to_date);
      resWhere += ` AND r.check_out <= $${resParams.length}::date`;
    }

    const { rows: reservations } = await query(
      `SELECT
         r.id, r.nights, r.total_amount, r.price_per_night, r.utilities_amount,
         r.housekeeping_fees, r.is_owner_reservation,
         u.commission_mode, u.company_commission_pct,
         u.company_commission_owner_pct, u.commission_tenant_pct,
         COALESCE(u.utilities_cost, 0) AS utilities_cost
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE ${resWhere}`,
      resParams
    );

    let totalRevenue = 0;
    let companyCommission = 0;
    let tenantCommission = 0;
    let ownerOwed = 0;
    let housekeeping = 0;
    let utilities = 0;

    for (const r of reservations) {
      const utilitiesAmount =
        parseFloat(r.utilities_amount) ||
        (Number(r.nights) || 0) * (parseFloat(r.utilities_cost) || 0);
      const fin = calcReservationFinancials(r, {
        ...r,
        utilities_amount: utilitiesAmount,
      });
      totalRevenue += fin.grossAmount;
      companyCommission += fin.companyCommission;
      tenantCommission += fin.tenantDeduction;
      ownerOwed += fin.ownerNet;
      housekeeping += fin.housekeepingFees;
      utilities += fin.utilitiesDeduction || utilitiesAmount;
    }

    const expParams = [from_date];
    let expWhere = `expense_date >= $1::date`;
    if (to_date) {
      expParams.push(to_date);
      expWhere += ` AND expense_date <= $${expParams.length}::date`;
    }
    const { rows: expenseRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses WHERE ${expWhere}`,
      expParams
    );
    const expenses = Number(expenseRows[0]?.total) || 0;

    const pcParams = [from_date];
    let pcWhere = `entry_type = 'out' AND entry_date >= $1::date`;
    if (to_date) {
      pcParams.push(to_date);
      pcWhere += ` AND entry_date <= $${pcParams.length}::date`;
    }
    const { rows: pettyRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM petty_cash WHERE ${pcWhere}`,
      pcParams
    );
    const pettyCash = Number(pettyRows[0]?.total) || 0;

    // Salaries count only after books open (Aug 2026+)
    let salaries = 0;
    const todayIso = new Date().toISOString().slice(0, 10);
    if (todayIso >= FINANCIAL_EPOCH) {
      const { rows: salaryRows } = await query(
        `SELECT COALESCE(SUM(base_salary), 0)::float AS total
         FROM employees WHERE COALESCE(is_active, 1) = 1`
      );
      salaries = Number(salaryRows[0]?.total) || 0;
    }

    const cfParams = [from_date];
    let cfWhere = `entry_date >= $1::date`;
    if (to_date) {
      cfParams.push(to_date);
      cfWhere += ` AND entry_date <= $${cfParams.length}::date`;
    }
    const { rows: cashRows } = await query(
      `SELECT entry_type, COALESCE(SUM(amount), 0)::float AS total
       FROM cash_ledger
       WHERE ${cfWhere}
       GROUP BY entry_type`,
      cfParams
    );
    let cashIn = 0;
    let cashOut = 0;
    for (const row of cashRows) {
      if (row.entry_type === 'in') cashIn = Number(row.total) || 0;
      if (row.entry_type === 'out') cashOut = Number(row.total) || 0;
    }

    // Expenses deducted from revenue for profit (per product rules)
    const deductibleExpenses = round2(
      housekeeping + utilities + salaries + pettyCash + expenses
    );
    const profit = round2(totalRevenue - deductibleExpenses);

    res.json({
      from_date,
      to_date: to_date || null,
      financial_epoch: FINANCIAL_EPOCH,
      totalRevenue: round2(totalRevenue),
      companyCommission: round2(companyCommission),
      tenantCommission: round2(tenantCommission),
      ownerOwed: round2(ownerOwed),
      housekeeping: round2(housekeeping),
      utilities: round2(utilities),
      salaries: round2(salaries),
      pettyCash: round2(pettyCash),
      expenses: round2(expenses),
      cashflow: {
        inflow: round2(cashIn),
        outflow: round2(cashOut),
        net: round2(cashIn - cashOut),
      },
      totalExpenses: deductibleExpenses,
      profit,
      expenseBreakdown: {
        housekeeping: round2(housekeeping),
        utilities: round2(utilities),
        salaries: round2(salaries),
        pettyCash: round2(pettyCash),
        expenses: round2(expenses),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/daily-prices', async (req, res, next) => {
  try {
    const { from_date, to_date } = req.query;
    const { rows } = await query(
      `SELECT udp.wp_post_id, u.id AS unit_id, udp.date::text AS date, udp.price
       FROM unit_daily_prices udp
       JOIN units u ON u.wp_post_id = udp.wp_post_id
       WHERE ($1::date IS NULL OR udp.date >= $1)
         AND ($2::date IS NULL OR udp.date <= $2)
       ORDER BY udp.date`,
      [from_date || null, to_date || null]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

function localIsoFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function eachDateInclusive(fromStr, toStr) {
  const [fy, fm, fd] = String(fromStr).split('-').map(Number);
  const [ty, tm, td] = String(toStr).split('-').map(Number);
  const out = [];
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    out.push(localIsoFromParts(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

router.post('/daily-prices/batch', requireRoles('admin'), async (req, res, next) => {
  try {
    const { unit_id, from_date, to_date, price, clear } = req.body;
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [unit_id]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const dates = eachDateInclusive(from_date, to_date);
    let n = 0;
    if (clear || price === null || price === '' || Number(price) <= 0) {
      for (const dateStr of dates) {
        await query(`DELETE FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`, [
          u[0].wp_post_id,
          dateStr,
        ]);
        n++;
      }
      // Incomplete / unpriced units must stay draft (hidden from guests)
      await syncUnitListingStatus(unit_id);
      return res.json({ ok: true, cleared: n });
    }
    for (const dateStr of dates) {
      await query(
        `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ($1,$2,$3,'EGP','manual-admin',now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
        [u[0].wp_post_id, dateStr, price]
      );
      n++;
    }
    await syncUnitListingStatus(unit_id);
    res.json({ ok: true, count: n });
  } catch (e) {
    next(e);
  }
});

router.get('/listing-ical', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT li.wordpress_post_id, li.listing_slug, li.ical_url, li.notes, li.updated_at,
              u.id AS unit_id, u.title AS unit_title, u.unit_number
       FROM listing_ical li
       LEFT JOIN units u ON u.wp_post_id = li.wordpress_post_id
       ORDER BY u.title NULLS LAST`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/listing-ical/:unitId', requireRoles('admin'), async (req, res, next) => {
  try {
    const { ical_url, notes } = req.body;
    const { rows: u } = await query(`SELECT id, wp_post_id, slug, title FROM units WHERE id = $1`, [
      req.params.unitId,
    ]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    if (!ical_url) {
      await query(`DELETE FROM listing_ical WHERE wordpress_post_id = $1`, [u[0].wp_post_id]);
      return res.json({ ok: true, cleared: true });
    }
    const { rows } = await query(
      `INSERT INTO listing_ical (wordpress_post_id, listing_slug, ical_url, notes, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (wordpress_post_id) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         listing_slug = EXCLUDED.listing_slug,
         notes = EXCLUDED.notes,
         updated_at = now()
       RETURNING *`,
      [u[0].wp_post_id, u[0].slug, ical_url, notes || null]
    );
    await query(`UPDATE units SET ical_url = $1, updated_at = now() WHERE id = $2`, [
      ical_url,
      u[0].id,
    ]);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/listing-ical/refresh', requireRoles('admin'), async (req, res, next) => {
  try {
    const { refreshIcalBlocks } = require('../../services/ical');
    const result = await refreshIcalBlocks();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/calendar-blocks', async (req, res, next) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to = req.query.to || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const unitId = req.query.unit_id;
    let wpPostId = null;
    if (unitId) {
      const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [unitId]);
      if (!u[0]?.wp_post_id) return res.json([]);
      wpPostId = u[0].wp_post_id;
    }
    const params = wpPostId != null ? [from, to, wpPostId] : [from, to];
    const filter = wpPostId != null ? 'AND b.wp_post_id = $3' : '';
    const { rows } = await query(
      `SELECT u.id AS unit_id, b.wp_post_id, b.date::text AS date, 'ical' AS source
       FROM unit_ical_blocks b
       JOIN units u ON u.wp_post_id = b.wp_post_id
       WHERE b.date >= $1 AND b.date < $2 ${filter}
       UNION ALL
       SELECT u.id AS unit_id, b.wp_post_id, b.date::text AS date, COALESCE(b.source,'manual') AS source
       FROM unit_blocked_dates b
       JOIN units u ON u.wp_post_id = b.wp_post_id
       WHERE b.date >= $1 AND b.date < $2 ${filter}
       UNION ALL
       SELECT u.id AS unit_id, u.wp_post_id, d::text AS date, 'reservation' AS source
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
       WHERE r.status <> 'cancelled'
         AND d >= $1::date AND d < $2::date
         ${wpPostId != null ? 'AND u.wp_post_id = $3' : ''}`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/blocked-dates/:unitId', requireRoles('admin'), async (req, res, next) => {
  try {
    const { dates = [], clear = false, from_date, to_date } = req.body;
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [req.params.unitId]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    if (clear && from_date && to_date) {
      await query(
        `DELETE FROM unit_blocked_dates WHERE wp_post_id = $1 AND date >= $2 AND date <= $3`,
        [u[0].wp_post_id, from_date, to_date]
      );
      return res.json({ ok: true, cleared: true });
    }
    let n = 0;
    for (const date of dates) {
      await query(
        `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
         VALUES ($1,$2,'manual',now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET updated_at = now()`,
        [u[0].wp_post_id, date]
      );
      n++;
    }
    res.json({ ok: true, count: n });
  } catch (e) {
    next(e);
  }
});

router.get('/website-bookings', async (req, res, next) => {
  try {
    if (isAdmin(req.user)) {
      return res.json([]);
    }

    const status = req.query.status;
    const params = [];
    let where = 'TRUE';
    if (status) {
      params.push(status);
      where = `b.status = $${params.length}`;
    }
    const scope = bookingAssigneeClause(req.user, 'b', params.length + 1);
    params.push(...scope.params);
    const { rows } = await query(
      `SELECT b.*,
              u.title AS unit_title,
              u.unit_number,
              u.slug AS unit_slug,
              su.full_name AS assigned_agent_name,
              COALESCE(
                NULLIF(b.id_photo_urls, '{}'),
                (
                  SELECT ARRAY(
                    SELECT jsonb_array_elements_text(ccs.payload->'photo_urls')
                  )
                  FROM card_checkout_sessions ccs
                  WHERE ccs.booking_id = b.id
                    AND jsonb_typeof(ccs.payload->'photo_urls') = 'array'
                  LIMIT 1
                ),
                (
                  SELECT ARRAY(
                    SELECT jsonb_array_elements_text(ccs.payload->'photo_urls')
                  )
                  FROM card_checkout_sessions ccs
                  WHERE ccs.status = 'pending'
                    AND ccs.payload->>'guest_email' = b.guest_email
                    AND ccs.payload->>'checkin' = b.checkin::text
                    AND ccs.payload->>'checkout' = b.checkout::text
                    AND jsonb_typeof(ccs.payload->'photo_urls') = 'array'
                  ORDER BY ccs.created_at DESC
                  LIMIT 1
                ),
                '{}'::text[]
              ) AS id_photo_urls
       FROM bookings b
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN staff_users su ON su.id = b.assigned_sales_id
       WHERE ${where}${scope.clause}
       ORDER BY b.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/website-bookings/:id/accept',
  requireRoles('reservations'),
  upload.single('evidence'),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const { acceptWebsiteBooking } = require('../../services/bookingWorkflow');
      const body = req.body || {};
      const booking = await acceptWebsiteBooking(req.params.id, req.user, {
        paymentMode: body.payment_mode || body.paymentMode || null,
        amountPaid: body.amount_paid ?? body.amountPaid,
        evidenceUrl: req.file?.path || req.file?.secure_url || body.evidence_url || null,
        evidenceName: req.file?.originalname || body.evidence_name || null,
      });
      res.json(booking);
    } catch (e) {
      next(e);
    }
  }
);

router.post('/website-bookings/:id/reject', requireRoles('reservations'), async (req, res, next) => {
  try {
    const { rejectWebsiteBooking } = require('../../services/bookingWorkflow');
    const booking = await rejectWebsiteBooking(
      req.params.id,
      req.user,
      req.body?.reason || 'rejected_by_staff'
    );
    res.json(booking);
  } catch (e) {
    next(e);
  }
});

router.get('/owner-units/my-units', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.* FROM owner_units ou JOIN units u ON u.id = ou.unit_id WHERE ou.owner_id = $1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/notifications/read-all', async (req, res, next) => {
  try {
    await query(`UPDATE notifications SET is_read = 1 WHERE user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    await query(`UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/petty-cash/settings', requireRoles('admin'), async (req, res, next) => {
  try {
    const location = req.query.location || 'main';
    const { rows } = await query(`SELECT * FROM petty_cash_settings WHERE location = $1`, [location]);
    res.json(rows[0] || { location, opening_balance: 0 });
  } catch (e) {
    next(e);
  }
});

router.put('/petty-cash/settings', requireRoles('admin'), async (req, res, next) => {
  try {
    const { location = 'main', opening_balance } = req.body;
    const { rows } = await query(
      `INSERT INTO petty_cash_settings (location, opening_balance, updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now()
       RETURNING *`,
      [location, opening_balance]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/treasury', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `entry_date >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND entry_date <= $${params.length}::date`;
    }
    const { rows } = await query(
      `SELECT * FROM cash_ledger WHERE ${where} ORDER BY entry_date DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/utilities', async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const { to_date, project, unit_id } = req.query;
    const params = [from_date];
    const conditions = [`r.status <> 'cancelled'`, `r.check_in >= $1::date`];

    if (to_date) {
      params.push(to_date);
      conditions.push(`r.check_out <= $${params.length}::date`);
    }
    if (project) {
      params.push(project);
      conditions.push(`(u.project = $${params.length} OR u.compound = $${params.length})`);
    }
    if (unit_id) {
      params.push(unit_id);
      conditions.push(`r.unit_id = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT
         r.id,
         u.id AS unit_id,
         COALESCE(u.title, u.unit_number, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound) AS project,
         COALESCE(u.utilities_cost, 0) AS utilities_cost,
         r.guest_name,
         r.check_in,
         r.check_out,
         r.nights,
         r.total_amount,
         COALESCE(
           NULLIF(r.utilities_amount, 0),
           (r.nights * COALESCE(u.utilities_cost, 0))
         )::real AS total_utilities_deducted
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.check_in DESC`,
      params
    );

    const data = rows.filter((r) => Number(r.total_utilities_deducted) > 0);
    const totalUtilities = data.reduce(
      (s, r) => s + (Number(r.total_utilities_deducted) || 0),
      0
    );

    res.json({
      data,
      summary: {
        total_utilities_deducted: totalUtilities,
        total_reservations: data.length,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/housekeeping', async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const { to_date, unit_id, project } = req.query;
    const params = [from_date];
    const conditions = [
      `r.status <> 'cancelled'`,
      `COALESCE(r.housekeeping_fees, 0) > 0`,
      `r.check_in >= $1::date`,
    ];

    if (to_date) {
      params.push(to_date);
      conditions.push(`r.check_in <= $${params.length}::date`);
    }
    if (unit_id) {
      params.push(unit_id);
      conditions.push(`r.unit_id = $${params.length}`);
    }
    if (project) {
      params.push(project);
      conditions.push(`(u.project = $${params.length} OR u.compound = $${params.length})`);
    }

    const { rows } = await query(
      `SELECT
         r.id,
         r.guest_name,
         r.check_in,
         r.check_out,
         r.nights,
         r.status,
         r.payment_status,
         r.housekeeping_fees,
         u.id AS unit_id,
         COALESCE(u.title, u.unit_number, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound) AS project
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.check_in DESC, r.id DESC`,
      params
    );

    const total = rows.reduce((s, r) => s + (parseFloat(r.housekeeping_fees) || 0), 0);
    const { rows: projectRows } = await query(
      `SELECT DISTINCT COALESCE(project, compound) AS project
       FROM units
       WHERE COALESCE(project, compound) IS NOT NULL
       ORDER BY 1`
    );

    res.json({
      summary: {
        total: Number(total.toFixed(2)),
        count: rows.length,
      },
      rows,
      projects: projectRows.map((p) => p.project).filter(Boolean),
    });
  } catch (e) {
    next(e);
  }
});
router.get('/reports/revenue', async (_req, res) => res.json([]));
router.get('/reports/by-employee', async (_req, res) => res.json([]));
router.get('/reports/by-unit', async (_req, res) => res.json([]));
router.get('/reports/daily-reservations', async (_req, res) => res.json([]));
router.get('/reservations/blocked-dates', async (req, res, next) => {
  try {
    const unitId = req.query.unit_id;
    if (!unitId) return res.json([]);

    const params = [unitId];
    let excludeSql = '';
    if (req.query.exclude_id) {
      params.push(Number(req.query.exclude_id));
      excludeSql = `AND r.id <> $${params.length}`;
    }

    const { rows } = await query(
      `SELECT r.id,
              r.check_in::text AS check_in,
              r.check_out::text AS check_out,
              r.status,
              r.guest_name,
              r.is_owner_reservation,
              r.total_amount
       FROM public.reservations r
       WHERE r.unit_id = $1::uuid
         AND r.status <> 'cancelled'
         ${excludeSql}
       ORDER BY r.check_in`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/deductions', requireRoles('admin', 'hr'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO salary_deductions (employee_id, amount, reason, deduction_date, system_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.employee_id, b.amount, b.reason, b.deduction_date, b.system_type, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/tasks/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         priority = COALESCE($3, priority),
         status = COALESCE($4, status),
         assigned_to = COALESCE($5, assigned_to),
         due_date = COALESCE($6, due_date),
         updated_at = now()
       WHERE id = $7 RETURNING *`,
      [b.title, b.description, b.priority, b.status, b.assigned_to, b.due_date, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/reservations/:id', requireRoles('reservations'), async (req, res, next) => {
  try {
    const existing = await loadReservationAccess(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    assertReservationOwned(req.user, existing);

    const b = req.body;
    const { rows } = await query(
      `UPDATE reservations SET
         status = COALESCE($1, status),
         payment_status = COALESCE($2, payment_status),
         amount_paid = COALESCE($3, amount_paid),
         notes = COALESCE($4, notes),
         updated_at = now()
       WHERE id = $5 RETURNING *`,
      [b.status, b.payment_status, b.amount_paid, b.notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/auth/change-password', async (req, res, next) => {
  // Legacy path — password change lives on staff auth; accept here for SPA
  try {
    const bcrypt = require('bcryptjs');
    const { passwordPolicyOk, passwordPolicyMessage } = require('../../lib/staffIdentity');
    const { currentPassword, newPassword, current_password, new_password } = req.body;
    const cur = currentPassword || current_password;
    const neu = newPassword || new_password;
    if (!cur || !neu) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (!passwordPolicyOk(neu)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }
    const { rows } = await query(`SELECT password_hash FROM staff_users WHERE id = $1`, [req.user.id]);
    if (!(await bcrypt.compare(cur, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }
    const hash = await bcrypt.hash(neu, 10);
    await query(
      `UPDATE staff_users SET password_hash = $1, is_first_login = 0, updated_at = now() WHERE id = $2`,
      [hash, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
