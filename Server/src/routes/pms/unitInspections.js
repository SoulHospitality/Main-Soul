const crypto = require('crypto');
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { notifyStaff } = require('../../services/pmsNotifications');
const {
  FOLDER_INSPECTIONS,
  INSPECTION_PLAYBACK_TRANSFORM,
  signDirectUpload,
  parseCloudinaryDeliveryUrl,
  destroyCloudinaryVideo,
} = require('../../config/cloudinary');

const router = express.Router();

const OPS_AGENT = 'operations';
const OPS_SUPER = 'operations_supervisor';
const INSPECTION_ROLES = ['admin', OPS_AGENT, OPS_SUPER];
const INSPECTION_SUPER_ROLES = ['admin', OPS_SUPER];

/** Units created on/after this Cairo date need an inspection; older units were already operating. */
const INSPECTION_START_DATE = process.env.UNIT_INSPECTION_START_DATE || '2026-10-05';

const MAX_CHECKLIST_ITEMS = 300;
const MAX_LABEL_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HIDDEN_UNIT_KEY =
  /price|fee|_egp$|commission|deposit|currency|payout|revenue|pricing_model|discount|rating|review_count|scrape|wp_post|ical|consecutive|failure|discovery|source/i;

const NEW_UNIT_SCOPE = `(i.id IS NOT NULL OR (timezone('Africa/Cairo', u.created_at))::date >= $1::date)`;

const LIST_SELECT = `
  SELECT u.id AS unit_id,
         u.unit_number,
         u.title AS unit_title,
         COALESCE(u.project, u.compound) AS project,
         u.area,
         u.property_type,
         u.beds,
         u.baths,
         u.guests,
         u.cover_url,
         u.listing_type,
         u.status AS unit_status,
         u.created_at AS unit_created_at,
         u.has_nanny_room,
         adder.full_name AS unit_added_by_name,
         i.id AS inspection_id,
         i.status AS inspection_status,
         i.assigned_to,
         i.assigned_at,
         i.checklist,
         i.checklist_submitted_at,
         i.checklist_approved_at,
         i.manager_note,
         i.video_url,
         i.agent_notes,
         i.completed_at,
         agent.full_name AS assignee_name,
         agent.staff_code AS assignee_code,
         approver.full_name AS approved_by_name,
         completer.full_name AS completed_by_name
  FROM units u
  LEFT JOIN unit_inspections i ON i.unit_id = u.id
  LEFT JOIN staff_users agent ON agent.id = i.assigned_to
  LEFT JOIN staff_users approver ON approver.id = i.checklist_approved_by
  LEFT JOIN staff_users completer ON completer.id = i.completed_by
  LEFT JOIN staff_users adder ON adder.id = u.created_by_staff
`;

function isSupervisor(user) {
  return user?.role === 'admin' || user?.role === OPS_SUPER;
}

function mapRow(row) {
  return {
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    unit_title: row.unit_title,
    project: row.project,
    area: row.area,
    property_type: row.property_type,
    beds: row.beds,
    baths: row.baths,
    guests: row.guests,
    cover_url: row.cover_url,
    listing_type: row.listing_type,
    unit_status: row.unit_status,
    unit_created_at: row.unit_created_at,
    has_nanny_room: !!row.has_nanny_room,
    unit_added_by_name: row.unit_added_by_name || null,
    inspection_id: row.inspection_id || null,
    status: row.inspection_status || 'unassigned',
    assigned_to: row.assigned_to || null,
    assigned_at: row.assigned_at || null,
    assignee_name: row.assignee_name || null,
    assignee_code: row.assignee_code || null,
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    checklist_submitted_at: row.checklist_submitted_at || null,
    checklist_approved_at: row.checklist_approved_at || null,
    approved_by_name: row.approved_by_name || null,
    manager_note: row.manager_note || null,
    video_url: row.video_url || null,
    agent_notes: row.agent_notes || null,
    completed_at: row.completed_at || null,
    completed_by_name: row.completed_by_name || null,
  };
}

async function loadByUnit(unitId) {
  const { rows } = await query(`${LIST_SELECT} WHERE u.id = $1`, [unitId]);
  return rows[0] || null;
}

async function loadByInspection(inspectionId) {
  const { rows } = await query(`${LIST_SELECT} WHERE i.id = $1`, [inspectionId]);
  return rows[0] || null;
}

function isNewUnit(row) {
  if (!row) return false;
  if (row.inspection_id) return true;
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(row.unit_created_at));
  return created >= INSPECTION_START_DATE;
}

