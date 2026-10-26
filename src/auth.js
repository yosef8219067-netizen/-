'use strict';

/** المصادقة: bcrypt + جلسات مخزَّنة في قاعدة البيانات + حماية CSRF + صلاحيات */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { run, get, now, logActivity } = require('./db');
const { str } = require('./lib/util');

const SESSION_COOKIE = 'marasi_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 11;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function hashPassword(password) {
  return bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  try {
    return bcrypt.compareSync(String(password), String(hash));
  } catch (err) {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const chunk of String(header).split(';')) {
    const idx = chunk.indexOf('=');
    if (idx < 0) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch (err) {
      out[key] = value;
    }
  }
  return out;
}

function isSecureRequest(req) {
  return Boolean(req.secure) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || req.ip || req.socket.remoteAddress || '').slice(0, 60);
}

function createSession(userId, req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  run('INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    userId,
    sha256(token),
    csrf,
    clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 200),
    now(),
    expires,
  ]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  return { token, csrf };
}

function destroySession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function attachSession(req, res, next) {
  req.user = null;
  req.session = null;
  req.sessionId = null;
  res.locals.user = null;
  res.locals.csrf = '';
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return next();

  const row = get(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
            u.id, u.name, u.email, u.role, u.is_active, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [sha256(token)]
  );
  if (!row) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return next();
  }
  if (new Date(row.expires_at).getTime() < Date.now() || !row.is_active) {
    run('DELETE FROM sessions WHERE id = ?', [row.session_id]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return next();
  }

  req.user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
  req.session = { id: row.session_id, csrf: row.csrf_token, token };
  req.sessionId = row.session_id;
  res.locals.user = req.user;
  res.locals.csrf = row.csrf_token;
  next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token') || req.query._csrf;
  if (!req.session || !token || !safeEqual(token, req.session.csrf)) {
    res.status(403);
    return res.render('errors/403', { title: 'طلب غير صالح', message: 'انتهت صلاحية الجلسة أو أن الطلب غير موثوق. أعد تحميل الصفحة ثم حاول مرة أخرى.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const target = req.originalUrl && req.originalUrl.startsWith('/admin') ? req.originalUrl : '/admin';
    return res.redirect(`/admin/login?next=${encodeURIComponent(target)}`);
  }
  if (req.user.mustChangePassword && !req.path.startsWith('/account') && !req.path.startsWith('/logout')) {
    return res.redirect('/admin/account?force=1');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/admin/login');
  if (req.user.role !== 'admin') {
    res.status(403);
    return res.render('errors/403', {
      title: 'صلاحية غير كافية',
      message: 'هذه الصفحة متاحة للمدير فقط. تواصل مع مدير الموقع إذا كنت تحتاج صلاحية إضافية.',
    });
  }
  next();
}

/* --------------------------- تحديد محاولات الدخول --------------------------- */

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function isRateLimited(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

function clearFailures(key) {
  attempts.delete(key);
}

/* --------------------------- إنشاء أول حساب مدير --------------------------- */

function countUsers() {
  const row = get('SELECT COUNT(*) AS c FROM users');
  return row ? row.c : 0;
}

function countAdmins() {
  const row = get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
  return row ? row.c : 0;
}

function createUser({ name, email, password, role = 'staff', mustChangePassword = 0 }) {
  const ts = now();
  const info = run(
    'INSERT INTO users (name, email, password_hash, role, is_active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    [str(name, 120), str(email, 180).toLowerCase(), hashPassword(password), role === 'admin' ? 'admin' : 'staff', mustChangePassword ? 1 : 0, ts, ts]
  );
  return info.lastInsertRowid;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
  if (!/[A-Za-z\u0600-\u06FF]/.test(value) || !/\d/.test(value)) return 'يجب أن تحتوي كلمة المرور على أحرف وأرقام معًا.';
  return '';
}

function validateEmail(email) {
  const value = str(email, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'صيغة البريد الإلكتروني غير صحيحة.';
  return '';
}

/** إن وُجدت بيانات المدير في متغيرات البيئة ولم يوجد أي مستخدم، يُنشأ الحساب تلقائيًا */
function bootstrapFromEnv() {
  if (countUsers() > 0) return;
  const email = str(process.env.ADMIN_EMAIL, 180).toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) return;
  if (validateEmail(email) || validatePassword(password)) {
    console.warn('[bootstrap] بيانات المدير في متغيرات البيئة غير صالحة — لن يتم إنشاء الحساب تلقائيًا.');
    return;
  }
  const id = createUser({ name: process.env.ADMIN_NAME || 'مدير الموقع', email, password, role: 'admin', mustChangePassword: 1 });
  logActivity({ userId: id, userName: 'النظام', action: 'bootstrap_admin', entity: 'user', entityId: id, details: 'إنشاء أول حساب مدير من متغيرات البيئة' });
  console.log(`[bootstrap] تم إنشاء حساب المدير ${email} — يجب تغيير كلمة المرور بعد أول تسجيل دخول.`);
}

/** رمز إعداد لمرة واحدة: من متغير البيئة، أو يُولَّد ويُطبع في السجلات */
function setupToken() {
  const fromEnv = str(process.env.ADMIN_SETUP_TOKEN, 200);
  if (fromEnv) return fromEnv;
  if (!global.__marasiSetupToken) {
    global.__marasiSetupToken = crypto.randomBytes(12).toString('hex');
    console.log(`[setup] رمز إعداد المدير (مرة واحدة): ${global.__marasiSetupToken}`);
  }
  return global.__marasiSetupToken;
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  attachSession,
  csrfProtection,
  requireAuth,
  requireAdmin,
  isRateLimited,
  registerFailure,
  clearFailures,
  clientIp,
  countUsers,
  countAdmins,
  createUser,
  validatePassword,
  validateEmail,
  bootstrapFromEnv,
  setupToken,
  safeEqual,
};
