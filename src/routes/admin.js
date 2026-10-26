'use strict';

/** لوحة التحكم الإدارية: مشروعات، وسائط، طلبات، مستخدمون، إعدادات، فريق، خدمات */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { all, get, run, now, logActivity, setSettings, getSettings, UPLOAD_DIR } = require('../db');
const A = require('../auth');
const { projectMediaUpload, imageUpload, uploadErrorHandler, IMAGE_MAX } = require('../lib/upload');
const U = require('../lib/util');

const router = express.Router();

const redirectWith = (res, target, msg) => res.redirect(`${target}${target.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`);

/** يمنع إعادة التوجيه إلى نطاق خارجي */
function safeBack(req, fallback) {
  const raw = U.str(req.body && req.body.return_to, 300);
  if (raw.startsWith('/admin')) return raw;
  return fallback;
}

function clientSafeFileName(name) {
  return String(name || '').slice(0, 180);
}

/* ----------------------------- رموز نماذج الدخول ----------------------------- */

function issueFormToken(req, res) {
  const existing = (A.parseCookies(req.headers.cookie).marasi_form || '').trim();
  if (/^[a-f0-9]{32,64}$/.test(existing)) return existing;
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie('marasi_form', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 60 * 1000 });
  return token;
}

function validFormToken(req) {
  const cookie = (A.parseCookies(req.headers.cookie).marasi_form || '').trim();
  const sent = String((req.body && req.body._csrf) || '');
  return Boolean(cookie) && A.safeEqual(cookie, sent);
}

/* -------------------------------- شاشة الدخول -------------------------------- */

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  const next = U.str(req.query.next, 300);
  res.render('admin/login', {
    pageTitle: 'تسجيل الدخول',
    formToken: issueFormToken(req, res),
    next,
    error: req.query.msg === 'login_required' ? 'يجب تسجيل الدخول للمتابعة.' : '',
    email: '',
  });
});

router.post('/login', (req, res) => {
  const email = U.str(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');
  const next = U.str(req.body.next, 300);
  const renderError = (message) => {
    res.status(401).render('admin/login', {
      pageTitle: 'تسجيل الدخول',
      formToken: issueFormToken(req, res),
      next,
      error: message,
      email,
    });
  };

  if (!validFormToken(req)) return renderError('انتهت صلاحية النموذج. أعد تحميل الصفحة وحاول مرة أخرى.');

  const rateKey = `login:${A.clientIp(req)}`;
  if (A.isRateLimited(rateKey)) return res.redirect('/admin/login?msg=rate_limited');

  if (!email || !password) return renderError('أدخل البريد الإلكتروني وكلمة المرور.');

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !A.verifyPassword(password, user.password_hash)) {
    A.registerFailure(rateKey);
    logActivity({ userId: user ? user.id : null, userName: user ? user.name : email, action: 'login_failed', entity: 'user', entityId: user ? user.id : null, details: 'محاولة دخول فاشلة' });
    return renderError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  }
  if (!user.is_active) return renderError('هذا الحساب معطّل. تواصل مع مدير الموقع.');

  A.clearFailures(rateKey);
  A.createSession(user.id, req, res);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), user.id]);
  logActivity({ userId: user.id, userName: user.name, action: 'login', entity: 'user', entityId: user.id, details: 'تسجيل دخول ناجح' });

  const target = next && next.startsWith('/admin') ? next : '/admin';
  return redirectWith(res, target, 'logged_in');
});

router.post('/logout', A.csrfProtection, (req, res) => {
  if (req.user) {
    logActivity({ userId: req.user.id, userName: req.user.name, action: 'logout', entity: 'user', entityId: req.user.id });
  }
  A.destroySession(req, res);
  res.redirect('/admin/login?msg=logged_out');
});

/* ------------------------------ إعداد أول مدير ------------------------------ */

function setupState() {
  return { users: A.countUsers(), admins: A.countAdmins(), requiresToken: A.countUsers() > 0 };
}

router.get('/setup', (req, res) => {
  const state = setupState();
  if (state.admins > 0 && !process.env.ADMIN_SETUP_TOKEN && !req.query.token) {
    return res.redirect('/admin/login');
  }
  res.render('admin/setup', {
    pageTitle: 'إعداد حساب المدير',
    formToken: issueFormToken(req, res),
    state,
    error: '',
    done: false,
    token: U.str(req.query.token, 200),
  });
});

