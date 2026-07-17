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

function uploadBufferToCloudinary(buffer, filename = 'upload') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'soul-hospitality',
        public_id: `${Date.now()}-${String(filename).replace(/\.[^.]+$/, '')}`,
        resource_type: 'auto',
      },
      (err, result) => (err ? reject(err) : resolve(result))
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
      const result = await uploadBufferToCloudinary(file.buffer, file.originalname);
      file.path = result.secure_url;
      file.secure_url = result.secure_url;
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { cloudinary, upload, uploadBufferToCloudinary, attachCloudinaryUrls };
