/**
 * Guest-facing display price (EGP), set on the unit form.
 * Schedule / daily prices are only used inside the booking drawer quote.
 */
export function getDisplayPriceEgp(unitOrListing) {
  const amount = Number(
    unitOrListing?.price_fallback ??
      unitOrListing?.from_price ??
      unitOrListing?.price_per_night ??
      0
  );
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
