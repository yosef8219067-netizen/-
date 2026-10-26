'use strict';

/**
 * طبقة قاعدة البيانات — SQLite حقيقية (مبنية على WebAssembly، بدون تجميع أصلي)
 * الملف يُخزَّن داخل قرص دائم (DATA_DIR) حتى تبقى البيانات بعد إعادة التشغيل أو النشر.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Database } = require('node-sqlite3-wasm');

const ROOT = path.join(__dirname, '..');

function pickDataDir() {
  const candidates = [process.env.DATA_DIR, '/data', path.join(ROOT, 'data')].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (err) {
      /* جرّب المسار التالي */
    }
  }
  throw new Error('لا يوجد مسار تخزين قابل للكتابة (DATA_DIR)');
}

const DATA_DIR = pickDataDir();
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'marasi.sqlite');
const db = new Database(DB_FILE);

const now = () => new Date().toISOString();
const run = (sql, params = []) => db.run(sql, params);
const get = (sql, params = []) => db.get(sql, params);
const all = (sql, params = []) => db.all(sql, params);
const exec = (sql) => db.exec(sql);

/* ------------------------------ الجداول ------------------------------ */

exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  location TEXT,
  city TEXT,
  map_url TEXT,
  price_from TEXT,
  area_from TEXT,
  area_to TEXT,
  unit_types TEXT,
  availability TEXT,
  video_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  seo_title TEXT,
  seo_description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'image',
  alt TEXT,
  caption TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role_title TEXT,
  bio TEXT,
  image_path TEXT,
  phone TEXT,
  email TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
`);

/* ------------------------------ الإعدادات الافتراضية ------------------------------ */

const DEFAULT_SETTINGS = {
  company_name: 'مراسي العاصمة الحديثة',
  owner_name: 'محمد سعد',
  tagline: 'عقارات ومشروعات ببيانات واضحة',
  phone_display: '01092877921',
  phone_intl: '+201092877921',
  whatsapp_number: '201092877921',
  email: '',
  address: '',
  working_hours: '',
  facebook_url: '',
  instagram_url: '',
  tiktok_url: '',
  linkedin_url: '',
  youtube_url: '',
  whatsapp_group_url: '',
  hero_badge: 'عقارات • مشروعات • استشارات',
  hero_title: 'نبني جسور الثقة بينك وبين عقارك القادم',
  hero_subtitle:
    'مراسي العاصمة الحديثة — نساعدك على الوصول إلى المشروعات العقارية المناسبة، ببيانات واضحة وصور حقيقية وتواصل مباشر مع المسؤول.',
  about_short:
    'منصة عقارية تعرض المشروعات وبياناتها ووسائطها كما هي، وتساعد العميل على المقارنة بين الخيارات قبل اتخاذ قراره، مع تواصل مباشر مع فريق الشركة.',
  about_story:
    'تقوم فكرة «مراسي العاصمة الحديثة» على الوضوح: مشروع واضح، بيانات واضحة، وصور حقيقية.\nنعرض في هذا الموقع المشروعات التي نعمل عليها مع تفاصيلها المتاحة فقط، ونترك للعميل مساحة للسؤال والمقارنة قبل القرار.\nكل ما يُنشر هنا يأتي من داخل الشركة: الاسم، الموقع، المساحات، حالة التوافر، والوسائط — ونحدّثه باستمرار من لوحة التحكم.',
  vision: 'أن نكون الاسم الذي يتذكره العميل عندما يبحث عن عقار يثق به.',
  mission: 'تقديم معلومات عقارية دقيقة وخدمة مباشرة وسريعة تجعل رحلة اختيار العقار أقصر وأكثر أمانًا.',
  seo_title: 'مراسي العاصمة الحديثة | عقارات ومشروعات',
  seo_description:
    'مراسي العاصمة الحديثة — مشروعات عقارية ببيانات واضحة وصور حقيقية وتواصل مباشر. تعرّف على المشروعات والخدمات واطلب استشارتك.',
  seo_keywords: 'مراسي العاصمة الحديثة, عقارات, مشروعات عقارية, وحدات سكنية, استشارات عقارية',
  footer_note: 'جميع البيانات المعروضة على الموقع يتم تحديثها من لوحة التحكم الإدارية.',
  commercial_register: '',
  tax_id: '',
  license_no: '',
  official_notes: '',
  site_base_url: '',
  home_projects_count: '6',
  home_gallery_count: '8',
  show_team_section: '1',
  inquiry_intro: 'اترك بياناتك وسيتم التواصل معك من فريق الشركة على الرقم المسجل.',
  availability_note: 'حالة التوافر تُحدَّث يدويًا من لوحة التحكم وتُعرض كما تم إدخالها.',
};

function seedSettings() {
  const ts = now();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    run('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, value, ts]);
  }
}

function seedServices() {
  const count = get('SELECT COUNT(*) AS c FROM services');
  if (count && count.c > 0) return;
  const seeds = [
    {
      title: 'تسويق المشروعات العقارية',
      description:
        'عرض المشروعات ووحداتها للعملاء المهتمين، مع بيانات محدثة عن المساحات وحالة التوافر كما تصلنا من مصدرها.',
    },
    {
      title: 'استشارة اختيار الوحدة',
      description:
        'نساعدك على مقارنة الوحدات المتاحة داخل المشروع بحسب المساحة والميزانية والموقع قبل اتخاذ القرار.',
    },
    {
      title: 'متابعة إجراءات التعاقد',
      description: 'تنسيق الخطوات بين العميل والجهة المطورة ومتابعة المستندات حتى إتمام التعاقد.',
    },
    {
      title: 'متابعة العميل بعد التعاقد',
      description: 'استقبال استفسارات العميل بعد التعاقد وتحويلها إلى المسؤول المختص داخل الشركة.',
    },
  ];
  const ts = now();
  seeds.forEach((s, i) => {
    run(
      'INSERT INTO services (title, description, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      [s.title, s.description, i + 1, ts, ts]
    );
  });
}

seedSettings();
seedServices();

/* ------------------------------ الإعدادات ------------------------------ */

function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) out[row.key] = row.value;
  }
  return out;
}

function setSettings(patch) {
  const ts = now();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    run(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, value === null ? '' : String(value), ts]
    );
  }
}

/* ------------------------------ سجل النشاط ------------------------------ */

function logActivity({ userId, userName, action, entity, entityId, details }) {
  run(
    'INSERT INTO activity_log (user_id, user_name, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId || null, userName || null, action, entity || null, entityId ? String(entityId) : null, details || null, now()]
  );
}

/* ------------------------------ التنظيف ------------------------------ */

function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
}

cleanupSessions();

module.exports = {
  db,
  run,
  get,
  all,
  exec,
  now,
  DATA_DIR,
  UPLOAD_DIR,
  DB_FILE,
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
  logActivity,
  cleanupSessions,
};