router.post('/setup', (req, res) => {
  const state = setupState();
  const render = (error, status = 400) =>
    res.status(status).render('admin/setup', {
      pageTitle: 'إعداد حساب المدير',
      formToken: issueFormToken(req, res),
      state,
      error,
      done: false,
      token: U.str(req.body.token, 200),
    });

  if (!validFormToken(req)) return render('انتهت صلاحية النموذج. أعد تحميل الصفحة.');
  if (state.admins > 0) {
    const provided = U.str(req.body.token, 200);
    const expected = A.setupToken();
    if (!provided || !A.safeEqual(provided, expected)) return render('رمز الإعداد غير صحيح.');
  }

  const name = U.str(req.body.name, 120);
  const email = U.str(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');

  if (name.length < 3) return render('اكتب اسم المدير (3 أحرف على الأقل).');
  const emailError = A.validateEmail(email);
  if (emailError) return render(emailError);
  const passError = A.validatePassword(password);
  if (passError) return render(passError);
  if (password !== confirm) return render('كلمتا المرور غير متطابقتين.');
  if (get('SELECT id FROM users WHERE email = ?', [email])) return render('هذا البريد مستخدم بالفعل.');

  const id = A.createUser({ name, email, password, role: 'admin', mustChangePassword: 0 });
  logActivity({ userId: id, userName: name, action: 'setup_admin', entity: 'user', entityId: id, details: 'إنشاء حساب المدير الأول عبر شاشة الإعداد' });

  res.render('admin/setup', {
    pageTitle: 'إعداد حساب المدير',
    formToken: issueFormToken(req, res),
    state: setupState(),
    error: '',
    done: true,
    token: '',
  });
});

/* ------------------------------ حماية ما بعد الدخول ------------------------------ */

router.use(A.requireAuth);

// النماذج multipart تُتحقق من CSRF بعد رفع الملفات (لأن req.body لا يكون مقروءًا قبلها)
router.use((req, res, next) => {
  if (req.is('multipart/form-data')) return next();
  return A.csrfProtection(req, res, next);
});

router.use((req, res, next) => {
  res.locals.adminSection = req.path.split('/')[1] || 'dashboard';
  res.locals.adminNav = [
    { key: '', label: 'لوحة المعلومات', href: '/admin' },
    { key: 'projects', label: 'المشروعات', href: '/admin/projects' },
    { key: 'media', label: 'الصور والوسائط', href: '/admin/media' },
    { key: 'inquiries', label: 'طلبات العملاء', href: '/admin/inquiries' },
    { key: 'services', label: 'الخدمات', href: '/admin/services', adminOnly: true },
    { key: 'team', label: 'فريق العمل', href: '/admin/team', adminOnly: true },
    { key: 'users', label: 'المستخدمون', href: '/admin/users', adminOnly: true },
    { key: 'settings', label: 'إعدادات الموقع', href: '/admin/settings', adminOnly: true },
    { key: 'activity', label: 'سجل النشاط', href: '/admin/activity', adminOnly: true },
  ];
  next();
});

/* --------------------------------- لوحة المعلومات --------------------------------- */

router.get('/', (req, res) => {
  const counts = {
    published: (get("SELECT COUNT(*) c FROM projects WHERE status = 'published'") || {}).c || 0,
    drafts: (get("SELECT COUNT(*) c FROM projects WHERE status <> 'published'") || {}).c || 0,
    media: (get('SELECT COUNT(*) c FROM media') || {}).c || 0,
    inquiries: (get('SELECT COUNT(*) c FROM inquiries') || {}).c || 0,
    newInquiries: (get("SELECT COUNT(*) c FROM inquiries WHERE status = 'new'") || {}).c || 0,
    users: (get('SELECT COUNT(*) c FROM users') || {}).c || 0,
    admins: (get("SELECT COUNT(*) c FROM users WHERE role = 'admin'") || {}).c || 0,
    staff: (get("SELECT COUNT(*) c FROM users WHERE role = 'staff'") || {}).c || 0,
    services: (get('SELECT COUNT(*) c FROM services') || {}).c || 0,
    team: (get('SELECT COUNT(*) c FROM team_members') || {}).c || 0,
  };
  const recentProjects = all(
    `SELECT p.*, (SELECT m.filename FROM media m WHERE m.project_id = p.id AND m.kind='image' ORDER BY m.is_primary DESC, m.id ASC LIMIT 1) AS primary_image
       FROM projects p ORDER BY p.updated_at DESC LIMIT 5`
  );
  const recentInquiries = all(
    `SELECT i.*, p.title AS project_title FROM inquiries i LEFT JOIN projects p ON p.id = i.project_id
      ORDER BY i.created_at DESC LIMIT 5`
  );
  const activity = all('SELECT * FROM activity_log ORDER BY id DESC LIMIT 8');

  res.render('admin/dashboard', { pageTitle: 'لوحة المعلومات', counts, recentProjects, recentInquiries, activity });
});

/* --------------------------------- المشروعات --------------------------------- */

function parseProjectForm(req, existing = null) {
  const body = req.body || {};
  const errors = {};
  const data = {
    title: U.str(body.title, 160),
    slugInput: U.str(body.slug, 160),
    short_description: U.str(body.short_description, 300),
    description: U.multiline(body.description, 12000),
    location: U.str(body.location, 200),
    city: U.str(body.city, 120),
    map_url: U.safeUrl(body.map_url),
    price_from: U.str(body.price_from, 80),
    area_from: U.str(body.area_from, 40),
    area_to: U.str(body.area_to, 40),
    unit_types: U.str(body.unit_types, 200),
    availability: U.str(body.availability, 120),
    video_url: U.safeUrl(body.video_url),
    status: ['draft', 'published', 'archived'].includes(body.status) ? body.status : 'draft',
    is_featured: body.is_featured ? 1 : 0,
    sort_order: U.toInt(body.sort_order, 0),
    seo_title: U.str(body.seo_title, 200),
    seo_description: U.str(body.seo_description, 300),
  };
  if (data.title.length < 2) errors.title = 'اسم المشروع مطلوب (حرفان على الأقل).';
  if (body.map_url && !data.map_url) errors.map_url = 'رابط الخريطة يجب أن يبدأ بـ https://';
  if (body.video_url && !data.video_url) errors.video_url = 'رابط الفيديو يجب أن يبدأ بـ https://';
  data.errors = errors;
  return data;
}

function uniqueSlug(base, excludeId = null) {
  const root = U.slugify(base, 'project');
  let candidate = root;
  let i = 1;
  for (;;) {
    const found = excludeId
      ? get('SELECT id FROM projects WHERE slug = ? AND id <> ?', [candidate, excludeId])
      : get('SELECT id FROM projects WHERE slug = ?', [candidate]);
    if (!found) return candidate;
    i += 1;
    candidate = `${root}-${i}`;
  }
}

router.get('/projects', (req, res) => {
  const q = U.str(req.query.q, 80);
  const status = U.str(req.query.status, 20);
  const page = Math.max(U.toInt(req.query.page, 1), 1);
  const perPage = 15;

  const clauses = [];
  const params = [];
  if (q) {
    clauses.push('(p.title LIKE ? OR p.location LIKE ? OR p.city LIKE ? OR p.slug LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (['draft', 'published', 'archived'].includes(status)) {
    clauses.push('p.status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (get(`SELECT COUNT(*) c FROM projects p ${where}`, params) || {}).c || 0;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const current = Math.min(page, pages);

  const projects = all(
    `SELECT p.*, (SELECT m.filename FROM media m WHERE m.project_id = p.id AND m.kind='image'
       ORDER BY m.is_primary DESC, m.sort_order ASC, m.id ASC LIMIT 1) AS primary_image,
       (SELECT COUNT(*) FROM media m WHERE m.project_id = p.id) AS media_count
     FROM projects p ${where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, perPage, (current - 1) * perPage]
  );

  res.render('admin/projects', { pageTitle: 'إدارة المشروعات', projects, q, status, page: current, pages, total });
});

router.get('/projects/new', (req, res) => {
  res.render('admin/project-form', {
    pageTitle: 'إضافة مشروع',
    mode: 'create',
    project: {
      id: null,
      title: '',
      slug: '',
      short_description: '',
      description: '',
      location: '',
      city: '',
      map_url: '',
      price_from: '',
      area_from: '',
      area_to: '',
      unit_types: '',
      availability: '',
      video_url: '',
      status: 'draft',
      is_featured: 0,
      sort_order: 0,
      seo_title: '',
      seo_description: '',
    },
    media: [],
    errors: {},
  });
});

router.post('/projects', (req, res) => {
  const data = parseProjectForm(req);
  if (Object.keys(data.errors).length) {
    return res.status(400).render('admin/project-form', {
      pageTitle: 'إضافة مشروع',
      mode: 'create',
      project: { ...data, slug: data.slugInput, id: null },
      media: [],
      errors: data.errors,
    });
  }
  const slug = uniqueSlug(data.slugInput || data.title);
  const ts = now();
  const info = run(
    `INSERT INTO projects (slug, title, short_description, description, location, city, map_url, price_from, area_from, area_to,
       unit_types, availability, video_url, status, is_featured, sort_order, seo_title, seo_description, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      slug,
      data.title,
      data.short_description,
      data.description,
      data.location,
      data.city,
      data.map_url,
      data.price_from,
      data.area_from,
      data.area_to,
      data.unit_types,
      data.availability,
      data.video_url,
      data.status,
      data.is_featured,
      data.sort_order,
      data.seo_title,
      data.seo_description,
      req.user.id,
      ts,
      ts,
    ]
  );
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'project_created', entity: 'project', entityId: info.lastInsertRowid, details: data.title });
  return redirectWith(res, `/admin/projects/${info.lastInsertRowid}/edit`, 'project_created');
});

router.get('/projects/:id/edit', (req, res) => {
  const project = get('SELECT * FROM projects WHERE id = ?', [U.toInt(req.params.id, 0)]);
  if (!project) return res.status(404).render('errors/404', { title: 'المشروع غير موجود' });
  const media = all('SELECT * FROM media WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC', [project.id]);
  res.render('admin/project-form', { pageTitle: `تعديل: ${project.title}`, mode: 'edit', project, media, errors: {} });
});

router.post('/projects/:id', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const project = get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).render('errors/404', { title: 'المشروع غير موجود' });

  const data = parseProjectForm(req, project);
  const media = all('SELECT * FROM media WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC', [project.id]);
  if (Object.keys(data.errors).length) {
    return res.status(400).render('admin/project-form', {
      pageTitle: `تعديل: ${project.title}`,
      mode: 'edit',
      project: { ...project, ...data, slug: data.slugInput || project.slug },
      media,
      errors: data.errors,
    });
  }

  const slug = uniqueSlug(data.slugInput || data.title || project.slug, id);
  run(
    `UPDATE projects SET slug = ?, title = ?, short_description = ?, description = ?, location = ?, city = ?, map_url = ?,
       price_from = ?, area_from = ?, area_to = ?, unit_types = ?, availability = ?, video_url = ?, status = ?,
       is_featured = ?, sort_order = ?, seo_title = ?, seo_description = ?, updated_at = ?
     WHERE id = ?`,
    [
      slug,
      data.title,
      data.short_description,
      data.description,
      data.location,
      data.city,
      data.map_url,
      data.price_from,
      data.area_from,
      data.area_to,
      data.unit_types,
      data.availability,
      data.video_url,
      data.status,
      data.is_featured,
      data.sort_order,
      data.seo_title,
      data.seo_description,
      now(),
      id,
    ]
  );
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'project_updated', entity: 'project', entityId: id, details: data.title });
  return redirectWith(res, `/admin/projects/${id}/edit`, 'project_updated');
});

