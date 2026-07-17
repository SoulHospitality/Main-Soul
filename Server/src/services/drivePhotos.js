/**
 * Resolve image URLs from a public Google Drive folder link.
 * Prefer Drive API when GOOGLE_API_KEY / GOOGLE_DRIVE_API_KEY is set;
 * otherwise scrape the public embedded folder view.
 */

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

function isImageMime(mime) {
  return String(mime || '').startsWith('image/');
}

function isImageName(name) {
  return /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i.test(String(name || ''));
}

async function listViaApi(folderId, apiKey) {
  const q = `'${folderId}' in parents and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.files || [])
    .filter((f) => isImageMime(f.mimeType) || isImageName(f.name))
    .map((f) => ({ id: f.id, name: f.name, url: driveImageUrl(f.id) }));
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

    const ids = new Set();
    for (const m of html.matchAll(/\/file\/d\/([a-zA-Z0-9_-]{10,})/g)) ids.add(m[1]);
    for (const m of html.matchAll(/\/d\/([a-zA-Z0-9_-]{10,})/g)) ids.add(m[1]);
    for (const m of html.matchAll(/data-id=["']([a-zA-Z0-9_-]{10,})["']/g)) ids.add(m[1]);
    for (const m of html.matchAll(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/g)) {
      ids.add(m[1]);
    }

    // Drop the folder id itself if it appeared
    ids.delete(folderId);

    return [...ids].map((id) => ({ id, name: id, url: driveImageUrl(id) }));
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

  if (!files.length) {
    const err = new Error(
      'No images found in that Drive folder. Make sure the folder is shared as “Anyone with the link”, and contains image files.'
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
};
