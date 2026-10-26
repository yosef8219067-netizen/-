'use strict';

/** إعداد رفع الملفات: تخزين على القرص الدائم مع تحقق من النوع والحجم */

const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('../db');
const { MEDIA_IMAGE_TYPES, MEDIA_VIDEO_TYPES } = require('./util');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

const IMAGE_MAX = 12 * 1024 * 1024;
const VIDEO_MAX = 80 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const ext = EXT_BY_MIME[file.mimetype] || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

function fileTypeError() {
  const err = new Error('نوع الملف غير مدعوم');
  err.code = 'INVALID_FILE_TYPE';
  return err;
}

const imageOnly = (req, file, cb) => {
  if (MEDIA_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
  return cb(fileTypeError());
};

const mediaTypes = (req, file, cb) => {
  if (MEDIA_IMAGE_TYPES.includes(file.mimetype) || MEDIA_VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
  return cb(fileTypeError());
};

const projectMediaUpload = multer({
  storage,
  limits: { fileSize: VIDEO_MAX, files: 12 },
  fileFilter: mediaTypes,
}).fields([
  { name: 'images', maxCount: 10 },
  { name: 'video', maxCount: 1 },
]);

const imageUpload = (field, maxCount = 1, limit = IMAGE_MAX) =>
  multer({ storage, limits: { fileSize: limit, files: maxCount }, fileFilter: imageOnly }).array(field, maxCount);

/** يحوّل أخطاء multer إلى رسالة عربية مفهومة */
function uploadErrorHandler(err, req, res, next) {
  if (!err) return next();
  const code = err.code || '';
  let msg = 'file_error';
  if (code === 'LIMIT_FILE_SIZE') msg = 'file_error';
  else if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') msg = 'too_many_files';
  else if (code === 'INVALID_FILE_TYPE') msg = 'file_error';
  else return next(err);

  const back = req.get('referer') || '/admin';
  try {
    const url = new URL(back, 'http://local');
    url.searchParams.set('msg', msg);
    return res.redirect(url.pathname + url.search);
  } catch (e) {
    return res.redirect(`/admin?msg=${msg}`);
  }
}

module.exports = {
  projectMediaUpload,
  imageUpload,
  uploadErrorHandler,
  IMAGE_MAX,
  VIDEO_MAX,
};