router.post('/projects/:id/status', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const project = get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return redirectWith(res, '/admin/projects', 'not_found');
  const status = ['draft', 'published', 'archived'].includes(req.body.status) ? req.body.status : 'draft';
  run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'project_status', entity: 'project', entityId: id, details: `${project.title} → ${status}` });
  return redirectWith(res, safeBack(req, '/admin/projects'), 'status_changed');
});

router.post('/projects/:id/delete', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const project = get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return redirectWith(res, '/admin/projects', 'not_found');
  if (U.str(req.body.confirm, 10) !== '1') return redirectWith(res, '/admin/projects', 'invalid_form');

  const files = all('SELECT filename FROM media WHERE project_id = ?', [id]);
  for (const file of files) removeUpload(file.filename);
  run('DELETE FROM media WHERE project_id = ?', [id]);
  run('DELETE FROM projects WHERE id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'project_deleted', entity: 'project', entityId: id, details: project.title });
  return redirectWith(res, '/admin/projects', 'project_deleted');
});

router.get('/projects/:id/preview', (req, res) => {
  const project = get('SELECT * FROM projects WHERE id = ?', [U.toInt(req.params.id, 0)]);
  if (!project) return res.status(404).render('errors/404', { title: 'المشروع غير موجود' });
  const media = all('SELECT * FROM media WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC', [project.id]);
  const related = all(
    `SELECT p.id, p.slug, p.title, p.location, p.city,
       (SELECT m.filename FROM media m WHERE m.project_id = p.id AND m.kind='image' ORDER BY m.is_primary DESC, m.id ASC LIMIT 1) AS primary_image
     FROM projects p WHERE p.id <> ? AND p.status = 'published' ORDER BY p.updated_at DESC LIMIT 3`,
    [project.id]
  );
  res.render('project', {
    title: `معاينة: ${project.title}`,
    metaDescription: project.short_description || '',
    canonical: '',
    project,
    images: media.filter((m) => m.kind === 'image'),
    videos: media.filter((m) => m.kind === 'video'),
    embed: U.videoEmbed(project.video_url),
    related,
    errors: {},
    old: {},
    preview: true,
  });
});

