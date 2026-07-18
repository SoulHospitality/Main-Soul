const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../../config/db');
const { authStaff, requireRoles, requirePasswordChanged } = require('../../middleware/auth');
const { upload, attachCloudinaryUrls } = require('../../config/cloudinary');
const compat = require('./compat');
const {
  TEMP_PASSWORD,
  generateUniqueStaffCode,
  passwordPolicyOk,
  passwordPolicyMessage,
} = require('../../lib/staffIdentity');

const { resolveDriveFolderPhotos } = require('../../services/drivePhotos');
const { resolveListingStatus } = require('../../lib/unitCompleteness');
const {
  syncUnitListingStatus,
} = require('../../lib/unitListingStatus');
const { FINANCIAL_EPOCH, clampFromDate } = require('../../lib/financialEpoch');

const router = express.Router();
router.use(authStaff);
router.use(requirePasswordChanged);
router.use(compat);

function sendList(res, rows) {
  res.json(rows);
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function parseOtherDetails(otherDetails) {
  if (!otherDetails) return {};
  try {
    const parsed = typeof otherDetails === 'string' ? JSON.parse(otherDetails) : otherDetails;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseFacilities(otherDetails) {
  const parsed = parseOtherDetails(otherDetails);
  return Array.isArray(parsed.facilities) ? parsed.facilities : [];
}

function buildOtherDetails({ facilities, photos_folder_url, existing } = {}) {
  const base = parseOtherDetails(existing);
  if (facilities != null) base.facilities = Array.isArray(facilities) ? facilities : [];
  if (photos_folder_url !== undefined) {
    if (photos_folder_url) base.photos_folder_url = String(photos_folder_url).trim();
    else delete base.photos_folder_url;
  }
  return JSON.stringify(base);
}

function normalizeTagList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Empty string / NaN → null; otherwise number (or integer when opts.int). */
function toNum(value, { int = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return int ? Math.round(n) : n;
}

function toText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function mapUnitRow(u) {
  const details = parseOtherDetails(u.other_details);
  return {
    ...u,
    name: u.title,
    bedrooms: u.beds,
    bathrooms: u.baths,
    type: u.property_type,
    area_sqft: u.size_m2,
    price_per_night: u.price_fallback,
    project: u.project || u.compound,
    photos_link: details.photos_folder_url || u.cover_url,
    photos_folder_url: details.photos_folder_url || '',
    destination: u.area,
    location_link: u.source_url,
    facilities: Array.isArray(details.facilities) ? details.facilities : [],
    beach_access_price: u.access_fee_per_adult_egp,
    beach_access_extra_guest: u.access_fee_per_teen_egp,
    beach_access_days: u.access_card_count_included || 7,
  };
}

async function resolvePhotosFromBody(b) {
  const folderUrl = b.photos_folder_url || b.drive_folder_url || b.photos_link || null;
  if (!folderUrl) return { folderUrl: null, urls: null };
  const resolved = await resolveDriveFolderPhotos(folderUrl);
  return { folderUrl: String(folderUrl).trim(), urls: resolved.urls };
}

// ── Users (Admin + HR staff management) ─────────────────────
const STAFF_SELECT = `
  id, username, email, full_name, role, is_active, sales_commission_pct,
  operation_specialist_pct, operation_manager_pct, reservation_manager_pct,
  petty_cash_location, staff_code, base_salary, pending_base_salary,
  salary_change_status, is_first_login, created_at, updated_at
`;

function assertCanAssignRole(actorRole, targetRole) {
  if (targetRole === 'admin' && actorRole !== 'admin') {
    const err = new Error('Only admins can create or assign the admin role');
    err.status = 403;
    throw err;
  }
  const allowed = ['admin', 'reservations', 'resale', 'hr'];
  if (!allowed.includes(targetRole)) {
    const err = new Error('Invalid role. Use admin, reservations, resale, or hr.');
    err.status = 400;
    throw err;
  }
  if (actorRole === 'hr' && !['reservations', 'resale', 'hr'].includes(targetRole)) {
    const err = new Error('HR can only create reservations, resale, or HR users');
    err.status = 403;
    throw err;
  }
}

router.get('/users', requireRoles('admin', 'hr'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${STAFF_SELECT} FROM staff_users ORDER BY id`
    );
    sendList(
      res,
      rows.map((r) => ({ ...r, is_first_login: Boolean(Number(r.is_first_login)) }))
    );
  } catch (e) {
    next(e);
  }
});

router.post('/users', requireRoles('admin', 'hr'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const full_name = String(b.full_name || b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const role = String(b.role || '').trim();
    const baseSalary = parseFloat(b.base_salary);
    if (!full_name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }
    if (Number.isNaN(baseSalary) || baseSalary < 0) {
      return res.status(400).json({ error: 'Fixed base salary is required' });
    }
    assertCanAssignRole(req.user.role, role);

    const staff_code = await generateUniqueStaffCode(role);
    const username = String(b.username || staff_code).trim().toLowerCase();
    const tempPassword = TEMP_PASSWORD;
    const hash = await bcrypt.hash(tempPassword, 10);

    const { rows } = await query(
      `INSERT INTO staff_users (
         username, password_hash, email, full_name, role, staff_code,
         base_salary, salary_change_status, is_first_login, is_active,
         sales_commission_pct
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'none',1,1,COALESCE($8,0))
       RETURNING ${STAFF_SELECT}`,
      [
        username,
        hash,
        email,
        full_name,
        role,
        staff_code,
        baseSalary,
        b.sales_commission_pct ?? 0,
      ]
    );

    const user = { ...rows[0], is_first_login: true };
    res.status(201).json({
      ...user,
      temporaryPassword: tempPassword,
      staffId: staff_code,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    next(e);
  }
});

router.patch('/users/:id', requireRoles('admin', 'hr'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existingRows } = await query(
      `SELECT * FROM staff_users WHERE id = $1`,
      [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (req.user.role === 'hr' && existing.role === 'admin') {
      return res.status(403).json({ error: 'HR cannot edit admin accounts' });
    }

    let nextRole = b.role != null ? String(b.role) : existing.role;
    if (b.role != null) assertCanAssignRole(req.user.role, nextRole);

    let baseSalary = existing.base_salary;
    let pendingSalary = existing.pending_base_salary;
    let salaryStatus = existing.salary_change_status || 'none';

    if (b.base_salary != null && b.base_salary !== '' && Number(b.base_salary) !== Number(existing.base_salary)) {
      const requested = parseFloat(b.base_salary);
      if (Number.isNaN(requested) || requested < 0) {
        return res.status(400).json({ error: 'Invalid base salary' });
      }
      if (req.user.role === 'admin') {
        baseSalary = requested;
        pendingSalary = null;
        salaryStatus = 'none';
      } else {
        pendingSalary = requested;
        salaryStatus = 'pending';
      }
    }

    const { rows } = await query(
      `UPDATE staff_users SET
         full_name = COALESCE($1, full_name),
         email = COALESCE($2, email),
         role = COALESCE($3, role),
         is_active = COALESCE($4, is_active),
         sales_commission_pct = COALESCE($5, sales_commission_pct),
         operation_specialist_pct = COALESCE($6, operation_specialist_pct),
         operation_manager_pct = COALESCE($7, operation_manager_pct),
         reservation_manager_pct = COALESCE($8, reservation_manager_pct),
         petty_cash_location = COALESCE($9, petty_cash_location),
         base_salary = $10,
         pending_base_salary = $11,
         salary_change_status = $12,
         updated_at = now()
       WHERE id = $13
       RETURNING ${STAFF_SELECT}`,
      [
        b.full_name ?? null,
        b.email ?? null,
        b.role != null ? nextRole : null,
        b.is_active != null ? b.is_active : null,
        b.sales_commission_pct ?? null,
        b.operation_specialist_pct ?? null,
        b.operation_manager_pct ?? null,
        b.reservation_manager_pct ?? null,
        b.petty_cash_location !== undefined ? b.petty_cash_location : null,
        baseSalary,
        pendingSalary,
        salaryStatus,
        req.params.id,
      ]
    );
    res.json({ ...rows[0], is_first_login: Boolean(Number(rows[0].is_first_login)) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.put('/users/:id', requireRoles('admin', 'hr'), async (req, res, next) => {
  const patchLayer = router.stack.find(
    (l) => l.route && l.route.path === '/users/:id' && l.route.methods.patch
  );
  if (!patchLayer) return next(new Error('PATCH /users/:id handler missing'));
  return patchLayer.route.stack[patchLayer.route.stack.length - 1].handle(req, res, next);
});

router.post('/users/:id/approve-salary', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE staff_users SET
         base_salary = COALESCE(pending_base_salary, base_salary),
         pending_base_salary = NULL,
         salary_change_status = 'approved',
         updated_at = now()
       WHERE id = $1 AND salary_change_status = 'pending'
       RETURNING ${STAFF_SELECT}`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No pending salary change' });
    res.json({ ...rows[0], is_first_login: Boolean(Number(rows[0].is_first_login)) });
  } catch (e) {
    next(e);
  }
});

router.post('/users/:id/reject-salary', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE staff_users SET
         pending_base_salary = NULL,
         salary_change_status = 'rejected',
         updated_at = now()
       WHERE id = $1 AND salary_change_status = 'pending'
       RETURNING ${STAFF_SELECT}`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No pending salary change' });
    res.json({ ...rows[0], is_first_login: Boolean(Number(rows[0].is_first_login)) });
  } catch (e) {
    next(e);
  }
});

router.put('/users/:id/reset-password', requireRoles('admin', 'hr'), async (req, res, next) => {
  try {
    const { rows: existingRows } = await query(`SELECT role FROM staff_users WHERE id = $1`, [
      req.params.id,
    ]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'hr' && existingRows[0].role === 'admin') {
      return res.status(403).json({ error: 'HR cannot reset admin passwords' });
    }

    const newPassword = req.body?.new_password || TEMP_PASSWORD;
    if (req.body?.new_password && !passwordPolicyOk(newPassword)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE staff_users
       SET password_hash = $1, is_first_login = 1, updated_at = now()
       WHERE id = $2`,
      [hash, req.params.id]
    );
    res.json({ ok: true, temporaryPassword: newPassword });
  } catch (e) {
    next(e);
  }
});

