
export function optimizeImageUrl(url, { width = 800, quality = 'auto' } = {}) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/') || url.startsWith('data:')) return url;

  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return url;

    const marker = '/upload/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return url;

    const after = u.pathname.slice(idx + marker.length);
    
    if (/^(f_|q_|w_|c_|h_|dpr_)/.test(after) || after.includes('/f_auto') || after.includes(',w_')) {
      return url;
    }

    const transform = `f_auto,q_${quality},w_${width},c_limit`;
    u.pathname = `${u.pathname.slice(0, idx + marker.length)}${transform}/${after}`;
    return u.toString();
  } catch {
    return url;
  }
}

const UPLOAD = '/upload/';

function isRawCloudinary(url) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes(UPLOAD)) return false;
  const after = url.slice(url.indexOf(UPLOAD) + UPLOAD.length);
  // Already carries a transformation: leave it as the uploader set it.
  return !/^(e_|f_|q_|w_|c_|h_|dpr_|fl_)/.test(after);
}

/**
 * A Cloudinary photo at display quality: a width cap, the best format the browser takes (AVIF / WebP, so a
 * JPEG XL or PNG upload shows everywhere), top quality and, with `upscale`, AI upscaling for small originals.
 * Other URLs (local files) come back unchanged.
 */
export function sharpImageUrl(url, { width = 1600, upscale = false, quality = 'auto:best' } = {}) {
  if (!isRawCloudinary(url)) return url;
  const i = url.indexOf(UPLOAD) + UPLOAD.length;
  return `${url.slice(0, i)}${upscale ? 'e_upscale/' : ''}c_limit,w_${width}/f_auto,q_${quality}/${url.slice(i)}`;
}

/** `srcSet` for a Cloudinary photo at several widths, so each screen downloads the size it shows. */
export function sharpImageSrcSet(url, widths, opts = {}) {
  if (!isRawCloudinary(url)) return undefined;
  return widths.map((w) => `${sharpImageUrl(url, { ...opts, width: w })} ${w}w`).join(', ');
}

/**
 * onError for upscaled photos: a brand-new upscale can still be processing (Cloudinary answers 423 the
 * first time), so fall back to the same photo without upscaling instead of showing nothing.
 */
export function upscaleFallback(url, width = 1600) {
  return (e) => {
    const img = e.currentTarget;
    const plain = sharpImageUrl(url, { width });
    if (img.dataset.fellBack || plain === url) return;
    img.dataset.fellBack = '1';
    img.removeAttribute('srcset');
    img.src = plain;
  };
}

/** Partner logos: upscaled, trimmed, white background made transparent. */
export function sharpLogoUrl(url) {
  if (!isRawCloudinary(url)) return url;
  const i = url.indexOf(UPLOAD) + UPLOAD.length;
  return `${url.slice(0, i)}e_upscale/e_trim:10/e_make_transparent:8/f_png/${url.slice(i)}`;
}
