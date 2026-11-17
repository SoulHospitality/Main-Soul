const crypto = require('crypto');

// Database errors caused by the request itself (a malformed id, a bad date or number in the URL): the
// caller's mistake, not a server failure, so they answer 400 instead of 500.
const BAD_INPUT_PG_CODES = new Set(['22P02', '22007', '22008', '22003']);

function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || (BAD_INPUT_PG_CODES.has(err.code) ? 400 : 500);
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    return res.status(status).json({
      error: 'Something went wrong. Quote this id if you contact support.',
      request_id: requestId,
    });
  }
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(status >= 500 ? { request_id: requestId } : {}),
    ...(process.env.NODE_ENV !== 'production' && status >= 500 && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = { errorHandler };
