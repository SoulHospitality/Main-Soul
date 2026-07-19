const express = require('express');
const { query } = require('../config/db');
const { authStaff, requireRoles } = require('../middleware/auth');
const { normalizeProjectName } = require('../lib/projectNames');

const router = express.Router();

function normalizeText(value) {
  return String(value || '').trim();
}

function buildCatalog(rows) {
  const destinations = [];
  const projectsByDestination = {};
  const seenDest = new Set();

  for (const row of rows) {
    const destination = row.destination;
    const name = normalizeProjectName(row.name);
    if (!destination || !name) continue;
    if (!seenDest.has(destination)) {
      seenDest.add(destination);
      destinations.push(destination);
    }
    if (!projectsByDestination[destination]) projectsByDestination[destination] = [];
    if (!projectsByDestination[destination].includes(name)) {
      projectsByDestination[destination].push(name);
    }
  }

  destinations.sort((a, b) => a.localeCompare(b));
  for (const key of Object.keys(projectsByDestination)) {
    projectsByDestination[key].sort((a, b) => a.localeCompare(b));
  }

  return { destinations, projectsByDestination };
}

/** GET /api/projects — distinct destination names (SoulHospitality-compatible) */
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT destination
       FROM location_projects
       ORDER BY destination`
    );
    res.json({
      success: true,
      data: rows.map((r) => r.destination),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/projects/catalog — destinations + projectsByDestination */
router.get('/catalog', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, destination, name, image_url, sort_order
       FROM location_projects
       ORDER BY sort_order ASC, destination ASC, name ASC`
    );
    const catalog = buildCatalog(rows);
    res.json({
      success: true,
      data: {
        ...catalog,
        items: rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/projects — create destination/project mapping (staff) */
router.post('/', authStaff, requireRoles('admin', 'resale'), async (req, res, next) => {
  try {
    const destination = normalizeText(req.body?.destination || req.body?.city);
    const name = normalizeProjectName(
      normalizeText(req.body?.name || req.body?.projectName || req.body?.project)
    );
    if (!destination || !name) {
      return res.status(400).json({ error: 'destination and name are required' });
    }

    const normalizedDestination = destination.toLowerCase();
    const normalizedName = name.toLowerCase();

    const existing = await query(
      `SELECT id FROM location_projects
       WHERE normalized_destination = $1 AND normalized_name = $2`,
      [normalizedDestination, normalizedName]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'This destination/project mapping already exists' });
    }

    await query(
      `INSERT INTO location_projects
         (destination, name, normalized_destination, normalized_name, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        destination,
        name,
        normalizedDestination,
        normalizedName,
        req.body?.image_url || null,
        Number(req.body?.sort_order) || 0,
      ]
    );

    const { rows } = await query(
      `SELECT id, destination, name, image_url, sort_order
       FROM location_projects
       ORDER BY sort_order ASC, destination ASC, name ASC`
    );
    res.status(201).json({
      success: true,
      data: {
        ...buildCatalog(rows),
        items: rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/projects/destination/:destination — remove all projects under a destination */
router.delete(
  '/destination/:destination',
  authStaff,
  requireRoles('admin', 'resale'),
  async (req, res, next) => {
    try {
      const destination = normalizeText(decodeURIComponent(req.params.destination));
      if (!destination) {
        return res.status(400).json({ error: 'destination is required' });
      }

      const del = await query(
        `DELETE FROM location_projects
         WHERE normalized_destination = lower($1)
         RETURNING id, destination, name`,
        [destination]
      );

      if (!del.rows.length) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      // Count units still labeled with this area (catalog gone; units may remain until reassigned)
      const unitsRes = await query(
        `SELECT count(*)::int AS c FROM units WHERE lower(trim(area)) = lower($1)`,
        [destination]
      );

      const { rows } = await query(
        `SELECT id, destination, name, image_url, sort_order
         FROM location_projects
         ORDER BY sort_order ASC, destination ASC, name ASC`
      );
      res.json({
        success: true,
        data: {
          ...buildCatalog(rows),
          items: rows,
          deletedCount: del.rows.length,
          unitsStillTagged: unitsRes.rows[0]?.c || 0,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /api/projects/:id — remove one project mapping */
router.delete('/:id', authStaff, requireRoles('admin', 'resale'), async (req, res, next) => {
  try {
    await query(`DELETE FROM location_projects WHERE id = $1`, [req.params.id]);
    const { rows } = await query(
      `SELECT id, destination, name, image_url, sort_order
       FROM location_projects
       ORDER BY sort_order ASC, destination ASC, name ASC`
    );
    res.json({ success: true, data: { ...buildCatalog(rows), items: rows } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
