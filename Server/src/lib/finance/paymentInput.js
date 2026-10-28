function assertCollectionAmount(value) {
  const submittedAmount = Number(value);
  if (!Number.isFinite(submittedAmount) || submittedAmount <= 0) {
    const err = new Error('Amount must be greater than zero');
    err.status = 400;
    throw err;
  }
  if (Math.abs(submittedAmount * 100 - Math.round(submittedAmount * 100)) > 0.001) {
    const err = new Error('Amount can have at most 2 decimal places');
    err.status = 400;
    throw err;
  }
  return submittedAmount;
}

function normalizeIdempotencyKey(header) {
  return String(header || '').trim().slice(0, 80);
}

module.exports = { assertCollectionAmount, normalizeIdempotencyKey };
