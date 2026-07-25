const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');
const streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** Guest ID / passport uploads — safe to purge with old bookings. */
const FOLDER_ID_DOCS = 'soul-hospitality/id-docs';
/** Unit listing gallery — never purged by retention job. */
const FOLDER_UNITS = 'soul-hospitality/units';
/** Payment / transfer evidence tied to reservations. */
const FOLDER_PAYMENTS = 'soul-hospitality/payments';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function isPdfUpload(filename = '', mimetype = '') {
  return /pdf/i.test(String(mimetype)) || /\.pdf$/i.test(String(filename));
}

function safeBaseName(filename = 'upload') {
  return (
    String(filename)
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'upload'
  );
}

/**
 * Images use auto; PDFs are uploaded as image assets so Cloudinary can deliver
 * page previews (JPG) and inline PDF URLs under /image/upload/.
 */
function uploadBufferToCloudinary(buffer, filename = 'upload', mimetype = '', opts = {}) {
  const pdf = isPdfUpload(filename, mimetype);
  const folder = opts.folder || FOLDER_ID_DOCS;
  return new Promise((resolve, reject) => {
    const options = {
      folder,
      public_id: `${Date.now()}-${safeBaseName(filename)}`,
      resource_type: pdf ? 'image' : 'auto',
      type: 'upload',
    };
    if (pdf) {
      options.format = 'pdf';
    }
    const stream = cloudinary.uploader.upload_stream(options, (err, result) =>
      err ? reject(err) : resolve(result)
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function setCloudinaryFolder(folder) {
  return (req, _res, next) => {
    req.cloudinaryFolder = folder;
    next();
  };
}

/** Express middleware: after multer, push files to Cloudinary and set path/secure_url */
async function attachCloudinaryUrls(req, _res, next) {
  try {
    const files = [];
    if (req.file) files.push(req.file);
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else if (req.files && typeof req.files === 'object') {
      for (const list of Object.values(req.files)) {
        if (Array.isArray(list)) files.push(...list);
      }
    }
    const folder = req.cloudinaryFolder || FOLDER_ID_DOCS;
    for (const file of files) {
      if (!file.buffer) continue;
      const result = await uploadBufferToCloudinary(file.buffer, file.originalname, file.mimetype, {
        folder,
      });
      file.path = result.secure_url;
      file.secure_url = result.secure_url;
      file.cloudinary_resource_type = result.resource_type;
      file.cloudinary_pages = result.pages;
      file.cloudinary_public_id = result.public_id;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Parse a Cloudinary delivery URL into { resourceType, publicId }.
 * Returns null if not a Cloudinary URL for this account.
 */
function parseCloudinaryDeliveryUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!parsed.hostname.includes('cloudinary.com')) return null;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloud && !raw.includes(`/${cloud}/`)) return null;

  // /<resource_type>/upload/[transformations/][v123/]public_id[.ext]
  const match = parsed.pathname.match(
    /\/(image|raw|video|auto)\/upload\/(.*)$/i
  );
  if (!match) return null;

  const resourceType = match[1].toLowerCase() === 'auto' ? 'image' : match[1].toLowerCase();
  let rest = match[2];
  // Strip transformation segments (contain , or start with known prefixes) until version or public id
  const parts = rest.split('/');
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (/^v\d+$/.test(p)) {
      i += 1;
      break;
    }
    // transformation chunk e.g. f_jpg,pg_1,q_auto,w_1200
    if (p.includes(',') || /^(f_|q_|w_|c_|h_|dpr_|pg_)/.test(p)) {
      i += 1;
      continue;
    }
    break;
  }
  let publicId = parts.slice(i).join('/');
  if (!publicId) return null;
  publicId = decodeURIComponent(publicId);

  return { resourceType, publicId, url: raw };
}

/**
 * Destroy a guest-doc Cloudinary asset. Refuses unit-gallery folders.
 * @returns {{ deleted: boolean, reason?: string }}
 */
async function destroyCloudinaryUrl(url, { allowFolders = [FOLDER_ID_DOCS, FOLDER_PAYMENTS] } = {}) {
  const info = parseCloudinaryDeliveryUrl(url);
  if (!info) return { deleted: false, reason: 'not_cloudinary' };

  const idNoExt = info.publicId.replace(/\.[^.]+$/, '');
  const allowed = allowFolders.some(
    (folder) =>
      info.publicId === folder ||
      info.publicId.startsWith(`${folder}/`) ||
      idNoExt.startsWith(`${folder}/`)
  );
  if (!allowed) {
    return { deleted: false, reason: 'protected_folder' };
  }
  // Hard block unit gallery folder even if somehow listed
  if (
    info.publicId.startsWith(`${FOLDER_UNITS}/`) ||
    idNoExt.startsWith(`${FOLDER_UNITS}/`)
  ) {
    return { deleted: false, reason: 'unit_media_protected' };
  }

  const tryIds = [idNoExt];
  if (info.publicId !== idNoExt) tryIds.push(info.publicId);

  for (const publicId of tryIds) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: info.resourceType === 'raw' ? 'raw' : 'image',
        invalidate: true,
      });
      if (result?.result === 'ok' || result?.result === 'not found') {
        return { deleted: result.result === 'ok', reason: result.result };
      }
    } catch (err) {
      // try next id / type
      try {
        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: 'raw',
          invalidate: true,
        });
        if (result?.result === 'ok' || result?.result === 'not found') {
          return { deleted: result.result === 'ok', reason: result.result };
        }
      } catch (_) {
        /* continue */
      }
    }
  }
  return { deleted: false, reason: 'destroy_failed' };
}

module.exports = {
  cloudinary,
  upload,
  uploadBufferToCloudinary,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  parseCloudinaryDeliveryUrl,
  destroyCloudinaryUrl,
  FOLDER_ID_DOCS,
  FOLDER_UNITS,
  FOLDER_PAYMENTS,
};
