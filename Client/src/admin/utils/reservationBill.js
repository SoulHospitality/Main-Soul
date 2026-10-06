function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Utilities are part of the nightly rate, so they are never added on top of the bill. */
export function reservationBill(r) {
  const nights = Number(r?.nights) || 0;
  const pricePerNight = parseFloat(r?.price_per_night) || 0;
  const accommodation = pricePerNight > 0 && nights > 0 ? round2(pricePerNight * nights) : 0;
  const storedTotal = parseFloat(r?.total_amount) || 0;
  const hkFees = parseFloat(r?.housekeeping_fees) || 0;
  const beachFees = parseFloat(r?.beach_access_fees) || 0;
  const ins = parseFloat(r?.insurance) || 0;
  const lineSum = round2(accommodation + hkFees + beachFees + ins);
  const total =
    accommodation > 0 && Math.abs(storedTotal - accommodation) <= 0.5
      ? lineSum
      : Math.max(storedTotal, lineSum);
  const ownerCollected = parseFloat(r?.owner_collected_amount) || 0;
  const downPayment = parseFloat(r?.down_payment) || 0;
  const paid = Math.max(downPayment, parseFloat(r?.amount_paid) || 0);

  let toCollect;
  if (r?.owner_collected_type === 'full') toCollect = hkFees + ins - paid;
  else if (r?.owner_collected_type === 'partial') toCollect = total - ownerCollected - paid;
  else toCollect = total - paid;
  toCollect = String(r?.status || '').toLowerCase() === 'cancelled' ? 0 : Math.max(0, round2(toCollect));

  return {
    nights,
    pricePerNight,
    accommodation,
    storedTotal,
    hkFees,
    beachFees,
    ins,
    total,
    ownerCollected,
    downPayment,
    paid,
    toCollect,
    remainingAccommodation: Math.max(0, round2(toCollect - hkFees - beachFees - ins)),
  };
}
