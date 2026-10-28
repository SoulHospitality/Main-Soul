function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Collected payments stay. A refund is cash out. A forfeit keeps the cash and
 * lets the ledger recognise the deposit as income.
 */
function resolveCancelSettlement({ cancelType, settlement, refundAmount, collected } = {}) {
  const collectedAmt = round2(Math.max(0, Number(collected) || 0));
  let choice = String(settlement || '').toLowerCase();
  if (!['full_refund', 'partial_refund', 'forfeit'].includes(choice)) {
    const type = String(cancelType || '').toLowerCase();
    if (type === 'non_refundable' || type === 'forfeit') choice = 'forfeit';
    else if (type === 'refundable') {
      const specified = refundAmount != null && refundAmount !== '';
      choice = specified ? 'partial_refund' : 'full_refund';
    } else choice = '';
  }
  if (!choice) {
    const err = new Error('Choose a full refund, a partial refund, or a forfeit');
    err.status = 400;
    throw err;
  }

  let refund = 0;
  if (choice === 'full_refund') refund = collectedAmt;
  if (choice === 'partial_refund') {
    refund = round2(refundAmount);
    if (!(refund > 0)) {
      const err = new Error('Enter the refund amount');
      err.status = 400;
      throw err;
    }
    if (refund - collectedAmt > 0.009) {
      const err = new Error('Refund cannot exceed the amount collected');
      err.status = 400;
      throw err;
    }
  }

  return {
    choice,
    refund,
    kept: round2(Math.max(0, collectedAmt - refund)),
    collected: collectedAmt,
  };
}

/** Prepaid left to forfeit after refunds. */
function forfeitBase(prepaid, refunded) {
  return round2(Math.max(0, (Number(prepaid) || 0) - (Number(refunded) || 0)));
}

module.exports = { resolveCancelSettlement, forfeitBase, round2 };
