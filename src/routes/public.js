'use strict';

/** الصفحات العامة للموقع */

const express = require('express');
const { all, get, run, now } = require('../db');
const { str, multiline, isValidPhone, normalizePhone, videoEmbed, toInt } = require('../lib/util');

const router = express.Router();

const CARD_SQL = `
  SELECT p.id, p.slug, p.title, p.short_description, p.location, p.city, p.price_from,
         p.area_from, p.area_to, p.unit_types, p.availability, p.is_featured, p.created_at,
         (SELECT m.filename FROM media m
           WHERE m.project_id = p.id AND m.kind = 'image'
           ORDER BY m.is_primary DESC, m.sort_order ASC, m.id ASC LIMIT 1) AS primary_image,
         (SELECT COUNT(*) FROM media m WHERE m.project_id = p.id AND m.kind = 'image') AS image_count
    FROM projects p`;

function publishedProjects({ where = '', params = [], order = 'p.is_featured DESC, p.sort_order ASC, p.id DESC', limit = null, offset = 0 } = {}) {
  const clauses = ["p.status = 'published'"];
  if (where) clauses.push(where);
  let sql = `${CARD_SQL} WHERE ${clauses.join(' AND ')} ORDER BY ${order}`;
  const values = [...params];
  if (limit !== null) {
    sql += ' LIMIT ? OFFSET ?';
    values.push(limit, offset);
  }
  return all(sql, values);
}

function projectMedia(projectId) {
  return all('SELECT * FROM media WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC', [projectId]);
}

function renderProject(req, res, project, extra = {}) {
  const media = projectMedia(project.id);
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');
  const related = all(
    `${CARD_SQL} WHERE p.status = 'published' AND p.id <> ?
     ORDER BY (CASE WHEN p.city = ? AND p.city <> '' THEN 0 ELSE 1 END), p.sort_order ASC, p.id DESC LIMIT 3`,
    [project.id, project.city || '']
  );
  return res.render('project', {
    title: project.seo_title || `${project.title} | ${res.locals.settings.company_name}`,
    metaDescription: project.seo_description || project.short_description || res.locals.settings.seo_description,
    canonical: `${res.locals.baseUrl}/projects/${project.slug}`,
    project,
    images,
    videos,
    embed: videoEmbed(project.video_url),
    related,
    errors: extra.errors || {},
    old: extra.old || {},
    preview: Boolean(extra.preview),
  });
}

/* --------------------------------- الرئيسية --------------------------------- */

router.get('/', (req, res) => {
  const settings = res.locals.settings;
  const limit = Math.min(Math.max(toInt(settings.home_projects_count, 6), 3), 12);
  const featured = publishedProjects({ order: 'p.is_featured DESC, p.sort_order ASC, p.id DESC', limit });

  const services = all('SELECT * FROM services WHERE is_published = 1 ORDER BY sort_order ASC, id ASC LIMIT 6');

  const galleryLimit = Math.min(Math.max(toInt(settings.home_gallery_count, 8), 3), 12);
  const gallery = all(
    `SELECT m.*, p.title AS project_title, p.slug AS project_slug
       FROM media m JOIN projects p ON p.id = m.project_id
      WHERE m.kind = 'image' AND p.status = 'published'
      ORDER BY p.is_featured DESC, m.is_primary DESC, m.id DESC LIMIT ?`,
    [galleryLimit]
  );

  const team = all('SELECT * FROM team_members WHERE is_published = 1 ORDER BY sort_order ASC, id ASC LIMIT 3');

  const stats = {
    projects: (get("SELECT COUNT(*) AS c FROM projects WHERE status = 'published'") || {}).c || 0,
    cities: (get("SELECT COUNT(DISTINCT city) AS c FROM projects WHERE status = 'published' AND city <> ''") || {}).c || 0,
    images: (
      get("SELECT COUNT(*) AS c FROM media m JOIN projects p ON p.id = m.project_id WHERE m.kind = 'image' AND p.status = 'published'") || {}
    ).c || 0,
    services: (get('SELECT COUNT(*) AS c FROM services WHERE is_published = 1') || {}).c || 0,
  };

  res.render('home', {
    title: settings.seo_title || `${settings.company_name} | عقارات ومشروعات`,
    metaDescription: settings.seo_description,
    canonical: `${res.locals.baseUrl}/`,
    featured,
    services,
    gallery,
    team,
    stats,
    showTeam: settings.show_team_section === '1' && team.length > 0,
  });
});