router.delete('/users/:id', requireRoles('admin', 'hr'), async (req, res, next) => {
  try {
    if (Number(req.params.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }
    const { rows: existingRows } = await query(`SELECT role FROM staff_users WHERE id = $1`, [
      req.params.id,
    ]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'hr' && existingRows[0].role === 'admin') {
      return res.status(403).json({ error: 'HR cannot deactivate admin accounts' });
    }
    const { rows } = await query(
      `UPDATE staff_users SET is_active = 0, updated_at = now()
       WHERE id = $1 RETURNING id, username, is_active`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// ── Units (shared public.units) ─────────────────────────────
router.get('/units', async (req, res, next) => {
  try {
    const { search, status, project, bedrooms } = req.query;
    const where = ['TRUE'];
    const params = [];
    let i = 1;
    if (search) {
      where.push(`(title ILIKE $${i} OR unit_number ILIKE $${i} OR owner_name ILIKE $${i} OR compound ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    if (status) {
      // ops_status filter for PMS UI (available/occupied/maintenance) OR listing status
      if (['available', 'occupied', 'maintenance'].includes(status)) {
        where.push(`ops_status = $${i++}`);
        params.push(status);
      } else {
        where.push(`status = $${i++}`);
        params.push(status);
      }
    }
    if (project) {
      where.push(`(project ILIKE $${i} OR compound ILIKE $${i})`);
      params.push(project);
      i++;
    }
    if (bedrooms !== undefined && bedrooms !== '') {
      where.push(`beds = $${i++}`);
      params.push(Number(bedrooms));
    }
    const { rows } = await query(
      `SELECT id, slug, title, status, ops_status, compound, project, area, beds, baths, guests,
              size_m2, floor, view, property_type, wp_post_id, cover_url, photo_urls, amenities,
              short_description, the_property, source_url, other_details, owner_name, owner_email,
              owner_phone, commission_mode, company_commission_pct, company_commission_owner_pct,
              commission_tenant_pct, utilities_cost, internal_code, unit_number, price_fallback,
              cleaning_fee_egp, service_fee_percent, security_deposit_egp,
              access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included,
              min_nights, ical_url, notes, created_at
       FROM units
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC`
      ,
      params
    );
    sendList(res, rows.map(mapUnitRow));
  } catch (e) {
    next(e);
  }
});

router.get('/units/projects', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT COALESCE(project, compound) AS project FROM units ORDER BY 1`
    );
    res.json(rows.map((r) => r.project).filter(Boolean));
  } catch (e) {
    next(e);
  }
});

router.post('/units', requireRoles('admin', 'resale'), async (req, res, next) => {
  try {
    const b = req.body;
    const title = toText(b.title || b.name);
    const compound = toText(b.compound || b.project || b.projectName);
    const area = toText(b.area || b.destination, 'North Coast');
    if (!title) return res.status(400).json({ error: 'Unit name is required' });
    if (!compound) return res.status(400).json({ error: 'Project is required' });

    const { housekeepingFeeForType } = require('../../lib/housekeeping');
    const propertyType = toText(b.property_type || b.type);
    const cleaningFee = housekeepingFeeForType(propertyType);
    const priceFallback = toNum(b.price_per_night || b.price_fallback, { int: true });
    const beds = toNum(b.beds ?? b.bedrooms, { int: true, fallback: 1 });
    const baths = toNum(b.baths ?? b.bathrooms, { int: true, fallback: 1 });
    const guests = toNum(b.guests || b.capacity, { int: true, fallback: 2 });

    const slug = toText(b.slug) || slugify(title || `unit-${Date.now()}`);
    const amenities = normalizeTagList(b.amenities);
    const facilities = normalizeTagList(b.facilities);
    const beachPrice = toNum(b.beach_access_price ?? b.access_fee_per_adult_egp, { int: true });
    const beachExtra = toNum(b.beach_access_extra_guest ?? b.access_fee_per_teen_egp, { int: true });
    const beachDays = toNum(b.beach_access_days ?? b.access_card_count_included, { int: true, fallback: 7 });

    let photoUrls = Array.isArray(b.photo_urls) ? b.photo_urls : [];
    let coverUrl = b.cover_url || photoUrls[0] || null;
    let folderUrl = b.photos_folder_url || b.drive_folder_url || b.photos_link || null;
    if (folderUrl) {
      const resolved = await resolvePhotosFromBody(b);
      folderUrl = resolved.folderUrl;
      photoUrls = resolved.urls || [];
      coverUrl = photoUrls[0] || null;
    }

    const completeness = resolveListingStatus({
      unit: {
        title,
        compound,
        project: toText(b.project || b.projectName || b.compound, compound),
        property_type: propertyType,
        beds,
        baths,
        guests,
        price_fallback: priceFallback,
        cover_url: coverUrl,
        photo_urls: photoUrls,
      },
      hasPrice: Number(priceFallback) > 0,
      requestedStatus: b.status || b.listing_status || null,
      isCreate: true,
    });
    const status = completeness.status;

    const { rows } = await query(
      `INSERT INTO units (
         slug, title, status, source, compound, project, area, beds, baths, guests, size_m2,
         cover_url, photo_urls, amenities, other_details, short_description, the_property,
         owner_name, owner_email, owner_phone,
         company_commission_pct, company_commission_owner_pct, commission_mode, commission_tenant_pct,
         utilities_cost, ops_status, unit_number, internal_code, created_by_staff, price_fallback,
         property_type, view, floor, source_url, min_nights, cleaning_fee_egp,
         access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included
       ) VALUES (
         $1,$2,COALESCE($3,'draft'),'manual',$4,COALESCE($5,$4),COALESCE($6,'North Coast'),
         $7,$8,$9,$10,$11,COALESCE($12,'{}'),COALESCE($13,'{}'),$14,$15,$16,
         $17,$18,$19,$20,$21,$22,$23,$24,COALESCE($25,'available'),$26,$27,$28,$29,
         $30,$31,$32,$33,$34,$35,$36,$37,$38
       ) RETURNING *`,
      [
        slug,
        title,
        status,
        compound,
        toText(b.project || b.projectName || b.compound, compound),
        area,
        beds,
        baths,
        guests,
        toNum(b.size_m2 || b.area_sqft, { int: true }),
        coverUrl,
        photoUrls,
        amenities,
        buildOtherDetails({ facilities, photos_folder_url: folderUrl }),
        toText(b.short_description),
        toText(b.the_property || b.description),
        toText(b.owner_name),
        toText(b.owner_email),
        toText(b.owner_phone),
        toNum(b.company_commission_pct, { fallback: 20 }),
        toNum(b.company_commission_owner_pct, { fallback: 10 }),
        b.commission_mode || 'A',
        toNum(b.commission_tenant_pct, { fallback: 0 }),
        toNum(b.utilities_cost, { fallback: 0 }),
        b.ops_status || (['available', 'occupied', 'maintenance'].includes(b.status) ? b.status : 'available'),
        toText(b.unit_number),
        toText(b.internal_code || b.uniqueId),
        req.user.id,
        priceFallback,
        propertyType,
        toText(b.view),
        b.floor != null && b.floor !== '' ? String(b.floor) : null,
        toText(b.location_link || b.source_url),
        toNum(b.min_nights, { int: true, fallback: 1 }),
        cleaningFee,
        beachPrice,
        beachExtra,
        beachDays,
      ]
    );
    const payload = mapUnitRow(rows[0]);
    payload.listing_completeness = {
      complete: completeness.complete,
      missing: completeness.missing,
      status,
    };
    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
});

async function updateUnitHandler(req, res, next) {
  try {
    const b = req.body;
    const amenities = b.amenities == null ? null : normalizeTagList(b.amenities);
    const facilities = b.facilities == null ? null : normalizeTagList(b.facilities);
    const { housekeepingFeeForType } = require('../../lib/housekeeping');

    let listingStatus = ['draft', 'published', 'cancelled', 'archived', 'delisted'].includes(b.status)
      ? b.status
      : b.listing_status || null;
    const opsStatus = b.ops_status
      || (['available', 'occupied', 'maintenance'].includes(b.status) ? b.status : null);

    const beachPrice = b.beach_access_price !== undefined || b.access_fee_per_adult_egp !== undefined
      ? toNum(b.beach_access_price ?? b.access_fee_per_adult_egp, { int: true })
      : null;
    const beachExtra = b.beach_access_extra_guest !== undefined || b.access_fee_per_teen_egp !== undefined
      ? toNum(b.beach_access_extra_guest ?? b.access_fee_per_teen_egp, { int: true })
      : null;
    const beachDays = b.beach_access_days !== undefined || b.access_card_count_included !== undefined
      ? toNum(b.beach_access_days ?? b.access_card_count_included, { int: true })
      : null;

    const { rows: existingRows } = await query(
      `SELECT other_details, price_fallback, wp_post_id, property_type, status FROM units WHERE id = $1`,
      [req.params.id]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });

    const propertyType = toText(b.property_type || b.type) || existingRows[0].property_type;
    const cleaningFee = housekeepingFeeForType(propertyType);

    let photoUrls = b.photo_urls ?? null;
    let coverUrl = b.cover_url ?? null;
    let folderUrl;
    if (b.photos_folder_url !== undefined || b.drive_folder_url !== undefined || b.photos_link !== undefined) {
      folderUrl = b.photos_folder_url || b.drive_folder_url || b.photos_link || '';
      if (folderUrl) {
        const resolved = await resolvePhotosFromBody({ photos_folder_url: folderUrl });
        folderUrl = resolved.folderUrl;
        photoUrls = resolved.urls;
        coverUrl = photoUrls?.[0] || null;
      } else {
        folderUrl = '';
      }
    }

    const otherDetails = buildOtherDetails({
      facilities: facilities == null ? undefined : facilities,
      photos_folder_url: folderUrl,
      existing: existingRows[0].other_details,
    });

    const { rows } = await query(
      `UPDATE units SET
         title = COALESCE($1, title),
         status = COALESCE($2, status),
         compound = COALESCE($3, compound),
         project = COALESCE($4, project),
         area = COALESCE($5, area),
         beds = COALESCE($6, beds),
         baths = COALESCE($7, baths),
         guests = COALESCE($8, guests),
         size_m2 = COALESCE($9, size_m2),
         cover_url = COALESCE($10, cover_url),
         photo_urls = COALESCE($11, photo_urls),
         amenities = COALESCE($12, amenities),
         other_details = COALESCE($13, other_details),
         short_description = COALESCE($14, short_description),
         the_property = COALESCE($15, the_property),
         owner_name = COALESCE($16, owner_name),
         owner_email = COALESCE($17, owner_email),
         owner_phone = COALESCE($18, owner_phone),
         commission_mode = COALESCE($19, commission_mode),
         company_commission_pct = COALESCE($20, company_commission_pct),
         company_commission_owner_pct = COALESCE($21, company_commission_owner_pct),
         commission_tenant_pct = COALESCE($22, commission_tenant_pct),
         utilities_cost = COALESCE($23, utilities_cost),
         ops_status = COALESCE($24, ops_status),
         unit_number = COALESCE($25, unit_number),
         internal_code = COALESCE($26, internal_code),
         price_fallback = COALESCE($27, price_fallback),
         property_type = COALESCE($28, property_type),
         view = COALESCE($29, view),
         floor = COALESCE($30, floor),
         source_url = COALESCE($31, source_url),
         min_nights = COALESCE($32, min_nights),
         access_fee_per_adult_egp = COALESCE($33, access_fee_per_adult_egp),
         access_fee_per_teen_egp = COALESCE($34, access_fee_per_teen_egp),
         access_card_count_included = COALESCE($35, access_card_count_included),
         cleaning_fee_egp = $36,
         updated_at = now()
       WHERE id = $37 RETURNING *`,
      [
        toText(b.title || b.name),
        listingStatus,
        toText(b.compound || b.project || b.projectName),
        toText(b.project || b.projectName || b.compound),
        toText(b.area || b.destination),
        toNum(b.beds ?? b.bedrooms, { int: true }),
        toNum(b.baths ?? b.bathrooms, { int: true }),
        toNum(b.guests || b.capacity, { int: true }),
        toNum(b.size_m2 || b.area_sqft, { int: true }),
        coverUrl,
        photoUrls,
        amenities,
        otherDetails,
        b.short_description !== undefined ? toText(b.short_description) : null,
        b.the_property !== undefined || b.description !== undefined
          ? toText(b.the_property || b.description)
          : null,
        b.owner_name !== undefined ? toText(b.owner_name) : null,
        b.owner_email !== undefined ? toText(b.owner_email) : null,
        b.owner_phone !== undefined ? toText(b.owner_phone) : null,
        b.commission_mode || null,
        toNum(b.company_commission_pct),
        toNum(b.company_commission_owner_pct),
        toNum(b.commission_tenant_pct),
        toNum(b.utilities_cost),
        opsStatus,
        b.unit_number !== undefined ? toText(b.unit_number) : null,
        b.internal_code !== undefined ? toText(b.internal_code) : null,
        b.price_per_night !== undefined || b.price_fallback !== undefined
          ? toNum(b.price_per_night ?? b.price_fallback, { int: true })
          : null,
        toText(b.property_type || b.type),
        b.view !== undefined ? toText(b.view) : null,
        b.floor != null && b.floor !== '' ? String(b.floor) : null,
        b.location_link !== undefined || b.source_url !== undefined
          ? toText(b.location_link || b.source_url)
          : null,
        toNum(b.min_nights, { int: true }),
        beachPrice,
        beachExtra,
        beachDays,
        cleaningFee,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const synced = await syncUnitListingStatus(req.params.id, {
      requestedStatus: listingStatus || rows[0].status,
    });
    const payload = mapUnitRow(synced || rows[0]);
    if (synced?._completeness) {
      payload.listing_completeness = {
        complete: synced._completeness.complete,
        missing: synced._completeness.missing,
        status: synced.status,
      };
    }
    res.json(payload);
  } catch (e) {
    next(e);
  }
}

router.patch('/units/:id', requireRoles('admin', 'resale'), updateUnitHandler);
router.put('/units/:id', requireRoles('admin', 'resale'), updateUnitHandler);

router.delete('/units/:id', requireRoles('admin', 'resale'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE units SET status = 'archived', ops_status = 'maintenance', updated_at = now()
       WHERE id = $1 RETURNING id, status`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/units/:id/photos', requireRoles('admin', 'resale'), upload.array('photos', 20), attachCloudinaryUrls, async (req, res, next) => {
  try {
    const urls = (req.files || []).map((f) => f.path || f.secure_url).filter(Boolean);
    const { rows } = await query(
      `UPDATE units SET
         photo_urls = photo_urls || $1::text[],
         cover_url = COALESCE(cover_url, $2),
         updated_at = now()
       WHERE id = $3 RETURNING id, cover_url, photo_urls`,
      [urls, urls[0] || null, req.params.id]
    );
    const synced = await syncUnitListingStatus(req.params.id);
    res.json({
      ...(rows[0] || {}),
      status: synced?.status,
      listing_completeness: synced?._completeness,
    });
  } catch (e) {
    next(e);
  }
});

// ── Daily prices → unit_daily_prices ────────────────────────
router.get('/daily-prices/:unitId', async (req, res, next) => {
  try {
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [req.params.unitId]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const { rows } = await query(
      `SELECT date::text AS date, price, currency, source FROM unit_daily_prices
       WHERE wp_post_id = $1 ORDER BY date`,
      [u[0].wp_post_id]
    );
    res.json(rows.map((r) => ({ ...r, unit_id: req.params.unitId, wp_post_id: u[0].wp_post_id })));
  } catch (e) {
    next(e);
  }
});

router.put('/daily-prices/:unitId', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [req.params.unitId]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const items = Array.isArray(req.body) ? req.body : req.body.items || [];
    for (const item of items) {
      if (item.clear || item.price == null || Number(item.price) <= 0) {
        await query(`DELETE FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`, [
          u[0].wp_post_id,
          item.date,
        ]);
        continue;
      }
      await query(
        `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ($1,$2,$3,COALESCE($4,'EGP'),COALESCE($5,'manual-admin'),now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price, currency = EXCLUDED.currency, source = EXCLUDED.source, updated_at = now()`,
        [u[0].wp_post_id, item.date, item.price, item.currency, item.source || 'manual-admin']
      );
    }
    await syncUnitListingStatus(req.params.unitId);
    res.json({ ok: true, count: items.length });
  } catch (e) {
    next(e);
  }
});

// ── Reservations ────────────────────────────────────────────
router.get('/reservations', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.*,
              u.title AS unit_title,
              u.slug AS unit_slug,
              u.unit_number,
              u.compound AS project,
              COALESCE(
                NULLIF(r.id_photo_urls, '{}'),
                NULLIF(b.id_photo_urls, '{}'),
                (
                  SELECT ARRAY(
                    SELECT jsonb_array_elements_text(ccs.payload->'photo_urls')
                  )
                  FROM card_checkout_sessions ccs
                  WHERE ccs.booking_id = r.booking_id
                    AND jsonb_typeof(ccs.payload->'photo_urls') = 'array'
                  LIMIT 1
                ),
                '{}'::text[]
              ) AS id_photo_urls
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN bookings b ON b.id = r.booking_id
       WHERE r.status <> 'cancelled'
       ORDER BY r.created_at DESC
       LIMIT 200`
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/reservations', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
    const b = req.body;
    const checkIn = new Date(b.check_in);
    const checkOut = new Date(b.check_out);
    const nights = Math.max(1, Math.round((checkOut - checkIn) / 86400000));
    const pricePerNight = parseFloat(b.price_per_night) || (nights > 0 ? (parseFloat(b.total_amount) || 0) / nights : 0);
    const utilitiesOverride = b.utilities_cost_override !== '' && b.utilities_cost_override != null
      ? parseFloat(b.utilities_cost_override)
      : null;
    let utilitiesAmount = parseFloat(b.utilities_amount) || 0;
    let housekeepingFees = 0;
    if (b.unit_id) {
      const { rows: units } = await query(
        `SELECT utilities_cost, property_type FROM units WHERE id = $1`,
        [b.unit_id]
      );
      const { housekeepingFeeForUnit } = require('../../lib/housekeeping');
      housekeepingFees = housekeepingFeeForUnit(units[0]);
      if (!utilitiesAmount) {
        const costPerNight = utilitiesOverride != null && !Number.isNaN(utilitiesOverride)
          ? utilitiesOverride
          : parseFloat(units[0]?.utilities_cost) || 0;
        if (costPerNight > 0 && !b.is_owner_reservation) {
          utilitiesAmount = costPerNight * nights;
        }
      }
    }

    const { rows } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, guest_email, guest_phone, guest_nationality,
         check_in, check_out, nights, total_amount, amount_paid, payment_status,
         booking_source, sales_person_id, is_owner_reservation, status, notes, created_by,
         booking_id, price_per_night, housekeeping_fees, insurance, down_payment,
         utilities_amount, utilities_cost_override
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'pending'),$12,$13,COALESCE($14,0),COALESCE($15,'confirmed'),$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        b.unit_id,
        b.guest_name,
        b.guest_email,
        b.guest_phone,
        b.guest_nationality,
        b.check_in,
        b.check_out,
        nights,
        b.total_amount,
        b.amount_paid || 0,
        b.payment_status,
        b.booking_source,
        b.sales_person_id || req.user.id,
        b.is_owner_reservation ? 1 : 0,
        b.status,
        b.notes,
        req.user.id,
        b.booking_id || null,
        pricePerNight,
        housekeepingFees,
        parseFloat(b.insurance) || 0,
        parseFloat(b.down_payment) || 0,
        utilitiesAmount,
        utilitiesOverride,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/reservations/:id', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
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

router.delete('/reservations/:id', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { rows: existing } = await query(
      `SELECT id, booking_id FROM reservations WHERE id = $1`,
      [id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const bookingId = existing[0].booking_id;

    await query(`DELETE FROM commissions WHERE reservation_id = $1`, [id]);
    await query(`DELETE FROM payments WHERE reservation_id = $1`, [id]);
    await query(
      `UPDATE petty_cash SET linked_reservation_id = NULL WHERE linked_reservation_id = $1`,
      [id]
    );
    const { rows } = await query(`DELETE FROM reservations WHERE id = $1 RETURNING *`, [id]);

    // Free guest calendar / My Trips / public iCal for linked website bookings
    if (bookingId) {
      const { cancelWebsiteBooking } = require('../../services/bookingWorkflow');
      await cancelWebsiteBooking(bookingId, req.body?.cancel_type
        ? `cancelled_by_staff:${req.body.cancel_type}`
        : 'cancelled_by_staff');
    }

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/reservations/:id/cancel-request', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const { rows } = await query(
      `UPDATE reservations SET
         status = 'cancelled',
         notes = CASE
           WHEN $1::text IS NULL OR $1 = '' THEN notes
           ELSE COALESCE(notes || E'\n', '') || ('Cancel request: ' || $1)
         END,
         updated_at = now()
       WHERE id = $2 AND status <> 'cancelled'
       RETURNING *`,
      [reason || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    if (rows[0].booking_id) {
      const { cancelWebsiteBooking } = require('../../services/bookingWorkflow');
      await cancelWebsiteBooking(rows[0].booking_id, reason || 'cancel_request');
    }

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/reservations/:id/reject-cancel', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE reservations SET
         status = 'confirmed',
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // Restore linked website booking so guest calendar / trips stay consistent
    if (rows[0].booking_id) {
      await query(
        `UPDATE bookings SET
           status = 'confirmed',
           hold_expires_at = NULL,
           cancellation_reason = NULL
         WHERE id = $1 AND status = 'cancelled'`,
        [rows[0].booking_id]
      );
    }

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/reservations/schedule', async (req, res, next) => {
  try {
    const from =
      req.query.from_date ||
      req.query.from ||
      new Date().toISOString().slice(0, 10);
    const to =
      req.query.to_date ||
      req.query.to ||
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const { bedrooms, project } = req.query;

    const unitWhere = [`COALESCE(status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')`];
    const unitParams = [];
    let i = 1;
    if (bedrooms !== undefined && bedrooms !== '') {
      unitWhere.push(`beds = $${i++}`);
      unitParams.push(Number(bedrooms));
    }
    if (project) {
      unitWhere.push(`(project ILIKE $${i} OR compound ILIKE $${i})`);
      unitParams.push(project);
      i++;
    }

    const { rows: unitRows } = await query(
      `SELECT id, slug, title, status, ops_status, compound, project, area, beds, baths, guests,
              size_m2, floor, view, property_type, wp_post_id, cover_url, unit_number,
              internal_code, price_fallback, other_details, min_nights
       FROM units
       WHERE ${unitWhere.join(' AND ')}
       ORDER BY COALESCE(project, compound), title`,
      unitParams
    );
    const units = unitRows.map(mapUnitRow);
    const unitIds = units.map((u) => u.id);
    if (unitIds.length === 0) return res.json({ units: [], reservations: [] });

    const { rows: reservations } = await query(
      `SELECT r.id, r.unit_id, r.guest_name, r.guest_email, r.guest_phone, r.guest_nationality,
              r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights,
              r.total_amount, r.amount_paid, r.payment_status, r.booking_source,
              r.sales_person_id, r.is_owner_reservation, r.status, r.notes, r.booking_id,
              r.hold_expires_at, r.created_by, r.created_at,
              CASE
                WHEN r.hold_expires_at IS NOT NULL AND r.hold_expires_at > now()
                     AND r.status IN ('pending', 'hold') THEN 1
                ELSE 0
              END AS is_hold,
              r.hold_expires_at AS hold_until,
              sp.full_name AS sales_person_name,
              u.title AS unit_title,
              'pms' AS source
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
       WHERE r.status NOT IN ('cancelled')
         AND r.check_in < $1::date
         AND r.check_out > $2::date
         AND r.unit_id = ANY($3::uuid[])
       ORDER BY r.check_in`,
      [to, from, unitIds]
    );

    // Overlay website bookings so reserved nights from the guest site appear too
    const { rows: webBookings } = await query(
      `SELECT b.id, COALESCE(b.unit_id, u.id) AS unit_id,
              COALESCE(NULLIF(b.guest_name, ''), 'Website guest') AS guest_name,
              b.guest_email, b.guest_phone,
              b.checkin::text AS check_in, b.checkout::text AS check_out,
              GREATEST(1, (b.checkout - b.checkin)) AS nights,
              COALESCE(b.total_egp, 0) AS total_amount,
              0 AS amount_paid,
              b.payment_status, b.status,
              CASE WHEN b.status IN ('pending', 'held') THEN 1 ELSE 0 END AS is_hold,
              b.hold_expires_at AS hold_until,
              u.title AS unit_title,
              'website' AS source
       FROM bookings b
       LEFT JOIN units u ON u.id = b.unit_id OR (b.unit_id IS NULL AND u.wp_post_id = b.listing_wp_id)
       WHERE b.status IN ('confirmed', 'pending', 'held')
         AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now())
         AND b.checkin < $1::date
         AND b.checkout > $2::date
         AND COALESCE(b.unit_id, u.id) = ANY($3::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.booking_id = b.id AND r.status <> 'cancelled'
         )
       ORDER BY b.checkin`,
      [to, from, unitIds]
    ).catch(() => ({ rows: [] }));

    const seen = new Set(reservations.map((r) => `${r.unit_id}:${r.check_in}:${r.check_out}:${r.guest_name}`));
    for (const b of webBookings) {
      const key = `${b.unit_id}:${b.check_in}:${b.check_out}:${b.guest_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reservations.push({
        ...b,
        id: `web-${b.id}`,
        is_owner_reservation: 0,
        sales_person_name: null,
        booking_source: 'website',
      });
    }

    res.json({ units, reservations });
  } catch (e) {
    next(e);
  }
});

// ── Payments ────────────────────────────────────────────────
router.get('/payments', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `COALESCE(payment_date, created_at::date) >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND COALESCE(payment_date, created_at::date) <= $${params.length}::date`;
    }
    const { rows } = await query(
      `SELECT * FROM payments WHERE ${where} ORDER BY payment_date DESC NULLS LAST, created_at DESC LIMIT 200`,
      params
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/payments', requireRoles('admin'), upload.single('document'), attachCloudinaryUrls, async (req, res, next) => {
  try {
    const b = req.body;
    const doc = req.file?.path || req.file?.secure_url || null;
    const { rows } = await query(
      `INSERT INTO payments (
         reservation_id, booking_id, amount, payment_date, payment_method,
         reference_number, notes, document_path, document_name, created_by, status
       ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10,'pending')
       RETURNING *`,
      [
        b.reservation_id || null,
        b.booking_id || null,
        b.amount,
        b.payment_date,
        b.payment_method,
        b.reference_number,
        b.notes,
        doc,
        req.file?.originalname || null,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/payments/:id/approve', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE payments SET is_approved = 1, approved_by = $1, approved_at = now(), status = 'successful'
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// ── Expenses / commissions / dashboard snippets ─────────────
router.get('/expenses', async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `COALESCE(expense_date, created_at::date) >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND COALESCE(expense_date, created_at::date) <= $${params.length}::date`;
    }
    if (req.query.unit_id) {
      params.push(req.query.unit_id);
      where += ` AND unit_id = $${params.length}`;
    }
    if (req.query.paid_by) {
      params.push(req.query.paid_by);
      where += ` AND paid_by = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC NULLS LAST, created_at DESC LIMIT 200`,
      params
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/expenses', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO expenses (unit_id, description, amount, paid_by, expense_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.unit_id, b.description, b.amount, b.paid_by, b.expense_date, b.notes, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/commissions', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, s.full_name FROM commissions c
       JOIN staff_users s ON s.id = c.user_id
       ORDER BY c.created_at DESC LIMIT 200`
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const role = req.user?.role;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const calendarMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthStart = clampFromDate(calendarMonthStart);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().slice(0, 10);

    const [
      totalUnitsRes,
      checkinsRes,
      checkoutsRes,
      upcomingRes,
      projectStatsRes,
      recentRes,
    ] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS cnt FROM units
         WHERE COALESCE(status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')`
      ),
      query(
        `SELECT r.id, r.guest_name,
                COALESCE(u.title, u.unit_number, 'Unit') AS unit_name,
                u.unit_number,
                COALESCE(u.project, u.compound, 'Unassigned') AS project
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE r.check_in = $1::date
           AND r.status IN ('confirmed', 'pending', 'checked_in')
         ORDER BY COALESCE(u.project, u.compound), u.title`,
        [today]
      ),
      query(
        `SELECT r.id, r.guest_name,
                COALESCE(u.title, u.unit_number, 'Unit') AS unit_name,
                u.unit_number,
                COALESCE(u.project, u.compound, 'Unassigned') AS project
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE r.check_out = $1::date
           AND r.status IN ('confirmed', 'checked_in')
         ORDER BY COALESCE(u.project, u.compound), u.title`,
        [today]
      ),
      query(
        `SELECT COUNT(*)::int AS cnt
         FROM reservations
         WHERE check_in BETWEEN $1::date AND $2::date
           AND status IN ('confirmed', 'pending')`,
        [today, nextWeekStr]
      ),
      query(
        `SELECT
           COALESCE(u.project, u.compound, 'Unassigned') AS project,
           COUNT(DISTINCT u.id)::int AS total_units,
           COUNT(DISTINCT CASE WHEN r.status <> 'cancelled' THEN r.id END)::int AS total_reservations,
           COUNT(DISTINCT CASE
             WHEN r.status IN ('confirmed', 'checked_in')
              AND r.check_in <= CURRENT_DATE
              AND r.check_out > CURRENT_DATE
             THEN u.id
           END)::int AS occupied_units
         FROM units u
         LEFT JOIN reservations r ON r.unit_id = u.id
         WHERE COALESCE(u.status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')
         GROUP BY COALESCE(u.project, u.compound, 'Unassigned')
         ORDER BY COALESCE(u.project, u.compound, 'Unassigned')`
      ),
      query(
        `SELECT r.id, r.guest_name, r.check_in, r.check_out,
                r.total_amount, r.payment_status, r.status,
                COALESCE(u.title, u.unit_number, 'Unit') AS unit_name
         FROM reservations r
         LEFT JOIN units u ON u.id = r.unit_id
         WHERE r.status <> 'cancelled'
         ORDER BY r.created_at DESC
         LIMIT 6`
      ),
    ]);

    const projectStats = projectStatsRes.rows.map((p) => {
      const total = Number(p.total_units) || 0;
      const occupied = Number(p.occupied_units) || 0;
      return {
        project: p.project,
        total_units: total,
        total_reservations: Number(p.total_reservations) || 0,
        occupied_units: occupied,
        occupancy_pct: total > 0 ? Math.round((occupied / total) * 100) : 0,
      };
    });

    const totalReservations = projectStats.reduce((s, p) => s + p.total_reservations, 0);

    let finance = null;
    let monthlyRevenue = [];
    if (role === 'admin') {
      // Before books open, show zeros for this month
      const booksOpen = today >= FINANCIAL_EPOCH;
      const [monthRevenue, monthPaid, pendingPayments] = await Promise.all([
        booksOpen
          ? query(
              `SELECT COALESCE(SUM(total_amount), 0)::float AS total
               FROM reservations
               WHERE status <> 'cancelled' AND check_in >= $1::date`,
              [monthStart]
            )
          : Promise.resolve({ rows: [{ total: 0 }] }),
        booksOpen
          ? query(
              `SELECT COALESCE(SUM(amount), 0)::float AS total
               FROM payments
               WHERE payment_date >= $1::date
                 AND status IN ('successful', 'pending')`,
              [monthStart]
            )
          : Promise.resolve({ rows: [{ total: 0 }] }),
        query(
          `SELECT COALESCE(SUM(GREATEST(total_amount - COALESCE(amount_paid, 0), 0)), 0)::float AS total
           FROM reservations
           WHERE payment_status <> 'paid' AND status <> 'cancelled'
             AND check_in >= $1::date`,
          [FINANCIAL_EPOCH]
        ),
      ]);

      finance = {
        monthRevenue: Number(monthRevenue.rows[0].total) || 0,
        monthPaid: Number(monthPaid.rows[0].total) || 0,
        pendingPayments: Number(pendingPayments.rows[0].total) || 0,
      };

      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const start = `${y}-${m}-01`;
        if (start < FINANCIAL_EPOCH) {
          monthlyRevenue.push({ month: `${y}-${m}`, revenue: 0 });
          continue;
        }
        const lastDay = new Date(y, d.getMonth() + 1, 0).toISOString().slice(0, 10);
        const rev = await query(
          `SELECT COALESCE(SUM(total_amount), 0)::float AS total
           FROM reservations
           WHERE status <> 'cancelled'
             AND check_in BETWEEN $1::date AND $2::date`,
          [start, lastDay]
        );
        monthlyRevenue.push({ month: `${y}-${m}`, revenue: Number(rev.rows[0].total) || 0 });
      }
    }

    res.json({
      units: { total: Number(totalUnitsRes.rows[0].cnt) || 0 },
      reservations: { total: totalReservations },
      finance,
      calendar: {
        upcomingCheckins: Number(upcomingRes.rows[0].cnt) || 0,
        checkinsToday: checkinsRes.rows,
        checkoutsToday: checkoutsRes.rows,
        checkinsCount: checkinsRes.rows.length,
        checkoutsCount: checkoutsRes.rows.length,
      },
      projectStats,
      monthlyRevenue,
      recentReservations: recentRes.rows,
    });
  } catch (e) {
    next(e);
  }
});

// ── HR / tasks / petty cash / cash ledger / audit / owner ──
router.get('/hr/employees', requireRoles('admin', 'hr'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM employees ORDER BY name`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/employees', requireRoles('admin', 'hr'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO employees (name, phone, salary_system, base_salary, performance_pct)
       VALUES ($1,$2,$3,$4,COALESCE($5,40)) RETURNING *`,
      [b.name, b.phone, b.salary_system, b.base_salary, b.performance_pct]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/tasks', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks ORDER BY created_at DESC`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/tasks', async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO tasks (title, description, priority, status, assigned_to, created_by, due_date)
       VALUES ($1,$2,COALESCE($3,'medium'),COALESCE($4,'not_started'),$5,$6,$7) RETURNING *`,
      [b.title, b.description, b.priority, b.status, b.assigned_to, req.user.id, b.due_date]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/petty-cash', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const location = req.query.location;
    const params = [from];
    let sql = `SELECT * FROM petty_cash WHERE entry_date >= $1::date`;
    if (location) {
      params.push(location);
      sql += ` AND location = $${params.length}`;
    }
    sql += ' ORDER BY entry_date DESC, created_at DESC LIMIT 200';
    const { rows } = await query(sql, params);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/petty-cash', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO petty_cash (location, description, amount, entry_type, entry_date, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6) RETURNING *`,
      [b.location, b.description, b.amount, b.entry_type, b.entry_date, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/cashflow', requireRoles('admin'), async (req, res, next) => {
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
      `SELECT entry_type, sum(amount)::real AS total FROM cash_ledger WHERE ${where} GROUP BY entry_type`,
      params
    );
    const { rows: recent } = await query(
      `SELECT * FROM cash_ledger WHERE ${where} ORDER BY entry_date DESC LIMIT 50`,
      params
    );
    res.json({ summary: rows, recent });
  } catch (e) {
    next(e);
  }
});

router.post('/treasury', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO cash_ledger (entry_type, category, description, amount, entry_date, reference, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7) RETURNING *`,
      [b.entry_type, b.category, b.description, b.amount, b.entry_date, b.reference, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/audit', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.get('/owner-units/mine', requireRoles('admin'), async (req, res, next) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : req.query.owner_id || req.user.id;
    const { rows } = await query(
      `SELECT u.* FROM owner_units ou JOIN units u ON u.id = ou.unit_id WHERE ou.owner_id = $1`,
      [ownerId]
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/owner-units', requireRoles('admin'), async (req, res, next) => {
  try {
    const { owner_id, unit_id } = req.body;
    const { rows } = await query(
      `INSERT INTO owner_units (owner_id, unit_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING *`,
      [owner_id, unit_id]
    );
    res.status(201).json(rows[0] || { ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM notifications WHERE user_id = $1 OR user_id IS NULL
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.get('/inquiries', requireRoles('admin', 'reservations'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 200`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.get('/guest-bookings', requireRoles('admin', 'reservations'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM bookings ORDER BY created_at DESC LIMIT 200`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/pricing/sync', async (req, res, next) => {
  try {
    const secret = req.headers['x-pricing-sync-secret'];
    if (secret !== process.env.PRICING_SYNC_SECRET && req.user.role !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const items = req.body.items || req.body;
    let n = 0;
    for (const item of items) {
      await query(
        `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ($1,$2,$3,COALESCE($4,'EGP'),COALESCE($5,'scraper'),now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
        [item.wp_post_id, item.date, item.price, item.currency, item.source]
      );
      n++;
    }
    res.json({ upserted: n });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