/* --------------------------------- الوسائط --------------------------------- */

function removeUpload(filename) {
  if (!filename) return;
  const target = path.join(UPLOAD_DIR, path.basename(filename));
  try {
    fs.unlinkSync(target);
  } catch (err) {
    /* الملف قد يكون محذوفًا مسبقًا */
  }
}

function storeMedia({ projectId, file, kind, userId, alt, sortStart }) {
  const ts = now();
  const info = run(
    `INSERT INTO media (project_id, filename, original_name, mime, size, kind, alt, caption, is_primary, sort_order, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?)`,
    [
      projectId,
      file.filename,
      clientSafeFileName(file.originalname),
      file.mimetype,
      file.size || 0,
      kind,
      alt || '',
      sortStart,
      userId,
      ts,
    ]
  );
  return info.lastInsertRowid;
}

router.get('/projects/:id/media', (req, res) => {
  const project = get('SELECT * FROM projects WHERE id = ?', [U.toInt(req.params.id, 0)]);
  if (!project) return res.status(404).render('errors/404', { title: 'المشروع غير موجود' });
  const media = all('SELECT * FROM media WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC', [project.id]);
  res.render('admin/project-media', { pageTitle: `وسائط: ${project.title}`, project, media });
});

router.post('/projects/:id/media', projectMediaUpload, A.csrfProtection, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const project = get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return redirectWith(res, '/admin/projects', 'not_found');

  const files = req.files || {};
  const images = Array.isArray(files.images) ? files.images : [];
  const videos = Array.isArray(files.video) ? files.video : [];

  const existing = get('SELECT COUNT(*) c FROM media WHERE project_id = ?', [id]) || { c: 0 };
  let sort = existing.c;
  let inserted = 0;
  let skipped = 0;

  for (const file of images) {
    if (file.size > IMAGE_MAX) {
      removeUpload(file.filename);
      skipped += 1;
      continue;
    }
    sort += 1;
    storeMedia({ projectId: id, file, kind: 'image', userId: req.user.id, alt: project.title, sortStart: sort });
    inserted += 1;
  }
  for (const file of videos) {
    sort += 1;
    storeMedia({ projectId: id, file, kind: 'video', userId: req.user.id, alt: project.title, sortStart: sort });
    inserted += 1;
  }

  const primary = get("SELECT id FROM media WHERE project_id = ? AND kind = 'image' AND is_primary = 1", [id]);
  if (!primary) {
    const firstImage = get("SELECT id FROM media WHERE project_id = ? AND kind = 'image' ORDER BY sort_order ASC, id ASC LIMIT 1", [id]);
    if (firstImage) run('UPDATE media SET is_primary = 1 WHERE id = ?', [firstImage.id]);
  }

  if (inserted) {
    run('UPDATE projects SET updated_at = ? WHERE id = ?', [now(), id]);
    logActivity({ userId: req.user.id, userName: req.user.name, action: 'media_uploaded', entity: 'project', entityId: id, details: `${inserted} ملف — ${project.title}${skipped ? ` (تم تجاهل ${skipped})` : ''}` });
  }
  return redirectWith(res, `/admin/projects/${id}/media`, inserted ? 'media_uploaded' : 'file_error');
});