function assertCanAct(req, row) {
  if (isSupervisor(req.user)) return null;
  if (req.user.role !== OPS_AGENT) return 'Forbidden';
  if (!row.assigned_to || Number(row.assigned_to) !== Number(req.user.id)) {
    return 'This inspection is not assigned to you';
  }
  return null;
}

function cleanLabel(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
}

function newItemId() {
  return crypto.randomBytes(6).toString('hex');
}

/** Normalize submitted items, keeping ids/authorship of items already on the checklist. */
function buildChecklist(rawItems, existing, addedBy) {
  if (!Array.isArray(rawItems)) return { error: 'items must be an array' };
  const byId = new Map((existing || []).map((it) => [String(it.id), it]));
  const items = [];
  for (const raw of rawItems) {
    const label = cleanLabel(typeof raw === 'string' ? raw : raw?.label);
    if (!label) continue;
    const prev = raw && typeof raw === 'object' && raw.id != null ? byId.get(String(raw.id)) : null;
    const qty = Number(raw?.qty);
    items.push({
      id: prev ? prev.id : newItemId(),
      section: cleanLabel(raw?.section) || 'General',
      label,
      qty: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
      brand: cleanLabel(raw?.brand) || null,
      added_by: prev ? prev.added_by : addedBy,
      result: null,
      note: null,
    });
  }
  if (!items.length) return { error: 'Add at least one checklist item' };
  if (items.length > MAX_CHECKLIST_ITEMS) {
    return { error: `A checklist can have at most ${MAX_CHECKLIST_ITEMS} items` };
  }
  return { items };
}

function unitLabel(row) {
  return [row.unit_number || row.unit_title || 'Unit', row.project].filter(Boolean).join(' · ');
}

