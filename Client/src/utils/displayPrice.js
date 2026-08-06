/**
 * Guest-facing display price (EGP).
 * Prefer today's calendar rate (`from_price` / marked-up `price_fallback` from the API).
 * Falls back to the unit form nightly if today has no schedule price.
 */
export function getDisplayPriceEgp(unitOrListing) {
  const amount = Number(
    unitOrListing?.from_price ??
      unitOrListing?.price_fallback ??
      unitOrListing?.price_per_night ??
      0
  );
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
