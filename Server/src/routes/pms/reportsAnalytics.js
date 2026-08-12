/**
 * Admin analytics reports — revenue, by employee/unit, daily pivot, Excel export.
 * Behavior matches PMS-master reports routes, adapted for Main Soul schema
 * (units.title/unit_number, staff_users, FINANCIAL_EPOCH).
 */
const express = require('express');
const XLSX = require('xlsx');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { clampFromDate, FINANCIAL_EPOCH } = require('../../lib/financialEpoch');
const { calcReservationFinancials, round2 } = require('../../lib/commission');

const router = express.Router();

// Per-route admin gate only — do NOT use router.use(requireRoles(...)) here.
// This module is mounted at /api/pms without a path prefix; a router-level role
// middleware would 403 every PMS request for non-admin roles (ops, HK, agents).

function dateFilters(req, { alias = 'r', checkInCol = 'check_in', checkOutCol = 'check_out' } = {}) {
  const from = clampFromDate(req.query.from_date);
  const to = req.query.to_date || null;
  const params = [];
  let sql = '';
  if (from) {
    params.push(from);
    sql += ` AND ${alias}.${checkInCol} >= $${params.length}::date`;
  }
  if (to) {
    params.push(to);
    sql += ` AND ${alias}.${checkOutCol} <= $${params.length}::date`;
  }
  return { sql, params, from, to };
}

