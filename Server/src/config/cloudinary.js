const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');
const streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function isPdfUpload(filename = '', mimetype = '') {
  return /pdf/i.test(String(mimetype)) || /\.pdf$/i.test(String(filename));
}

function safeBaseName(filename = 'upload') {
  return String(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'upload';
}

/**
 * Images use auto; PDFs are uploaded as image assets so Cloudinary can deliver
 * page previews (JPG) and inline PDF URLs under /image/upload/.
 */
function uploadBufferToCloudinary(buffer, filename = 'upload', mimetype = '') {
  const pdf = isPdfUpload(filename, mimetype);
  return new Promise((resolve, reject) => {
    const options = {
      folder: 'soul-hospitality/id-docs',
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
    for (const file of files) {
      if (!file.buffer) continue;
      const result = await uploadBufferToCloudinary(
        file.buffer,
        file.originalname,
        file.mimetype
      );
      file.path = result.secure_url;
      file.secure_url = result.secure_url;
      file.cloudinary_resource_type = result.resource_type;
      file.cloudinary_pages = result.pages;
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { cloudinary, upload, uploadBufferToCloudinary, attachCloudinaryUrls };
