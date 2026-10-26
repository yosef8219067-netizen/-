'use strict';

/**
 * مراسي العاصمة الحديثة — الخادم الرئيسي
 * Express + EJS (عرض من الخادم) + SQLite دائمة + رفع ملفات على قرص دائم
 */

const path = require('path');
const express = require('express');
const compression = require('compression');

const { UPLOAD_DIR, DB_FILE, DATA_DIR, getSettings } = require('./src/db');
const { attachSession, bootstrapFromEnv } = require('./src/auth');
const { getMessage } = require('./src/lib/flash');
const { IMAGE_MAX, VIDEO_MAX } = require('./src/lib/upload');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const util = require('./src/lib/util');

const app = express();
const PORT = Number(process.env.PORT || 80);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.set('x-powered-by', false);

app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json({ limit: '256kb' }));

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    index: false,
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    },
  })
);

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.use(attachSession);

app.use((req, res, next) => {
  const settings = getSettings();
  res.locals.settings = settings;
  res.locals.path = req.path;
  res.locals.query = req.query || {};
  res.locals.baseUrl = String(settings.site_base_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.locals.message = getMessage(req.query.msg);
  res.locals.currentYear = new Date().getFullYear();
  res.locals.mediaUrl = (file) => (file ? `/uploads/${String(file).replace(/^\/+/, '')}` : '');
  res.locals.S = util; // أدوات مساعدة متاحة داخل القوالب
  res.locals.fmt = util.formatDate;
  res.locals.ago = util.timeAgo;
  res.locals.ar = util.arabicDigits;
  res.locals.PROJECT_STATUS = util.PROJECT_STATUS;
  res.locals.INQUIRY_STATUS = util.INQUIRY_STATUS;
  res.locals.ROLE_LABEL = util.ROLE_LABEL;
  res.locals.kb = util.formatBytes;
  res.locals.maxImageMb = Math.round(IMAGE_MAX / (1024 * 1024));
  res.locals.maxVideoMb = Math.round(VIDEO_MAX / (1024 * 1024));
  res.locals.adminSection = '';
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'الصفحة غير موجودة' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  if (res.headersSent) return;
  const status = err && err.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status === 404 ? 404 : 500);
  if (res.locals.settings) {
    res.render('errors/500', {
      title: 'حدث خطأ غير متوقع',
      message: 'تعذّر إتمام الطلب بسبب خطأ في الخادم. أعد المحاولة بعد قليل.',
    });
  } else {
    res.type('text/plain').send('Server error');
  }
});

bootstrapFromEnv();

const server = app.listen(PORT, HOST, () => {
  console.log(`[marasi] server listening on http://${HOST}:${PORT}`);
  console.log(`[marasi] data dir: ${DATA_DIR}`);
  console.log(`[marasi] database: ${DB_FILE}`);
});

function shutdown(signal) {
  console.log(`[marasi] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
