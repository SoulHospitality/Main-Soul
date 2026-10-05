const express = require('express');
const { query, pool } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { notifyStaff } = require('../../services/pmsNotifications');

const router = express.Router();

/** Staff who handle owner comments (admin always passes requireRoles). */
const COMMENT_STAFF_ROLES = ['owners_relations', 'unit_acquisition_agent', 'unit_acquisition_manager'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SUBJECT = 200;
const MAX_BODY = 4000;

const THREAD_SELECT = `
  SELECT t.*,
         o.full_name AS owner_name,
         o.email AS owner_email,
         u.unit_number,
         u.title AS unit_title,
         COALESCE(u.project, u.compound) AS project,
         resolver.full_name AS resolved_by_name,
         (SELECT COUNT(*)::int FROM owner_comment_messages m WHERE m.thread_id = t.id) AS message_count,
         (SELECT m.body FROM owner_comment_messages m
           WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
  FROM owner_comment_threads t
  JOIN staff_users o ON o.id = t.owner_id
  LEFT JOIN units u ON u.id = t.unit_id
  LEFT JOIN staff_users resolver ON resolver.id = t.resolved_by
`;

function mapThread(row, viewer) {
  const readAt = viewer === 'owner' ? row.owner_last_read_at : row.staff_last_read_at;
  const otherSide = viewer === 'owner' ? 'staff' : 'owner';
  const unread =
    row.last_message_from === otherSide &&
    (!readAt || new Date(row.last_message_at) > new Date(readAt));
  return {
    id: row.id,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    owner_email: viewer === 'owner' ? undefined : row.owner_email,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    unit_title: row.unit_title,
    project: row.project,
    subject: row.subject,
    status: row.status,
    last_message: row.last_message ? String(row.last_message).slice(0, 160) : '',
    last_message_at: row.last_message_at,
    last_message_from: row.last_message_from,
    message_count: Number(row.message_count) || 0,
    resolved_at: row.resolved_at,
    resolved_by_name: row.resolved_by_name || null,
    created_at: row.created_at,
    unread,
  };
}

async function loadMessages(threadId, viewer) {
  const { rows } = await query(
    `SELECT m.id, m.body, m.from_owner, m.created_at, m.author_id, s.full_name AS author_name, s.role AS author_role
     FROM owner_comment_messages m
     JOIN staff_users s ON s.id = m.author_id
     WHERE m.thread_id = $1
     ORDER BY m.created_at ASC, m.id ASC`,
    [threadId]
  );
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    from_owner: m.from_owner,
    created_at: m.created_at,
    author_name: m.author_name,
    author_role: viewer === 'owner' ? undefined : m.author_role,
  }));
}

