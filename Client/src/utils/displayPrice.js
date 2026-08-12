
export function getDisplayPriceEgp(unitOrListing) {
  const amount = Number(
    unitOrListing?.from_price ??
      unitOrListing?.price_fallback ??
      unitOrListing?.price_per_night ??
      0
  );
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