/* --------------------------------- عن الشركة -------------------------------- */

router.get('/about', (req, res) => {
  const s = res.locals.settings;
  res.render('about', {
    title: `عن الشركة | ${s.company_name}`,
    metaDescription: s.about_short || s.seo_description,
    canonical: `${res.locals.baseUrl}/about`,
  });
});

/* --------------------------------- المشروعات -------------------------------- */

router.get('/projects', (req, res) => {
  const q = str(req.query.q, 80);
  const city = str(req.query.city, 80);
  const page = Math.max(toInt(req.query.page, 1), 1);
  const perPage = 9;

  const clauses = [];
  const params = [];
  if (q) {
    clauses.push('(p.title LIKE ? OR p.short_description LIKE ? OR p.location LIKE ? OR p.city LIKE ? OR p.unit_types LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (city) {
    clauses.push('p.city = ?');
    params.push(city);
  }
  const where = clauses.length ? clauses.join(' AND ') : '';

  const totalRow = get(
    `SELECT COUNT(*) AS c FROM projects p WHERE p.status = 'published'${where ? ` AND ${where}` : ''}`,
    params
  );
  const total = totalRow ? totalRow.c : 0;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const current = Math.min(page, pages);

  const projects = publishedProjects({ where, params, limit: perPage, offset: (current - 1) * perPage });
  const cities = all("SELECT DISTINCT city FROM projects WHERE status = 'published' AND city <> '' ORDER BY city ASC").map((r) => r.city);

  res.render('projects', {
    title: `مشروعاتنا | ${res.locals.settings.company_name}`,
    metaDescription: 'قائمة مشروعات مراسي العاصمة الحديثة مع بياناتها المتاحة وصورها وحالة التوفر.',
    canonical: `${res.locals.baseUrl}/projects`,
    projects,
    cities,
    q,
    city,
    page: current,
    pages,
    total,
  });
});

router.get('/projects/:slug', (req, res) => {
  const project = get("SELECT * FROM projects WHERE slug = ? AND status = 'published'", [str(req.params.slug, 120)]);
  if (!project) return res.status(404).render('errors/404', { title: 'المشروع غير موجود' });
  const canonical = `${res.locals.baseUrl}/projects/${project.slug}`;
  res.locals.canonical = canonical;
  return renderProject(req, res, project);
});

router.post('/projects/:slug/inquiry', (req, res) => {
  const project = get("SELECT * FROM projects WHERE slug = ? AND status = 'published'", [str(req.params.slug, 120)]);
  if (!project) return res.status(404).render('errors/404', { title: 'المشروع غير موجود' });
  return handleInquiry(req, res, project.id, (errors, old) => renderProject(req, res, project, { errors, old }));
});

/* ---------------------------------- المعرض ---------------------------------- */

router.get('/gallery', (req, res) => {
  const projectSlug = str(req.query.project, 120);
  let project = null;
  const params = [];
  let extra = '';
  if (projectSlug) {
    project = get("SELECT id, title, slug FROM projects WHERE slug = ? AND status = 'published'", [projectSlug]);
    if (project) {
      extra = ' AND m.project_id = ?';
      params.push(project.id);
    }
  }
  const items = all(
    `SELECT m.*, p.title AS project_title, p.slug AS project_slug
       FROM media m JOIN projects p ON p.id = m.project_id
      WHERE p.status = 'published'${extra}
      ORDER BY m.kind ASC, m.is_primary DESC, m.sort_order ASC, m.id DESC`,
    params
  );
  const projects = all(
    `SELECT DISTINCT p.id, p.title, p.slug,
            (SELECT COUNT(*) FROM media m WHERE m.project_id = p.id) AS media_count
       FROM projects p JOIN media m ON m.project_id = p.id
      WHERE p.status = 'published' ORDER BY p.title ASC`
  );

  res.render('gallery', {
    title: `معرض الصور والفيديوهات | ${res.locals.settings.company_name}`,
    metaDescription: 'معرض صور وفيديوهات مشروعات مراسي العاصمة الحديثة.',
    canonical: `${res.locals.baseUrl}/gallery`,
    items,
    projects,
    activeProject: project,
  });
});

/* --------------------------------- الخدمات ---------------------------------- */

router.get('/services', (req, res) => {
  const services = all('SELECT * FROM services WHERE is_published = 1 ORDER BY sort_order ASC, id ASC');
  res.render('services', {
    title: `خدماتنا | ${res.locals.settings.company_name}`,
    metaDescription: 'الخدمات التي تقدمها مراسي العاصمة الحديثة لعملائها.',
    canonical: `${res.locals.baseUrl}/services`,
    services,
  });
});

/* ---------------------------------- الفريق ---------------------------------- */

router.get('/team', (req, res) => {
  const team = all('SELECT * FROM team_members WHERE is_published = 1 ORDER BY sort_order ASC, id ASC');
  res.render('team', {
    title: `فريق العمل | ${res.locals.settings.company_name}`,
    metaDescription: 'أعضاء فريق مراسي العاصمة الحديثة.',
    canonical: `${res.locals.baseUrl}/team`,
    team,
  });
});

/* --------------------------------- التواصل ---------------------------------- */

router.get('/contact', (req, res) => {
  const s = res.locals.settings;
  res.render('contact', {
    title: `تواصل معنا | ${s.company_name}`,
    metaDescription: `تواصل مع ${s.company_name} على الرقم ${s.phone_display} أو عبر واتساب.`,
    canonical: `${res.locals.baseUrl}/contact`,
    errors: {},
    old: {},
  });
});

router.post('/contact', (req, res) => handleInquiry(req, res, null, (errors, old) => {
  const s = res.locals.settings;
  res.status(Object.keys(errors).length ? 400 : 200);
  res.render('contact', {
    title: `تواصل معنا | ${s.company_name}`,
    metaDescription: `تواصل مع ${s.company_name} على الرقم ${s.phone_display} أو عبر واتساب.`,
    canonical: `${res.locals.baseUrl}/contact`,
    errors,
    old,
  });
}));

/** حفظ طلب العميل في قاعدة البيانات (مع تحقق كامل + مصيدة روبوتات) */
function handleInquiry(req, res, projectId, rerender) {
  const body = req.body || {};
  const old = {
    name: str(body.name, 120),
    phone: str(body.phone, 40),
    message: multiline(body.message, 3000),
  };
  const errors = {};

  if (str(body.website, 100)) {
    // حقل مخفي للروبوتات — نرفض الطلب بهدوء
    return res.redirect('/contact?msg=inquiry_sent');
  }
  if (old.name.length < 2) errors.name = 'اكتب الاسم الكامل (حرفان على الأقل).';
  if (!isValidPhone(old.phone)) errors.phone = 'اكتب رقم هاتف صحيح مثل 01092877921.';
  if (old.message.length < 5) errors.message = 'اكتب رسالة توضح طلبك (5 أحرف على الأقل).';

  if (Object.keys(errors).length) return rerender(errors, old);

  const ts = now();
  run(
    'INSERT INTO inquiries (name, phone, message, project_id, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [old.name, normalizePhone(old.phone), old.message, projectId, 'new', projectId ? 'project' : 'contact', ts, ts]
  );

  if (projectId) {
    const project = get('SELECT slug FROM projects WHERE id = ?', [projectId]);
    const slug = project ? `/${project.slug}` : '';
    return res.redirect(`${slug ? `/projects/${slug}` : ''}?msg=inquiry_sent#inquiry`);
  }
  return res.redirect('/contact?msg=inquiry_sent#inquiry');
}

/* ------------------------------- SEO: robots/sitemap ------------------------------- */

router.get('/robots.txt', (req, res) => {
  const base = res.locals.baseUrl;
  res.type('text/plain').send([`User-agent: *`, 'Allow: /', 'Disallow: /admin', 'Disallow: /uploads/tmp', `Sitemap: ${base}/sitemap.xml`, ''].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const base = res.locals.baseUrl;
  const staticPages = ['/', '/about', '/projects', '/gallery', '/services', '/team', '/contact'];
  const projects = all("SELECT slug, updated_at FROM projects WHERE status = 'published' ORDER BY updated_at DESC");
  const url = (loc, lastmod, priority) =>
    `  <url><loc>${base}${loc}</loc>${lastmod ? `<lastmod>${String(lastmod).slice(0, 10)}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>${priority}</priority></url>`;

  const body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    .concat(staticPages.map((p) => url(p, null, p === '/' ? '1.0' : '0.8')))
    .concat(projects.map((p) => url(`/projects/${p.slug}`, p.updated_at, '0.7')))
    .concat(['</urlset>', ''])
    .join('\n');

  res.type('application/xml').send(body);
});

module.exports = router;
