const crypto = require('crypto');

function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
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
