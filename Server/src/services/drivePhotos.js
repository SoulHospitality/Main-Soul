/**
 * Resolve image URLs from a public Google Drive folder link.
 * Prefer Drive API when GOOGLE_API_KEY / GOOGLE_DRIVE_API_KEY is set;
 * otherwise scrape the public embedded folder view.
 *
 * Only real photo files are returned — never videos or video frame/snapshot
 * thumbnails that Drive serves for video IDs.
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|wmv|flv|3gp|mts|m2ts)$/i;
/** Drive/export thumbs like clip.mp4.jpg or video.mov.png */
const VIDEO_SNAPSHOT_NAME_RE =
  /\.(mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|wmv|flv|3gp|mts|m2ts)\.(jpe?g|png|gif|webp|bmp)$/i;

function extractFolderId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw) && !raw.includes('/')) return raw;

  const patterns = [
    /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/folderview\?id=([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/embeddedfolderview\?id=([a-zA-Z0-9_-]+)/i,
    /[?&]id=([a-zA-Z0-9_-]+)/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function driveImageUrl(fileId) {
  // Stable direct-ish view URL for <img src>
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

function isVideoMime(mime) {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('video/') || m === 'application/vnd.google-apps.video';
}

function isImageMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (!m.startsWith('image/')) return false;
  // SVG / icons aren't unit gallery photos
  if (m.includes('svg') || m.includes('icon')) return false;
  return true;
}

function isImageName(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (VIDEO_EXT_RE.test(n) || VIDEO_SNAPSHOT_NAME_RE.test(n)) return false;
  return IMAGE_EXT_RE.test(n);
}

function isVideoName(name) {
  const n = String(name || '').trim();
  return VIDEO_EXT_RE.test(n) || VIDEO_SNAPSHOT_NAME_RE.test(n);
}

/** Keep only photo files; drop videos and video snapshot/thumbnail names. */
function isGalleryPhoto({ mimeType, name } = {}) {
  if (isVideoMime(mimeType) || isVideoName(name)) return false;
  if (mimeType) return isImageMime(mimeType);
  return isImageName(name);
}

async function listViaApi(folderId, apiKey) {
  // Restrict at query time so videos never enter the result set.
  const q = [
    `'${folderId}' in parents`,
    'trashed=false',
    "mimeType contains 'image/'",
  ].join(' and ');

  const files = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name,mimeType)',
      orderBy: 'name_natural',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return files
    .filter((f) => isGalleryPhoto(f))
    .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, url: driveImageUrl(f.id) }));
}

function decodeHtmlText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Current embeddedfolderview markup: one `flip-entry` block per file, carrying
 * the file id on the wrapper, the filename in `.flip-entry-title`, and the mime
 * type in the list icon URL (…/type/image/jpeg).
 */
function parseFlipEntries(html, folderId) {
  const byId = new Map();
  const chunks = String(html).split(/<div class="flip-entry"/i).slice(1);

  for (const chunk of chunks) {
    const id =
      chunk.match(/id="entry-([a-zA-Z0-9_-]{10,})"/i)?.[1] ||
      chunk.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/i)?.[1];
    if (!id || id === folderId) continue;

    const name = decodeHtmlText(
      chunk.match(/class="flip-entry-title"[^>]*>([^<]{1,200})</i)?.[1]
    );
    const mimeType =
      chunk.match(/\/type\/((?:image|video|audio|text|application)\/[a-z0-9.+-]+)/i)?.[1] || null;

    byId.set(id, { id, name: name || id, mimeType });
  }

  return [...byId.values()];
}

/**
 * Parse embedded folder HTML into { id, name } pairs when possible.
 * Falls back to bare IDs only when a nearby image-looking name is found.
 */