router.get('/media', (req, res) => {
  const projectId = U.toInt(req.query.project, 0);
  const kind = U.str(req.query.kind, 20);
  const clauses = [];
  const params = [];
  if (projectId) {
    clauses.push('m.project_id = ?');
    params.push(projectId);
  }
  if (['image', 'video'].includes(kind)) {
    clauses.push('m.kind = ?');
    params.push(kind);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const items = all(
    `SELECT m.*, p.title AS project_title, p.slug AS project_slug FROM media m
       LEFT JOIN projects p ON p.id = m.project_id ${where}
       ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
    params
  );
  const projects = all('SELECT id, title FROM projects ORDER BY title ASC');
  res.render('admin/media', { pageTitle: 'الصور والوسائط', items, projects, projectId, kind });
});

router.post('/media/:id/primary', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const item = get('SELECT * FROM media WHERE id = ?', [id]);
  if (!item) return redirectWith(res, '/admin/media', 'not_found');
  run("UPDATE media SET is_primary = 0 WHERE project_id IS ? AND kind = 'image'", [item.project_id]);
  run('UPDATE media SET is_primary = 1 WHERE id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'media_primary', entity: 'media', entityId: id, details: item.filename });
  return redirectWith(res, safeBack(req, '/admin/media'), 'primary_set');
});

router.post('/media/:id/move', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const item = get('SELECT * FROM media WHERE id = ?', [id]);
  if (!item) return redirectWith(res, '/admin/media', 'not_found');
  const dir = req.body.dir === 'up' ? -1 : 1;
  const siblings = all('SELECT id FROM media WHERE project_id IS ? AND kind = ? ORDER BY sort_order ASC, id ASC', [item.project_id, item.kind]);
  const index = siblings.findIndex((row) => row.id === id);
  const target = index + dir;
  if (index >= 0 && target >= 0 && target < siblings.length) {
    const reordered = siblings.slice();
    const tmp = reordered[index];
    reordered[index] = reordered[target];
    reordered[target] = tmp;
    reordered.forEach((row, i) => run('UPDATE media SET sort_order = ? WHERE id = ?', [i + 1, row.id]));
  }
  return redirectWith(res, safeBack(req, '/admin/media'), 'media_moved');
});

router.post('/media/:id/update', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const item = get('SELECT * FROM media WHERE id = ?', [id]);
  if (!item) return redirectWith(res, '/admin/media', 'not_found');
  run('UPDATE media SET alt = ?, caption = ? WHERE id = ?', [U.str(req.body.alt, 200), U.str(req.body.caption, 250), id]);
  return redirectWith(res, safeBack(req, '/admin/media'), 'media_updated');
});

router.post('/media/:id/delete', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const item = get('SELECT * FROM media WHERE id = ?', [id]);
  if (!item) return redirectWith(res, '/admin/media', 'not_found');
  removeUpload(item.filename);
  run('DELETE FROM media WHERE id = ?', [id]);
  if (item.project_id) {
    const stillPrimary = get("SELECT id FROM media WHERE project_id = ? AND kind='image' AND is_primary = 1", [item.project_id]);
    if (!stillPrimary) {
      const firstImage = get("SELECT id FROM media WHERE project_id = ? AND kind='image' ORDER BY sort_order ASC, id ASC LIMIT 1", [item.project_id]);
      if (firstImage) run('UPDATE media SET is_primary = 1 WHERE id = ?', [firstImage.id]);
    }
  }
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'media_deleted', entity: 'media', entityId: id, details: item.filename });
  return redirectWith(res, safeBack(req, '/admin/media'), 'media_deleted');
});

/* ------------------------------ طلبات العملاء ------------------------------ */

router.get('/inquiries', (req, res) => {
  const status = U.str(req.query.status, 20);
  const q = U.str(req.query.q, 80);
  const clauses = [];
  const params = [];
  if (['new', 'in_progress', 'done'].includes(status)) {
    clauses.push('i.status = ?');
    params.push(status);
  }
  if (q) {
    clauses.push('(i.name LIKE ? OR i.phone LIKE ? OR i.message LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const inquiries = all(
    `SELECT i.*, p.title AS project_title, p.slug AS project_slug FROM inquiries i
       LEFT JOIN projects p ON p.id = i.project_id ${where}
     ORDER BY (CASE i.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END), i.created_at DESC LIMIT 200`,
    params
  );
  const counts = {
    all: (get('SELECT COUNT(*) c FROM inquiries') || {}).c || 0,
    new: (get("SELECT COUNT(*) c FROM inquiries WHERE status = 'new'") || {}).c || 0,
    in_progress: (get("SELECT COUNT(*) c FROM inquiries WHERE status = 'in_progress'") || {}).c || 0,
    done: (get("SELECT COUNT(*) c FROM inquiries WHERE status = 'done'") || {}).c || 0,
  };
  res.render('admin/inquiries', { pageTitle: 'طلبات العملاء', inquiries, status, q, counts });
});

router.get('/inquiries/:id', (req, res) => {
  const inquiry = get(
    `SELECT i.*, p.title AS project_title, p.slug AS project_slug FROM inquiries i
       LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?`,
    [U.toInt(req.params.id, 0)]
  );
  if (!inquiry) return res.status(404).render('errors/404', { title: 'الطلب غير موجود' });
  res.render('admin/inquiry', { pageTitle: `طلب #${inquiry.id}`, inquiry });
});

router.post('/inquiries/:id', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const inquiry = get('SELECT * FROM inquiries WHERE id = ?', [id]);
  if (!inquiry) return redirectWith(res, '/admin/inquiries', 'not_found');
  const status = ['new', 'in_progress', 'done'].includes(req.body.status) ? req.body.status : inquiry.status;
  run('UPDATE inquiries SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?', [status, U.multiline(req.body.admin_notes, 4000), now(), id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'inquiry_updated', entity: 'inquiry', entityId: id, details: status });
  return redirectWith(res, safeBack(req, `/admin/inquiries/${id}`), 'inquiry_updated');
});

router.post('/inquiries/:id/delete', (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const inquiry = get('SELECT * FROM inquiries WHERE id = ?', [id]);
  if (!inquiry) return redirectWith(res, '/admin/inquiries', 'not_found');
  run('DELETE FROM inquiries WHERE id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'inquiry_deleted', entity: 'inquiry', entityId: id, details: inquiry.name });
  return redirectWith(res, '/admin/inquiries', 'inquiry_deleted');
});

/* --------------------------------- المستخدمون --------------------------------- */

router.get('/users', A.requireAdmin, (req, res) => {
  const users = all('SELECT * FROM users ORDER BY (role = \'admin\') DESC, created_at ASC');
  res.render('admin/users', { pageTitle: 'إدارة المستخدمين', users });
});

router.post('/users', A.requireAdmin, (req, res) => {
  const name = U.str(req.body.name, 120);
  const email = U.str(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'staff';

  if (name.length < 3) return redirectWith(res, '/admin/users', 'invalid_form');
  if (A.validateEmail(email)) return redirectWith(res, '/admin/users', 'invalid_form');
  if (A.validatePassword(password)) return redirectWith(res, '/admin/users', 'password_policy');
  if (get('SELECT id FROM users WHERE email = ?', [email])) return redirectWith(res, '/admin/users', 'duplicate_email');

  const id = A.createUser({ name, email, password, role, mustChangePassword: 1 });
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'user_created', entity: 'user', entityId: id, details: `${email} (${role})` });
  return redirectWith(res, '/admin/users', 'user_created');
});

router.post('/users/:id', A.requireAdmin, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return redirectWith(res, '/admin/users', 'not_found');
  if (user.id === req.user.id) return redirectWith(res, '/admin/users', 'self_change');

  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  const isActive = req.body.is_active ? 1 : 0;
  const name = U.str(req.body.name, 120) || user.name;

  if (user.role === 'admin' && (role !== 'admin' || !isActive) && A.countAdmins() <= 1) {
    return redirectWith(res, '/admin/users', 'last_admin');
  }

  run('UPDATE users SET name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?', [name, role, isActive, now(), id]);
  if (!isActive) run('DELETE FROM sessions WHERE user_id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'user_updated', entity: 'user', entityId: id, details: `${role} / ${isActive ? 'نشط' : 'معطّل'}` });
  return redirectWith(res, '/admin/users', 'user_updated');
});

router.post('/users/:id/password', A.requireAdmin, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return redirectWith(res, '/admin/users', 'not_found');
  const password = String(req.body.password || '');
  if (A.validatePassword(password)) return redirectWith(res, '/admin/users', 'password_policy');
  run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [A.hashPassword(password), now(), id]);
  run('DELETE FROM sessions WHERE user_id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'user_password_reset', entity: 'user', entityId: id, details: user.email });
  return redirectWith(res, '/admin/users', 'user_updated');
});

