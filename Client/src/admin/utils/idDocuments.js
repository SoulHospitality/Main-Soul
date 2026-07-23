/** True when a stored ID document URL is a PDF (Cloudinary raw or .pdf). */
export function isPdfUrl(url) {
  const s = String(url || '');
  if (!s) return false;
  if (/\.pdf($|\?)/i.test(s)) return true;
  if (/\/raw\/upload\//i.test(s)) return true;
  if (/\/upload\/.*\.pdf/i.test(s)) return true;
  return false;
}
