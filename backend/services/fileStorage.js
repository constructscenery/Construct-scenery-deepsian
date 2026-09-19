/**
 * FileStorageService — AWS S3 backed file storage.
 * All uploads go to the S3 bucket defined in AWS_S3_BUCKET.
 * Files are stored under the `uploads/` prefix in the bucket.
 */

require('dotenv').config();
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.AWS_S3_BUCKET;
const REGION = process.env.AWS_REGION || 'eu-north-1';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_BYTES      = 25 * 1024 * 1024; // 25 MB

/** Validate MIME type and size. Throws with .status = 400 if invalid. */
function validate(mimetype, size) {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    throw Object.assign(
      new Error(`File type "${mimetype}" is not allowed. Accepted: PDF, JPEG, PNG.`),
      { status: 400 }
    );
  }
  if (size > MAX_FILE_BYTES) {
    throw Object.assign(new Error('File is too large. Maximum size is 25 MB.'), { status: 400 });
  }
}

/**
 * Upload a multer file (memoryStorage) to S3.
 * @param {object} multerFile  - req.file from multer memoryStorage
 * @returns {{ url: string, key: string, size: number }}
 */
async function store(multerFile) {
  const ext  = path.extname(multerFile.originalname).toLowerCase();
  const base = path.basename(multerFile.originalname, ext)
    .replace(/[^a-z0-9_-]/gi, '_')
    .slice(0, 80);
  const key  = `uploads/${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        multerFile.buffer,
    ContentType: multerFile.mimetype,
  }));

  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
  console.log(`☁️  S3 upload: ${key} (${(multerFile.size / 1024).toFixed(1)} KB)`);
  return { url, key, size: multerFile.size };
}

/**
 * Delete a file from S3 by its key.
 * @param {string} key  - S3 object key (e.g. "uploads/1234-foo.pdf")
 */
async function deleteFile(key, { strict = false } = {}) {
  if (!key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    console.log(`🗑  S3 deleted: ${key}`);
  } catch (err) {
    console.error('fileStorage.deleteFile failed:', err.message);
    if (strict) throw err;
  }
}

/**
 * Get file buffer from S3 by its URL.
 * @param {string} url - S3 object URL
 */
async function getFileBuffer(url) {
  if (!url) return null;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  
  // Extract key from URL
  let key = url;
  if (url.includes('.amazonaws.com/')) {
    key = url.split('.amazonaws.com/')[1];
  } else if (url.startsWith('/')) {
    key = url.slice(1);
  }

  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: decodeURIComponent(key) }));
    return Buffer.from(await response.Body.transformToByteArray());
  } catch (err) {
    console.error('fileStorage.getFileBuffer failed:', err.message);
    throw err;
  }
}

/**
 * Stream an S3 file or return object buffer to express res.
 * @param {string} urlOrKey
 * @param {import('express').Response} res
 * @param {string} [filename]
 * @param {string} [mimeType]
 */
async function streamToResponse(urlOrKey, res, filename, mimeType) {
  if (!urlOrKey) throw new Error('No URL or key provided');
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  
  let key = urlOrKey;
  if (urlOrKey.includes('.amazonaws.com/')) {
    key = urlOrKey.split('.amazonaws.com/')[1];
  } else if (urlOrKey.startsWith('/')) {
    key = urlOrKey.slice(1);
  }
  key = decodeURIComponent(key);

  const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));

  const contentType = mimeType || response.ContentType || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);

  if (filename) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  }
  if (response.ContentLength) {
    res.setHeader('Content-Length', response.ContentLength);
  }

  if (response.Body && typeof response.Body.pipe === 'function') {
    response.Body.pipe(res);
  } else {
    const bytes = await response.Body.transformToByteArray();
    res.send(Buffer.from(bytes));
  }
}

module.exports = { validate, store, deleteFile, getFileBuffer, streamToResponse, ALLOWED_MIME_TYPES, MAX_FILE_BYTES };