async function supervisorIds() {
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE role = $1 AND is_active = 1`,
    [OPS_SUPER]
  );
  return rows.map((r) => r.id);
}

router.get('/ops/inspections', requireRoles(...INSPECTION_ROLES), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'open').toLowerCase();
    const params = [INSPECTION_START_DATE];
    let scope = '';
    if (!isSupervisor(req.user)) {
      params.push(req.user.id);
      scope = ` AND i.assigned_to = $${params.length}`;
    }

    let statusFilter = '';
    if (status === 'open') statusFilter = ` AND (i.id IS NULL OR i.status <> 'completed')`;
    else if (status === 'unassigned') statusFilter = ' AND i.id IS NULL';
    else if (['assigned', 'checklist_submitted', 'checklist_approved', 'completed'].includes(status)) {
      params.push(status);
      statusFilter = ` AND i.status = $${params.length}`;
    }

    const { rows } = await query(
      `${LIST_SELECT}
       WHERE ${NEW_UNIT_SCOPE} ${scope} ${statusFilter}
       ORDER BY (i.status = 'completed') ASC NULLS FIRST,
                COALESCE(i.completed_at, u.created_at) DESC
       LIMIT 500`,
      params
    );

    const { rows: countRows } = await query(
      `SELECT COALESCE(i.status, 'unassigned') AS status, COUNT(*)::int AS n
       FROM units u
       LEFT JOIN unit_inspections i ON i.unit_id = u.id
       WHERE ${NEW_UNIT_SCOPE} ${scope}
       GROUP BY 1`,
      params.slice(0, isSupervisor(req.user) ? 1 : 2)
    );
    const counts = Object.fromEntries(countRows.map((r) => [r.status, r.n]));

    res.json({ status, start_date: INSPECTION_START_DATE, counts, items: rows.map(mapRow) });
  } catch (e) {
    next(e);
  }
});

router.get('/ops/inspections/unit/:unitId', requireRoles(...INSPECTION_ROLES), async (req, res, next) => {
  try {
    const unitId = String(req.params.unitId || '');
    if (!UUID_RE.test(unitId)) return res.status(400).json({ error: 'Invalid unit id' });

    const row = await loadByUnit(unitId);
    if (!row || !isNewUnit(row)) return res.status(404).json({ error: 'Unit not found' });
    const denied = assertCanAct(req, row);
    if (denied) return res.status(403).json({ error: denied });

    const { rows: unitRows } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
    const unit = {};
    for (const [key, value] of Object.entries(unitRows[0] || {})) {
      if (!HIDDEN_UNIT_KEY.test(key)) unit[key] = value;
    }

    const { rows: owners } = await query(
      `SELECT s.id, s.full_name
       FROM owner_units ou
       JOIN staff_users s ON s.id = ou.owner_id
       WHERE ou.unit_id = $1
       ORDER BY s.full_name`,
      [unitId]
    );

    res.json({ unit, portal_owners: owners, inspection: mapRow(row) });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/inspections/unit/:unitId/assign',
  requireRoles(...INSPECTION_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const unitId = String(req.params.unitId || '');
      if (!UUID_RE.test(unitId)) return res.status(400).json({ error: 'Invalid unit id' });
      const staffId = Number(req.body?.staff_id);
      if (!Number.isFinite(staffId) || staffId <= 0) {
        return res.status(400).json({ error: 'Select an operations agent' });
      }

      const row = await loadByUnit(unitId);
      if (!row || !isNewUnit(row)) return res.status(404).json({ error: 'Unit not found' });
      if (row.inspection_status === 'completed') {
        return res.status(409).json({ error: 'This unit has already been inspected' });
      }

      const { rows: agents } = await query(
        `SELECT id FROM staff_users WHERE id = $1 AND role = $2 AND is_active = 1`,
        [staffId, OPS_AGENT]
      );
      if (!agents[0]) return res.status(400).json({ error: 'Select an active operations agent' });

      const { rows } = await query(
        `INSERT INTO unit_inspections (unit_id, status, assigned_to, assigned_by, assigned_at)
         VALUES ($1, 'assigned', $2, $3, now())
         ON CONFLICT (unit_id) DO UPDATE SET
           assigned_to = EXCLUDED.assigned_to,
           assigned_by = EXCLUDED.assigned_by,
           assigned_at = now(),
           updated_at = now()
         RETURNING id`,
        [unitId, staffId, req.user.id]
      );
      const inspectionId = rows[0].id;

      await logAudit({
        userId: req.user.id,
        action: 'UNIT_INSPECTION_ASSIGN',
        entityType: 'unit_inspection',
        entityId: inspectionId,
        details: { unit_id: unitId, staff_id: staffId },
      });

      if (Number(row.assigned_to) !== staffId) {
        await notifyStaff({
          userIds: [staffId],
          excludeUserIds: [req.user.id],
          type: 'unit_inspection_assigned',
          title: 'New unit inspection assigned',
          message: `${unitLabel(row)} — prepare the inspection checklist`,
          entity_type: 'unit_inspection',
          entity_id: inspectionId,
        });
      }

      res.json(mapRow(await loadByInspection(inspectionId)));
    } catch (e) {
      next(e);
    }
  }
);

router.put('/ops/inspections/:id/checklist', requireRoles(OPS_AGENT), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadByInspection(id);
    if (!row) return res.status(404).json({ error: 'Inspection not found' });
    const denied = assertCanAct(req, row);
    if (denied) return res.status(403).json({ error: denied });
    if (!['assigned', 'checklist_submitted'].includes(row.inspection_status)) {
      return res.status(409).json({ error: 'The checklist is already approved' });
    }

    const built = buildChecklist(req.body?.items, row.checklist, 'agent');
    if (built.error) return res.status(400).json({ error: built.error });

    await query(
      `UPDATE unit_inspections SET
         checklist = $2::jsonb,
         status = 'checklist_submitted',
         checklist_submitted_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(built.items)]
    );

    await logAudit({
      userId: req.user.id,
      action: 'UNIT_INSPECTION_CHECKLIST_SUBMIT',
      entityType: 'unit_inspection',
      entityId: id,
      details: { items: built.items.length },
    });

    await notifyStaff({
      userIds: await supervisorIds(),
      excludeUserIds: [req.user.id],
      type: 'unit_inspection_checklist',
      title: 'Inspection checklist awaiting approval',
      message: `${unitLabel(row)} — ${built.items.length} items by ${req.user.full_name || 'agent'}`,
      entity_type: 'unit_inspection',
      entity_id: id,
    });

    res.json(mapRow(await loadByInspection(id)));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/inspections/:id/approve-checklist',
  requireRoles(...INSPECTION_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const row = await loadByInspection(id);
      if (!row) return res.status(404).json({ error: 'Inspection not found' });
      if (row.inspection_status !== 'checklist_submitted') {
        return res.status(409).json({ error: 'There is no submitted checklist to approve' });
      }

      const built = buildChecklist(req.body?.items, row.checklist, 'manager');
      if (built.error) return res.status(400).json({ error: built.error });
      const note = String(req.body?.note || '').trim().slice(0, MAX_NOTE_LENGTH) || null;

      await query(
        `UPDATE unit_inspections SET
           checklist = $2::jsonb,
           status = 'checklist_approved',
           checklist_approved_by = $3,
           checklist_approved_at = now(),
           manager_note = $4,
           updated_at = now()
         WHERE id = $1`,
        [id, JSON.stringify(built.items), req.user.id, note]
      );

      const added = built.items.filter((it) => it.added_by === 'manager').length;
      await logAudit({
        userId: req.user.id,
        action: 'UNIT_INSPECTION_CHECKLIST_APPROVE',
        entityType: 'unit_inspection',
        entityId: id,
        details: { items: built.items.length, manager_items: added },
      });

      if (row.assigned_to) {
        await notifyStaff({
          userIds: [row.assigned_to],
          excludeUserIds: [req.user.id],
          type: 'unit_inspection_approved',
          title: 'Inspection checklist approved',
          message: `${unitLabel(row)} — go inspect the unit and upload the video`,
          entity_type: 'unit_inspection',
          entity_id: id,
        });
      }

      res.json(mapRow(await loadByInspection(id)));
    } catch (e) {
      next(e);
    }
  }
);

