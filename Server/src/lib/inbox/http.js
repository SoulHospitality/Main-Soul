class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (msg, code) => new HttpError(400, msg, code);
const forbidden = (msg = 'Not allowed') => new HttpError(403, msg, 'forbidden');
const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');

function int(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw badRequest(`Invalid ${name}`);
  return n;
}

function preview(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Normalise Egyptian / international phone numbers to digits with country code (e.g. 201001234567). */
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = `2${d}`;
  if (/^1[0125]\d{8}$/.test(d)) d = `20${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Last 10 digits: matches the same mobile whether stored as 010…, +2010… or 2010…. */
function phoneTail(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-10) : null;
}

/** Express 4 does not catch async errors; this also maps HttpError to its status. */
function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch((err) => {
        if (err instanceof HttpError) {
          if (!res.headersSent) res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        next(err);
      });
  };
}

module.exports = { HttpError, badRequest, forbidden, notFound, int, preview, normalizePhone, phoneTail, wrap };