async function loadThread(id) {
  const { rows } = await query(`${THREAD_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}

function cleanBody(raw) {
  return String(raw || '').trim().slice(0, MAX_BODY);
}

function threadLabel(row) {
  const unit = row.unit_number || row.unit_title;
  return unit ? `${unit} · ${row.subject}` : row.subject;
}

async function addMessage({ threadId, authorId, fromOwner, body, resolve = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO owner_comment_messages (thread_id, author_id, from_owner, body)
       VALUES ($1, $2, $3, $4)`,
      [threadId, authorId, fromOwner, body]
    );
    await client.query(
      `UPDATE owner_comment_threads SET
         last_message_at = now(),
         last_message_from = $2,
         ${fromOwner ? 'owner_last_read_at = now()' : 'staff_last_read_at = now()'},
         status = $3::text,
         resolved_by = CASE WHEN $3::text = 'resolved' THEN $4::int ELSE NULL END,
         resolved_at = CASE WHEN $3::text = 'resolved' THEN now() ELSE NULL END
       WHERE id = $1`,
      [threadId, fromOwner ? 'owner' : 'staff', resolve ? 'resolved' : 'open', authorId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Staff (Owner Experience + Unit Acquisition)
// ---------------------------------------------------------------------------

router.get('/owner-comments', requireRoles(...COMMENT_STAFF_ROLES), async (req, res, next) => {
  try {
    const status = String(req.query.status || 'open').toLowerCase();
    const q = String(req.query.q || '').trim();
    const params = [];
    const where = ['TRUE'];
    if (status === 'open' || status === 'resolved') {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(
        `(t.subject ILIKE ${p} OR o.full_name ILIKE ${p} OR COALESCE(u.unit_number, '') ILIKE ${p} OR COALESCE(u.project, u.compound, '') ILIKE ${p})`
      );
    }
    const { rows } = await query(
      `${THREAD_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY t.last_message_at DESC
       LIMIT 300`,
      params
    );

    const { rows: countRows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int AS open,
         COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
         COUNT(*) FILTER (
           WHERE last_message_from = 'owner'
             AND (staff_last_read_at IS NULL OR last_message_at > staff_last_read_at)
         )::int AS unread
       FROM owner_comment_threads`
    );

    res.json({ counts: countRows[0], items: rows.map((r) => mapThread(r, 'staff')) });
  } catch (e) {
    next(e);
  }
});

router.get('/owner-comments/:id', requireRoles(...COMMENT_STAFF_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadThread(id);
    if (!row) return res.status(404).json({ error: 'Comment not found' });
    await query(`UPDATE owner_comment_threads SET staff_last_read_at = now() WHERE id = $1`, [id]);
    res.json({
      thread: mapThread({ ...row, staff_last_read_at: new Date() }, 'staff'),
      messages: await loadMessages(id, 'staff'),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/owner-comments/:id/reply', requireRoles(...COMMENT_STAFF_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadThread(id);
    if (!row) return res.status(404).json({ error: 'Comment not found' });
    const body = cleanBody(req.body?.body);
    if (!body) return res.status(400).json({ error: 'Write a reply first' });

    await addMessage({
      threadId: id,
      authorId: req.user.id,
      fromOwner: false,
      body,
      resolve: req.body?.resolve === true,
    });

    await notifyStaff({
      userIds: [row.owner_id],
      type: 'owner_comment_reply',
      title: 'Soul replied to your comment',
      message: `${threadLabel(row)} — ${body.slice(0, 120)}`,
      entity_type: 'owner_comment',
      entity_id: id,
    });

    const updated = await loadThread(id);
    res.json({ thread: mapThread(updated, 'staff'), messages: await loadMessages(id, 'staff') });
  } catch (e) {
    next(e);
  }
});

router.post('/owner-comments/:id/status', requireRoles(...COMMENT_STAFF_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status === 'resolved' ? 'resolved' : 'open';
    const { rowCount } = await query(
      `UPDATE owner_comment_threads SET
         status = $2::text,
         resolved_by = CASE WHEN $2::text = 'resolved' THEN $3::int ELSE NULL END,
         resolved_at = CASE WHEN $2::text = 'resolved' THEN now() ELSE NULL END
       WHERE id = $1`,
      [id, status, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Comment not found' });
    res.json(mapThread(await loadThread(id), 'staff'));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Owner portal
// ---------------------------------------------------------------------------

function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Only owners can use owner comments' });
  next();
}

router.get('/owner/comments', requireOwner, async (req, res, next) => {
  try {
    const { rows } = await query(
      `${THREAD_SELECT} WHERE t.owner_id = $1 ORDER BY t.last_message_at DESC LIMIT 200`,
      [req.user.id]
    );
    const items = rows.map((r) => mapThread(r, 'owner'));
    res.json({ unread: items.filter((t) => t.unread).length, items });
  } catch (e) {
    next(e);
  }
});

router.get('/owner/comments/:id', requireOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadThread(id);
    if (!row || Number(row.owner_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    await query(`UPDATE owner_comment_threads SET owner_last_read_at = now() WHERE id = $1`, [id]);
    res.json({
      thread: mapThread({ ...row, owner_last_read_at: new Date() }, 'owner'),
      messages: await loadMessages(id, 'owner'),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/owner/comments', requireOwner, async (req, res, next) => {
  try {
    const subject = String(req.body?.subject || '').trim().slice(0, MAX_SUBJECT);
    const body = cleanBody(req.body?.body);
    const unitId = req.body?.unit_id ? String(req.body.unit_id) : null;
    if (!subject) return res.status(400).json({ error: 'Add a subject' });
    if (!body) return res.status(400).json({ error: 'Write your comment' });

    if (unitId) {
      if (!UUID_RE.test(unitId)) return res.status(400).json({ error: 'Invalid unit' });
      const { rows } = await query(
        `SELECT 1 FROM owner_units WHERE owner_id = $1 AND unit_id = $2`,
        [req.user.id, unitId]
      );
      if (!rows[0]) return res.status(403).json({ error: 'You can only comment on your own units' });
    }

    const client = await pool.connect();
    let threadId;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO owner_comment_threads
           (owner_id, unit_id, subject, last_message_from, owner_last_read_at)
         VALUES ($1, $2, $3, 'owner', now())
         RETURNING id`,
        [req.user.id, unitId, subject]
      );
      threadId = rows[0].id;
      await client.query(
        `INSERT INTO owner_comment_messages (thread_id, author_id, from_owner, body)
         VALUES ($1, $2, true, $3)`,
        [threadId, req.user.id, body]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const row = await loadThread(threadId);
    await notifyStaff({
      roles: COMMENT_STAFF_ROLES,
      type: 'owner_comment_new',
      title: `New comment from ${row.owner_name || 'an owner'}`,
      message: threadLabel(row),
      entity_type: 'owner_comment',
      entity_id: threadId,
    });

    res.status(201).json({ thread: mapThread(row, 'owner'), messages: await loadMessages(threadId, 'owner') });
  } catch (e) {
    next(e);
  }
});

router.post('/owner/comments/:id/reply', requireOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await loadThread(id);
    if (!row || Number(row.owner_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    const body = cleanBody(req.body?.body);
    if (!body) return res.status(400).json({ error: 'Write a reply first' });

    await addMessage({ threadId: id, authorId: req.user.id, fromOwner: true, body });

    await notifyStaff({
      roles: COMMENT_STAFF_ROLES,
      type: 'owner_comment_new',
      title: `${row.owner_name || 'An owner'} replied`,
      message: `${threadLabel(row)} — ${body.slice(0, 120)}`,
      entity_type: 'owner_comment',
      entity_id: id,
    });

    const updated = await loadThread(id);
    res.json({ thread: mapThread(updated, 'owner'), messages: await loadMessages(id, 'owner') });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