/** GET /reports/revenue */
router.get('/reports/revenue', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params, from } = dateFilters(req);
    const project = String(req.query.project || '').trim();
    if (project) {
      params.push(project);
    }
    const projectSql = project
      ? ` AND COALESCE(u.project, u.compound) = $${params.length}`
      : '';

    const { rows } = await query(
      `SELECT r.*,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              COALESCE(u.project, u.compound) AS project,
              u.unit_number,
              u.commission_mode, u.company_commission_pct,
              u.company_commission_owner_pct, u.commission_tenant_pct,
              su.full_name AS sales_person_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users su ON su.id = r.sales_person_id
       WHERE r.status <> 'cancelled'
         ${dateSql}
         ${projectSql}
       ORDER BY r.check_in DESC`,
      params
    );

    const totalRevenue = rows.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
    const totalPaid = rows.reduce((s, r) => s + (parseFloat(r.amount_paid) || 0), 0);

    res.json({
      reservations: rows,
      summary: {
        totalRevenue: round2(totalRevenue),
        totalPaid: round2(totalPaid),
        totalPending: round2(totalRevenue - totalPaid),
        count: rows.length,
        financial_epoch: FINANCIAL_EPOCH,
        from_date: from,
        to_date: req.query.to_date || null,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/by-employee */
router.get('/reports/by-employee', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = dateFilters(req);
    const { rows } = await query(
      `SELECT su.id, su.full_name, su.role,
              COUNT(r.id)::int AS reservation_count,
              COALESCE(SUM(r.total_amount), 0)::float AS total_amount
       FROM reservations r
       JOIN staff_users su ON su.id = r.sales_person_id
       WHERE r.status <> 'cancelled'
         ${dateSql}
       GROUP BY su.id, su.full_name, su.role
       ORDER BY total_amount DESC`,
      params
    );
    res.json({
      employees: rows.map((e) => ({
        ...e,
        total_amount: round2(parseFloat(e.total_amount) || 0),
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/by-unit */
router.get('/reports/by-unit', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = dateFilters(req);
    const { rows } = await query(
      `SELECT
         r.id, r.nights, r.total_amount, r.utilities_amount,
         r.price_per_night, r.is_owner_reservation,
         r.broker_total, r.broker_amount_per_night, r.housekeeping_fees,
         u.id AS unit_id,
         COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound) AS project,
         u.commission_mode,
         u.company_commission_pct,
         u.company_commission_owner_pct,
         u.commission_tenant_pct
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE r.status <> 'cancelled'
         ${dateSql}`,
      params
    );

    const unitMap = {};
    for (const r of rows) {
      const fin = calcReservationFinancials(
        {
          commission_mode: r.commission_mode,
          company_commission_pct: r.company_commission_pct,
          company_commission_owner_pct: r.company_commission_owner_pct,
          commission_tenant_pct: r.commission_tenant_pct,
        },
        r
      );
      if (!unitMap[r.unit_id]) {
        unitMap[r.unit_id] = {
          unit_id: r.unit_id,
          unit_name: r.unit_name,
          project: r.project,
          reservation_count: 0,
          total_nights: 0,
          total_gross: 0,
          total_owner_net: 0,
          total_company_commission: 0,
          total_utilities: 0,
        };
      }
      const u = unitMap[r.unit_id];
      u.reservation_count += 1;
      u.total_nights += parseInt(r.nights, 10) || 0;
      u.total_gross += fin.grossAmount;
      u.total_owner_net += fin.ownerNet;
      u.total_company_commission += fin.companyCommission;
      u.total_utilities += fin.utilitiesDeduction;
    }

    const units = Object.values(unitMap)
      .sort((a, b) => b.total_gross - a.total_gross)
      .map((u) => ({
        ...u,
        total_gross: round2(u.total_gross),
        total_owner_net: round2(u.total_owner_net),
        total_company_commission: round2(u.total_company_commission),
        total_utilities: round2(u.total_utilities),
      }));

    res.json({ units });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /reports/daily-reservations
 * Pivot by creation date × project (Cairo). Not filtered by stay-date UI filters
 * (same as PMS-master). Floored at FINANCIAL_EPOCH only.
 */
router.get('/reports/daily-reservations', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         (r.created_at AT TIME ZONE 'Africa/Cairo')::date AS date,
         COALESCE(u.project, u.compound, 'Unassigned') AS project,
         COUNT(r.id)::int AS count,
         COALESCE(SUM(r.total_amount), 0)::float AS amount
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE r.status <> 'cancelled'
         AND (r.created_at AT TIME ZONE 'Africa/Cairo')::date >= $1::date
       GROUP BY (r.created_at AT TIME ZONE 'Africa/Cairo')::date,
                COALESCE(u.project, u.compound, 'Unassigned')
       ORDER BY date DESC, project`,
      [FINANCIAL_EPOCH]
    );

    const projects = [...new Set(rows.map((r) => r.project).filter(Boolean))].sort();
    const dateMap = {};
    for (const r of rows) {
      const d = String(r.date).split('T')[0];
      if (!dateMap[d]) {
        dateMap[d] = { date: d, total: 0, total_amount: 0 };
      }
      dateMap[d][r.project] = (dateMap[d][r.project] || 0) + r.count;
      dateMap[d][`${r.project}_amount`] =
        (dateMap[d][`${r.project}_amount`] || 0) + parseFloat(r.amount);
      dateMap[d].total += r.count;
      dateMap[d].total_amount += parseFloat(r.amount);
    }

    const daily = Object.values(dateMap).sort((a, b) => b.date.localeCompare(a.date));
    res.json({ daily, projects, financial_epoch: FINANCIAL_EPOCH });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/export/reservations/excel */
router.get('/reports/export/reservations/excel', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = dateFilters(req);
    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              r.check_in::text AS check_in,
              r.check_out::text AS check_out,
              r.nights,
              r.total_amount,
              r.amount_paid,
              r.payment_status,
              r.booking_source,
              r.status,
              r.is_owner_reservation,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project,
              su.full_name AS sales_person
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users su ON su.id = r.sales_person_id
       WHERE r.status <> 'cancelled'
         ${dateSql}
       ORDER BY r.check_in DESC`,
      params
    );

    const sheetRows = rows.map((r) => ({
      ID: r.id,
      Guest: r.guest_name,
      Phone: r.guest_phone,
      'Check-in': r.check_in,
      'Check-out': r.check_out,
      Nights: r.nights,
      Total: Number(r.total_amount) || 0,
      Paid: Number(r.amount_paid) || 0,
      'Payment status': r.payment_status,
      Source: r.booking_source || '',
      Status: r.status,
      'Owner stay': r.is_owner_reservation ? 'Yes' : 'No',
      Unit: r.unit,
      Project: r.project,
      Agent: r.sales_person,
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reservations');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="soul-reservations-${params[0] || 'all'}.xlsx"`
    );
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