router.post('/users/:id/delete', A.requireAdmin, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const user = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return redirectWith(res, '/admin/users', 'not_found');
  if (user.id === req.user.id) return redirectWith(res, '/admin/users', 'self_change');
  if (user.role === 'admin' && A.countAdmins() <= 1) return redirectWith(res, '/admin/users', 'last_admin');
  run('DELETE FROM sessions WHERE user_id = ?', [id]);
  run('DELETE FROM users WHERE id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'user_deleted', entity: 'user', entityId: id, details: user.email });
  return redirectWith(res, '/admin/users', 'user_deleted');
});

/* --------------------------------- الإعدادات --------------------------------- */

const SETTING_KEYS = [
  'company_name',
  'owner_name',
  'tagline',
  'phone_display',
  'phone_intl',
  'whatsapp_number',
  'email',
  'address',
  'working_hours',
  'facebook_url',
  'instagram_url',
  'tiktok_url',
  'linkedin_url',
  'youtube_url',
  'whatsapp_group_url',
  'hero_badge',
  'hero_title',
  'hero_subtitle',
  'about_short',
  'about_story',
  'vision',
  'mission',
  'seo_title',
  'seo_description',
  'seo_keywords',
  'footer_note',
  'commercial_register',
  'tax_id',
  'license_no',
  'official_notes',
  'site_base_url',
  'home_projects_count',
  'home_gallery_count',
  'show_team_section',
  'inquiry_intro',
  'availability_note',
];

