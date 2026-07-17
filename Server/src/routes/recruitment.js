const express = require('express');
const { query } = require('../config/db');
const { upload, attachCloudinaryUrls } = require('../config/cloudinary');
const { authStaff, requireRoles } = require('../middleware/auth');

const router = express.Router();

const STATUS_OPTIONS = ['Pending', 'Reviewed', 'Shortlisted', 'Rejected'];
const staffRecruitment = [authStaff, requireRoles('admin', 'hr')];

function normalizeStatus(value) {
  const raw = String(value || 'Pending').trim();
  const map = {
    new: 'Pending',
    pending: 'Pending',
    reviewing: 'Reviewed',
    reviewed: 'Reviewed',
    interview: 'Shortlisted',
    shortlisted: 'Shortlisted',
    hired: 'Shortlisted',
    rejected: 'Rejected',
  };
  const key = raw.toLowerCase();
  if (STATUS_OPTIONS.includes(raw)) return raw;
  return map[key] || 'Pending';
}

router.get('/jobs', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM jobs WHERE is_open = true ORDER BY created_at DESC`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', ...staffRecruitment, async (req, res, next) => {
  try {
    const { title, description, department, location, requirements, is_open } = req.body || {};
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }
    const { rows } = await query(
      `INSERT INTO jobs (title, description, department, location, requirements, is_open)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,true))
       RETURNING *`,
      [
        String(title).trim(),
        String(description).trim(),
        department || null,
        location || null,
        requirements || null,
        is_open !== undefined ? Boolean(is_open) : true,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/jobs/:id', ...staffRecruitment, async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM jobs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/applications', ...staffRecruitment, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*,
              j.title AS job_title,
              j.department AS job_department,
              j.location AS job_location
       FROM job_applications a
       LEFT JOIN jobs j ON j.id = a.job_id
       ORDER BY a.created_at DESC
       LIMIT 500`
    );
    res.json({
      items: rows.map((r) => ({
        ...r,
        status: normalizeStatus(r.status),
        cvUrl: r.resume_url,
        fullName: r.full_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', ...staffRecruitment, async (_req, res, next) => {
  try {
    const { rows: byStatus } = await query(
      `SELECT status, count(*)::int AS c FROM job_applications GROUP BY status`
    );
    const { rows: jobs } = await query(
      `SELECT count(*)::int AS open_jobs FROM jobs WHERE is_open = true`
    );
    const { rows: total } = await query(
      `SELECT count(*)::int AS total FROM job_applications`
    );
    const { rows: recent } = await query(
      `SELECT a.id, a.full_name, a.email, a.status, a.created_at, j.title AS job_title
       FROM job_applications a
       LEFT JOIN jobs j ON j.id = a.job_id
       ORDER BY a.created_at DESC
       LIMIT 5`
    );
    res.json({
      openJobs: jobs[0]?.open_jobs || 0,
      totalApplications: total[0]?.total || 0,
      byStatus: byStatus.map((r) => ({ ...r, status: normalizeStatus(r.status) })),
      recent,
    });
  } catch (err) {
    next(err);
  }
});

const applyUpload = upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'cv', maxCount: 1 },
]);

router.post('/apply', applyUpload, attachCloudinaryUrls, async (req, res, next) => {
  try {
    const file =
      (req.files?.resume && req.files.resume[0]) ||
      (req.files?.cv && req.files.cv[0]) ||
      req.file ||
      null;

    const jobId = req.body.job_id || req.body.jobId || null;
    const fullName = req.body.full_name || req.body.fullName;
    const email = req.body.email;
    const phone = req.body.phone || null;
    const coverLetter = req.body.cover_letter || req.body.coverLetter || null;
    const resumeUrl = file?.path || file?.secure_url || null;

    if (!fullName || !email) {
      return res.status(400).json({ error: 'Full name and email are required' });
    }
    if (!resumeUrl) {
      return res.status(400).json({ error: 'CV / resume file is required' });
    }
    if (jobId) {
      const { rows: jobs } = await query(`SELECT id FROM jobs WHERE id = $1 AND is_open = true`, [
        jobId,
      ]);
      if (!jobs[0]) return res.status(404).json({ error: 'Job not found or closed' });
    }

    const { rows } = await query(
      `INSERT INTO job_applications (job_id, full_name, email, phone, resume_url, cover_letter, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Pending') RETURNING *`,
      [jobId, fullName, email, phone, resumeUrl, coverLetter]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/applications/:id/status', ...staffRecruitment, async (req, res, next) => {
  try {
    const status = normalizeStatus(req.body?.status);
    if (!STATUS_OPTIONS.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUS_OPTIONS.join(', ')}` });
    }
    const { rows } = await query(
      `UPDATE job_applications SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...rows[0],
      status: normalizeStatus(rows[0].status),
      cvUrl: rows[0].resume_url,
      fullName: rows[0].full_name,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/applications/:id', ...staffRecruitment, async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM job_applications WHERE id = $1 RETURNING id`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
