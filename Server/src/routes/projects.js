const express = require('express');
const { query } = require('../config/db');
const { authStaff, requireRoles } = require('../middleware/auth');
const { normalizeProjectName } = require('../lib/projectNames');
const {
  parseMinNightsValue,
  DEFAULT_MIN_STAY_NIGHTS,
  syncUnitsMinNightsForProject,
} = require('../lib/minStay');
const {
  upload,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  destroyCloudinaryUrl,
  FOLDER_PROJECTS,
} = require('../config/cloudinary');

const router = express.Router();

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFacilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || '').trim()).filter(Boolean))];
}

function parseFacilitiesBody(raw) {
  if (Array.isArray(raw)) return normalizeFacilities(raw);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeFacilities(parsed);
    } catch {
      return normalizeFacilities(raw.split(','));
    }
  }
  return [];
}

function uploadedImageUrl(req) {
  return req.file?.secure_url || req.file?.path || null;
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

async function loadCatalogRows() {
  const { rows } = await query(
    `SELECT id, destination, name, image_url, sort_order,
            COALESCE(facilities, '{}'::text[]) AS facilities,
            COALESCE(min_nights, ${DEFAULT_MIN_STAY_NIGHTS}) AS min_nights
     FROM location_projects
     ORDER BY sort_order ASC, destination ASC, name ASC`
  );
  return rows;
}

function catalogResponse(rows) {
  return {
    success: true,
    data: {
      ...buildCatalog(rows),
      items: rows,
    },
  };
}


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


router.get('/catalog', async (_req, res, next) => {
  try {
    const rows = await loadCatalogRows();
    res.json(catalogResponse(rows));
  } catch (err) {
    next(err);
  }
});


router.post(
  '/',
  authStaff,
  requireRoles('admin', 'resale', 'resale_manager'),
  setCloudinaryFolder(FOLDER_PROJECTS),
  upload.single('image'),
  attachCloudinaryUrls,
  async (req, res, next) => {
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
      const facilities = parseFacilitiesBody(req.body?.facilities);
      const imageUrl = uploadedImageUrl(req) || normalizeText(req.body?.image_url) || null;
      const minNights = parseMinNightsValue(
        req.body?.min_nights ?? req.body?.minNights,
        DEFAULT_MIN_STAY_NIGHTS
      );

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
           (destination, name, normalized_destination, normalized_name, image_url, sort_order, facilities, min_nights)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          destination,
          name,
          normalizedDestination,
          normalizedName,
          imageUrl,
          Number(req.body?.sort_order) || 0,
          facilities,
          minNights,
        ]
      );

      await syncUnitsMinNightsForProject({ name, minNights });

      res.status(201).json(catalogResponse(await loadCatalogRows()));
    } catch (err) {
      next(err);
    }
  }
);


router.put(
  '/:id',
  authStaff,
  requireRoles('admin', 'resale', 'resale_manager'),
  setCloudinaryFolder(FOLDER_PROJECTS),
  upload.single('image'),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const id = req.params.id;
      const { rows: existing } = await query(`SELECT * FROM location_projects WHERE id = $1`, [id]);
      if (!existing[0]) return res.status(404).json({ error: 'Project not found' });

      const facilities =
        req.body?.facilities !== undefined ? parseFacilitiesBody(req.body.facilities) : null;
      const name = req.body?.name
        ? normalizeProjectName(normalizeText(req.body.name))
        : null;
      const minNightsRaw = req.body?.min_nights ?? req.body?.minNights;
      const minNights =
        minNightsRaw !== undefined && minNightsRaw !== null && minNightsRaw !== ''
          ? parseMinNightsValue(minNightsRaw, existing[0].min_nights || DEFAULT_MIN_STAY_NIGHTS)
          : null;

      const uploaded = uploadedImageUrl(req);
      let imageUrl = existing[0].image_url;
      let imageChanged = false;
      if (uploaded) {
        imageUrl = uploaded;
        imageChanged = true;
      } else if (req.body?.image_url !== undefined) {
        imageUrl = normalizeText(req.body.image_url) || null;
        imageChanged = imageUrl !== existing[0].image_url;
      } else if (req.body?.clear_image === '1' || req.body?.clear_image === true) {
        imageUrl = null;
        imageChanged = true;
      }

      await query(
        `UPDATE location_projects SET
           name = COALESCE($2, name),
           normalized_name = COALESCE(lower($2), normalized_name),
           image_url = CASE WHEN $3::boolean THEN $4 ELSE image_url END,
           facilities = COALESCE($5, facilities),
           min_nights = COALESCE($6, min_nights),
           updated_at = now()
         WHERE id = $1`,
        [id, name, imageChanged, imageUrl, facilities, minNights]
      );

      if (
        imageChanged &&
        existing[0].image_url &&
        existing[0].image_url !== imageUrl &&
        String(existing[0].image_url).includes('res.cloudinary.com')
      ) {
        try {
          await destroyCloudinaryUrl(existing[0].image_url, { allowFolders: [FOLDER_PROJECTS] });
        } catch (_) {}
      }

      const nextName = name || existing[0].name;
      const nextMin = minNights != null ? minNights : Number(existing[0].min_nights) || DEFAULT_MIN_STAY_NIGHTS;
      if (minNights != null || (name && name !== existing[0].name)) {
        await syncUnitsMinNightsForProject({
          name: nextName,
          previousName: existing[0].name,
          minNights: nextMin,
        });
      }

      res.json(catalogResponse(await loadCatalogRows()));
    } catch (err) {
      next(err);
    }
  }
);


router.delete(
  '/destination/:destination',
  authStaff,
  requireRoles('admin', 'resale', 'resale_manager'),
  async (req, res, next) => {
    try {
      const destination = normalizeText(decodeURIComponent(req.params.destination));
      if (!destination) {
        return res.status(400).json({ error: 'destination is required' });
      }

      const del = await query(
        `DELETE FROM location_projects
         WHERE normalized_destination = lower($1)
         RETURNING id, destination, name, image_url`,
        [destination]
      );

      if (!del.rows.length) {
        return res.status(404).json({ error: 'Destination not found' });
      }

      for (const row of del.rows) {
        if (row.image_url && String(row.image_url).includes('res.cloudinary.com')) {
          try {
            await destroyCloudinaryUrl(row.image_url, { allowFolders: [FOLDER_PROJECTS] });
          } catch (_) {
            
          }
        }
      }

      const unitsRes = await query(
        `SELECT count(*)::int AS c FROM units WHERE lower(trim(area)) = lower($1)`,
        [destination]
      );

      const rows = await loadCatalogRows();
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


router.delete('/:id', authStaff, requireRoles('admin', 'resale', 'resale_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM location_projects WHERE id = $1 RETURNING image_url`,
      [req.params.id]
    );
    if (rows[0]?.image_url && String(rows[0].image_url).includes('res.cloudinary.com')) {
      try {
        await destroyCloudinaryUrl(rows[0].image_url, { allowFolders: [FOLDER_PROJECTS] });
      } catch (_) {}
    }
    res.json(catalogResponse(await loadCatalogRows()));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