function parseInspectionVideo(inspectionId, rawUrl) {
  const videoUrl = String(rawUrl || '').trim();
  const info = parseCloudinaryDeliveryUrl(videoUrl);
  if (
    !info ||
    info.resourceType !== 'video' ||
    !info.publicId.startsWith(`${FOLDER_INSPECTIONS}/insp-${inspectionId}-`)
  ) {
    return null;
  }
  return { videoUrl, publicId: info.publicId };
}

router.post('/ops/inspections/:id/video-upload', requireRoles(...INSPECTION_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadByInspection(id);
    if (!row) return res.status(404).json({ error: 'Inspection not found' });
    const denied = assertCanAct(req, row);
    if (denied) return res.status(403).json({ error: denied });
    if (row.inspection_status === 'completed') {
      return res.status(409).json({ error: 'This inspection is already finished' });
    }
    if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(503).json({ error: 'Video uploads are not configured' });
    }
    res.json(
      signDirectUpload({
        folder: FOLDER_INSPECTIONS,
        publicId: `insp-${id}-${Date.now()}`,
        eager: `${INSPECTION_PLAYBACK_TRANSFORM}/mp4`,
      })
    );
  } catch (e) {
    next(e);
  }
});

/** Attach an uploaded video to an inspection that is still in progress (replaces any earlier one). */
router.post('/ops/inspections/:id/video', requireRoles(...INSPECTION_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadByInspection(id);
    if (!row) return res.status(404).json({ error: 'Inspection not found' });
    const denied = assertCanAct(req, row);
    if (denied) return res.status(403).json({ error: denied });
    if (row.inspection_status === 'completed') {
      return res.status(409).json({ error: 'This inspection is already finished' });
    }
    const video = parseInspectionVideo(id, req.body?.video_url);
    if (!video) return res.status(400).json({ error: 'Invalid inspection video' });

    const { rows: prev } = await query(`SELECT video_public_id FROM unit_inspections WHERE id = $1`, [id]);
    await query(
      `UPDATE unit_inspections SET video_url = $2, video_public_id = $3, updated_at = now() WHERE id = $1`,
      [id, video.videoUrl, video.publicId]
    );
    const oldId = prev[0]?.video_public_id;
    if (oldId && oldId !== video.publicId) await destroyCloudinaryVideo(oldId);

    await logAudit({
      userId: req.user.id,
      action: 'UNIT_INSPECTION_VIDEO',
      entityType: 'unit_inspection',
      entityId: id,
      details: { replaced: !!oldId },
    });

    res.json(mapRow(await loadByInspection(id)));
  } catch (e) {
    next(e);
  }
});