router.get('/settings', A.requireAdmin, (req, res) => {
  res.render('admin/settings', { pageTitle: 'إعدادات الموقع', values: getSettings() });
});

router.post('/settings', A.requireAdmin, imageUpload('logo'), A.csrfProtection, (req, res) => {
  const patch = {};
  for (const key of SETTING_KEYS) {
    if (req.body[key] === undefined) continue;
    const raw = key === 'site_base_url' ? U.safeUrl(req.body[key]) : req.body[key];
    patch[key] = typeof raw === 'string' ? U.multiline(raw, 4000) : raw;
  }
  patch.show_team_section = req.body.show_team_section ? '1' : '0';

  const logo = (req.files && req.files[0]) || null;
  if (logo) patch.logo_path = logo.filename;

  setSettings(patch);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'settings_updated', entity: 'settings', details: Object.keys(patch).join(', ') });
  return redirectWith(res, '/admin/settings', 'settings_saved');
});

/* --------------------------------- الخدمات --------------------------------- */

router.get('/services', A.requireAdmin, (req, res) => {
  const services = all('SELECT * FROM services ORDER BY sort_order ASC, id ASC');
  res.render('admin/services', { pageTitle: 'إدارة الخدمات', services });
});

router.post('/services', A.requireAdmin, (req, res) => {
  const title = U.str(req.body.title, 160);
  if (title.length < 2) return redirectWith(res, '/admin/services', 'invalid_form');
  const ts = now();
  run('INSERT INTO services (title, description, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    title,
    U.multiline(req.body.description, 1200),
    U.toInt(req.body.sort_order, 0),
    req.body.is_published ? 1 : 0,
    ts,
    ts,
  ]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'service_created', entity: 'service', details: title });
  return redirectWith(res, '/admin/services', 'service_created');
});

router.post('/services/:id', A.requireAdmin, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const service = get('SELECT * FROM services WHERE id = ?', [id]);
  if (!service) return redirectWith(res, '/admin/services', 'not_found');
  run('UPDATE services SET title = ?, description = ?, sort_order = ?, is_published = ?, updated_at = ? WHERE id = ?', [
    U.str(req.body.title, 160) || service.title,
    U.multiline(req.body.description, 1200),
    U.toInt(req.body.sort_order, service.sort_order),
    req.body.is_published ? 1 : 0,
    now(),
    id,
  ]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'service_updated', entity: 'service', entityId: id });
  return redirectWith(res, '/admin/services', 'service_updated');
});

