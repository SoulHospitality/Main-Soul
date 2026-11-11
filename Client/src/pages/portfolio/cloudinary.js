/**
 * Sharper photos from Cloudinary: AI upscaling (e_upscale) for small originals, then a width cap,
 * automatic quality and format. Non-Cloudinary URLs are returned unchanged.
 * The first request for a new upscaled image can come back "processing" (423); pair it with `plain()`
 * as an onError fallback so a photo always shows.
 */
const MARK = '/image/upload/';

export function sharp(url, width = 2000) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes(MARK)) return url;
  return url.replace(MARK, `${MARK}e_upscale/c_limit,w_${width}/q_auto:good/f_auto/`);
}

export function plain(url, width = 2000) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes(MARK)) return url;
  return url.replace(MARK, `${MARK}c_limit,w_${width}/q_auto:good/f_auto/`);
}

/** Upscaled, trimmed logo with its white background made transparent. */
export function sharpLogo(url) {
  if (!url || !url.includes(MARK)) return url;
  return url.replace(MARK, `${MARK}e_upscale/e_trim:10/e_make_transparent:8/f_png/`);
}