router.post('/ops/inspections/:id/complete', requireRoles(...INSPECTION_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadByInspection(id);
    if (!row) return res.status(404).json({ error: 'Inspection not found' });
    const denied = assertCanAct(req, row);
    if (denied) return res.status(403).json({ error: denied });
    if (row.inspection_status !== 'checklist_approved') {
      return res.status(409).json({ error: 'The checklist must be approved before finishing' });
    }

    const video = parseInspectionVideo(id, req.body?.video_url || row.video_url);
    if (!video) {
      return res.status(400).json({ error: 'Upload the inspection video before finishing' });
    }

    const results = new Map(
      (Array.isArray(req.body?.results) ? req.body.results : []).map((r) => [String(r?.id), r])
    );
    const checklist = (Array.isArray(row.checklist) ? row.checklist : []).map((item) => {
      const r = results.get(String(item.id)) || {};
      const result = r.result === 'ok' || r.result === 'issue' ? r.result : null;
      const note = String(r.note || '').trim().slice(0, MAX_NOTE_LENGTH) || null;
      return { ...item, result, note };
    });
    const missing = checklist.filter((it) => !it.result);
    if (missing.length) {
      return res.status(400).json({
        error: `Mark every checklist item as OK or Issue (${missing.length} left)`,
      });
    }
    const issueWithoutNote = checklist.find((it) => it.result === 'issue' && !it.note);
    if (issueWithoutNote) {
      return res.status(400).json({ error: `Describe the issue for "${issueWithoutNote.label}"` });
    }
    const notes = String(req.body?.notes || '').trim().slice(0, MAX_NOTE_LENGTH) || null;

    await query(
      `UPDATE unit_inspections SET
         checklist = $2::jsonb,
         status = 'completed',
         video_url = $3,
         video_public_id = $4,
         agent_notes = $5,
         completed_by = $6,
         completed_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(checklist), video.videoUrl, video.publicId, notes, req.user.id]
    );

    const issues = checklist.filter((it) => it.result === 'issue').length;
    await logAudit({
      userId: req.user.id,
      action: 'UNIT_INSPECTION_COMPLETE',
      entityType: 'unit_inspection',
      entityId: id,
      details: { unit_id: row.unit_id, items: checklist.length, issues },
    });

    const summary = issues ? `${issues} issue${issues === 1 ? '' : 's'} found` : 'no issues found';
    await notifyStaff({
      userIds: await supervisorIds(),
      excludeUserIds: [req.user.id],
      type: 'unit_inspection_completed',
      title: 'Unit inspection completed',
      message: `${unitLabel(row)} — ${summary}. Video uploaded.`,
      entity_type: 'unit_inspection',
      entity_id: id,
    });

    const { rows: owners } = await query(
      `SELECT ou.owner_id
       FROM owner_units ou
       JOIN staff_users s ON s.id = ou.owner_id
       WHERE ou.unit_id = $1 AND s.role = 'owner'`,
      [row.unit_id]
    );
    await notifyStaff({
      userIds: owners.map((o) => o.owner_id),
      type: 'owner_unit_inspection',
      title: 'Your unit has been inspected',
      message: `${unitLabel(row)} — watch the inspection video in Inspections`,
      entity_type: 'unit_inspection',
      entity_id: id,
    });

    res.json(mapRow(await loadByInspection(id)));
  } catch (e) {
    next(e);
  }
});

/** Completed inspections (video + checklist) for the signed-in owner's units. */
router.get('/owner/inspections', requireRoles('owner'), async (req, res, next) => {
  try {
    const params = [];
    let scope = '';
    if (req.user.role === 'owner') {
      params.push(req.user.id);
      scope = ` AND EXISTS (
        SELECT 1 FROM owner_units ou WHERE ou.unit_id = u.id AND ou.owner_id = $1
      )`;
    }
    const { rows } = await query(
      `${LIST_SELECT}
       WHERE i.status = 'completed' ${scope}
       ORDER BY i.completed_at DESC
       LIMIT 200`,
      params
    );

    let unread = 0;
    if (req.user.role === 'owner') {
      const { rows: n } = await query(
        `SELECT COUNT(*)::int AS n FROM notifications
         WHERE user_id = $1 AND type = 'owner_unit_inspection' AND COALESCE(is_read, 0) = 0`,
        [req.user.id]
      );
      unread = n[0]?.n || 0;
    }

    res.json({
      unread,
      items: rows.map((r) => {
        const m = mapRow(r);
        return {
          inspection_id: m.inspection_id,
          unit_id: m.unit_id,
          unit_number: m.unit_number,
          unit_title: m.unit_title,
          project: m.project,
          cover_url: m.cover_url,
          completed_at: m.completed_at,
          inspected_by: m.completed_by_name,
          video_url: m.video_url,
          notes: m.agent_notes,
          checklist: m.checklist.map((it) => ({
            id: it.id,
            section: it.section || null,
            label: it.label,
            qty: it.qty ?? null,
            brand: it.brand || null,
            result: it.result,
            note: it.note,
          })),
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/owner/inspections/mark-seen', requireRoles('owner'), async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET is_read = 1
       WHERE user_id = $1 AND type = 'owner_unit_inspection' AND COALESCE(is_read, 0) = 0`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
