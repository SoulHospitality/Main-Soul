/**
 * Normalize phone identities for owner staff login.
 * Egyptian mobiles: 01271711901 and +201271711901 → 01271711901
 * International / other: digits-only canonical form.
 */
function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Canonical login username for an owner phone.
 * Returns null if the value cannot be used as a login identity.
 */
function normalizeOwnerPhone(raw) {
  let d = digitsOnly(raw);
  if (!d) return null;

  // +20 / 0020 Egypt country code
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length >= 11) d = d.slice(2);

  // 10-digit local mobile missing leading 0 (e.g. 1271711901 or 1007761577)
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;

  // Standard Egyptian mobile: 01xxxxxxxxx (11 digits)
  if (/^01\d{9}$/.test(d)) return d;

  // Keep other international numbers as digits (must be reasonably long)
  if (d.length >= 8 && d.length <= 15) return d;

  return null;
}

/** Alternate forms an owner may type at login (for matching). */
function ownerPhoneLoginVariants(raw) {
  const canonical = normalizeOwnerPhone(raw);
  if (!canonical) return [];
  const set = new Set([canonical, digitsOnly(raw)].filter(Boolean));

  if (/^01\d{9}$/.test(canonical)) {
    set.add(canonical.slice(1)); // without leading 0
    set.add(`20${canonical.slice(1)}`); // 2012...
    set.add(`+20${canonical.slice(1)}`);
    set.add(`0020${canonical.slice(1)}`);
  }

  return [...set];
}

module.exports = {
  digitsOnly,
  normalizeOwnerPhone,
  ownerPhoneLoginVariants,
};