router.post('/services/:id/delete', A.requireAdmin, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const service = get('SELECT * FROM services WHERE id = ?', [id]);
  if (!service) return redirectWith(res, '/admin/services', 'not_found');
  run('DELETE FROM services WHERE id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'service_deleted', entity: 'service', entityId: id, details: service.title });
  return redirectWith(res, '/admin/services', 'service_deleted');
});

/* -------------------------------- فريق العمل -------------------------------- */

router.get('/team', A.requireAdmin, (req, res) => {
  const team = all('SELECT * FROM team_members ORDER BY sort_order ASC, id ASC');
  res.render('admin/team', { pageTitle: 'فريق العمل', team });
});

router.post('/team', A.requireAdmin, imageUpload('photo'), A.csrfProtection, (req, res) => {
  const name = U.str(req.body.name, 120);
  if (name.length < 2) return redirectWith(res, '/admin/team', 'invalid_form');
  const photo = (req.files && req.files[0]) || null;
  const ts = now();
  run(
    'INSERT INTO team_members (name, role_title, bio, image_path, phone, email, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      name,
      U.str(req.body.role_title, 120),
      U.multiline(req.body.bio, 1500),
      photo ? photo.filename : '',
      U.str(req.body.phone, 40),
      U.str(req.body.email, 180),
      U.toInt(req.body.sort_order, 0),
      req.body.is_published ? 1 : 0,
      ts,
      ts,
    ]
  );
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'team_created', entity: 'team', details: name });
  return redirectWith(res, '/admin/team', 'team_created');
});

router.post('/team/:id', A.requireAdmin, imageUpload('photo'), A.csrfProtection, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const member = get('SELECT * FROM team_members WHERE id = ?', [id]);
  if (!member) return redirectWith(res, '/admin/team', 'not_found');
  const photo = (req.files && req.files[0]) || null;
  if (photo && member.image_path) removeUpload(member.image_path);
  run(
    'UPDATE team_members SET name = ?, role_title = ?, bio = ?, image_path = ?, phone = ?, email = ?, sort_order = ?, is_published = ?, updated_at = ? WHERE id = ?',
    [
      U.str(req.body.name, 120) || member.name,
      U.str(req.body.role_title, 120),
      U.multiline(req.body.bio, 1500),
      photo ? photo.filename : member.image_path,
      U.str(req.body.phone, 40),
      U.str(req.body.email, 180),
      U.toInt(req.body.sort_order, member.sort_order),
      req.body.is_published ? 1 : 0,
      now(),
      id,
    ]
  );
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'team_updated', entity: 'team', entityId: id });
  return redirectWith(res, '/admin/team', 'team_updated');
});

router.post('/team/:id/delete', A.requireAdmin, (req, res) => {
  const id = U.toInt(req.params.id, 0);
  const member = get('SELECT * FROM team_members WHERE id = ?', [id]);
  if (!member) return redirectWith(res, '/admin/team', 'not_found');
  if (member.image_path) removeUpload(member.image_path);
  run('DELETE FROM team_members WHERE id = ?', [id]);
  logActivity({ userId: req.user.id, userName: req.user.name, action: 'team_deleted', entity: 'team', entityId: id, details: member.name });
  return redirectWith(res, '/admin/team', 'team_deleted');
});

/* -------------------------------- سجل النشاط -------------------------------- */

router.get('/activity', A.requireAdmin, (req, res) => {
  const logs = all('SELECT * FROM activity_log ORDER BY id DESC LIMIT 300');
  res.render('admin/activity', { pageTitle: 'سجل النشاط', logs });
});

/* --------------------------------- حسابي --------------------------------- */

router.get('/account', (req, res) => {
  res.render('admin/account', {
    pageTitle: 'حسابي',
    forced: req.query.force === '1' || req.user.mustChangePassword,
    errors: {},
  });
});

router.post('/account/password', (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const fail = (msg) => res.status(400).render('admin/account', { pageTitle: 'حسابي', forced: false, errors: { form: msg } });

  if (!user || !A.verifyPassword(current, user.password_hash)) return fail('كلمة المرور الحالية غير صحيحة.');
  const policy = A.validatePassword(next);
  if (policy) return fail(policy);
  if (next !== confirm) return fail('كلمتا المرور الجديدتان غير متطابقتين.');

  run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [A.hashPassword(next), now(), user.id]);
  run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [user.id, req.sessionId]);
  logActivity({ userId: user.id, userName: user.name, action: 'password_changed', entity: 'user', entityId: user.id });
  return redirectWith(res, '/admin', 'password_changed');
});

router.use(uploadErrorHandler);

module.exports = router;