function parseEmbeddedEntries(html, folderId) {
  const flipEntries = parseFlipEntries(html, folderId);
  if (flipEntries.length) return flipEntries;

  const byId = new Map();

  // Prefer entries that include a filename near the file id.
  const namedPatterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})[^<]{0,200}?>([^<]{1,180})</gi,
    /data-id=["']([a-zA-Z0-9_-]{10,})["'][^>]{0,120}aria-label=["']([^"']+)["']/gi,
    /aria-label=["']([^"']+)["'][^>]{0,120}data-id=["']([a-zA-Z0-9_-]{10,})["']/gi,
    /\\x22([a-zA-Z0-9_-]{10,})\\x22[^\\]{0,80}\\x22([^\\x"]+\.(?:jpe?g|png|gif|webp|bmp|heic|avif|mp4|mov|webm|avi|mkv))\\x22/gi,
  ];

  for (const re of namedPatterns) {
    for (const m of html.matchAll(re)) {
      let id;
      let name;
      if (re.source.startsWith('aria-label')) {
        name = m[1];
        id = m[2];
      } else {
        id = m[1];
        name = m[2];
      }
      if (!id || id === folderId) continue;
      const cleanName = String(name || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      if (!byId.has(id) || cleanName) byId.set(id, { id, name: cleanName || id });
    }
  }

  // Also collect any remaining ids, but only keep them if we already have a name
  // from a named pattern — bare video ids must not become gallery photos.
  return [...byId.values()];
}

async function listViaEmbeddedView(folderId) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SoulHospitality/1.0; +https://soulhospitality.co)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) throw new Error(`Drive folder view HTTP ${res.status}`);
    const html = await res.text();

    const entries = parseEmbeddedEntries(html, folderId);
    const photos = entries
      .filter((f) => isGalleryPhoto(f))
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType || null,
        url: driveImageUrl(f.id),
      }));

    // If we couldn't associate filenames (sparse HTML), fall back to probing
    // content-type so video IDs that serve as snapshot thumbs are dropped.
    if (!photos.length) {
      const ids = new Set();
      for (const m of html.matchAll(/\/file\/d\/([a-zA-Z0-9_-]{10,})/g)) ids.add(m[1]);
      for (const m of html.matchAll(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/g)) {
        ids.add(m[1]);
      }
      ids.delete(folderId);

      const probed = [];
      for (const id of ids) {
        const mimeType = await probeImageMime(driveImageUrl(id));
        if (mimeType) probed.push({ id, name: id, mimeType, url: driveImageUrl(id) });
      }
      return probed;
    }

    return photos;
  } finally {
    clearTimeout(t);
  }
}

/** @returns {Promise<string|null>} the image mime type, or null when not an image. */
async function probeImageMime(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SoulHospitality/1.0; +https://soulhospitality.co)',
      },
    });
    // Some Drive CDN endpoints reject HEAD — try a tiny ranged GET.
    if (!res.ok || !res.headers.get('content-type')) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          Range: 'bytes=0-0',
          'User-Agent':
            'Mozilla/5.0 (compatible; SoulHospitality/1.0; +https://soulhospitality.co)',
        },
      });
    }
    const type = String(res.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type.startsWith('video/')) return null;
    if (type.startsWith('image/')) return type;
    // Video thumbnails sometimes come back as octet-stream / webp from the
    // video file id — without an image filename we cannot trust them.
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} folderUrlOrId
 * @returns {Promise<{ folderId: string, urls: string[], files: {id,name,url}[] }>}
 */
async function resolveDriveFolderPhotos(folderUrlOrId) {
  const folderId = extractFolderId(folderUrlOrId);
  if (!folderId) {
    const err = new Error('Invalid Google Drive folder URL');
    err.status = 400;
    throw err;
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY;
  let files = [];
  if (apiKey) {
    try {
      files = await listViaApi(folderId, apiKey);
    } catch (err) {
      console.warn('[drive] API list failed, trying embedded view:', err.message);
      files = await listViaEmbeddedView(folderId);
    }
  } else {
    files = await listViaEmbeddedView(folderId);
  }

  // Final safety pass
  files = files.filter((f) => isGalleryPhoto(f));

  if (!files.length) {
    const err = new Error(
      'No images found in that Drive folder. Make sure the folder is shared as “Anyone with the link”, and contains image files (not videos).'
    );
    err.status = 400;
    throw err;
  }

  return {
    folderId,
    urls: files.map((f) => f.url),
    files,
  };
}

module.exports = {
  extractFolderId,
  resolveDriveFolderPhotos,
  driveImageUrl,
  isGalleryPhoto,
  isImageMime,
  isImageName,
};
