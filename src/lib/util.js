'use strict';

/** أدوات مشتركة: تحقق من المدخلات، تنسيق، روابط آمنة */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** يحوّل نصًا عاديًا (بعد تهريبه) إلى HTML آمن مع احترام الأسطر الفارغة */
function textToHtml(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function str(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u0000/g, '').trim().slice(0, max);
}

function multiline(value, max = 8000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function slugify(value, fallback = 'project') {
  const base = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || fallback;
}

const AR_DIGITS = { 0: '٠', 1: '١', 2: '٢', 3: '٣', 4: '٤', 5: '٥', 6: '٦', 7: '٧', 8: '٨', 9: '٩' };

function arabicDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => AR_DIGITS[d]);
}

/** أرقام مصرية أو دولية بصيغة مقبولة */
function isValidPhone(value) {
  const raw = String(value || '').replace(/[\s\-()]/g, '');
  if (!/^\+?\d{8,15}$/.test(raw)) return false;
  const local = raw.replace(/^\+?20/, '').replace(/^0+/, '');
  return /^1[0125]\d{8}$/.test(local) || /^\d{8,15}$/.test(raw);
}

function normalizePhone(value) {
  const raw = String(value || '').replace(/[\s\-()]/g, '');
  if (raw.startsWith('+20')) return `0${raw.slice(3)}`;
  if (raw.startsWith('0020')) return `0${raw.slice(4)}`;
  if (raw.startsWith('20') && raw.length > 10) return `0${raw.slice(2)}`;
  return raw;
}

/** يسمح فقط بالروابط http/https (يمنع javascript:) */
function safeUrl(value) {
  const raw = str(value, 800);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch (err) {
    return '';
  }
}

function whatsappLink(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '';
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${query}`;
}

function telLink(phoneIntl) {
  const digits = String(phoneIntl || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

/** استخراج رابط تضمين فيديو آمن (يوتيوب / فيميو / ملف مباشر) */
function videoEmbed(value) {
  const url = safeUrl(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1);
      if (/^[\w-]{6,20}$/.test(id)) return { type: 'youtube', src: `https://www.youtube.com/embed/${id}`, original: url };
    }
    if (host.endsWith('youtube.com')) {
      const id = parsed.searchParams.get('v') || (parsed.pathname.startsWith('/embed/') ? parsed.pathname.split('/')[2] : '');
      if (id && /^[\w-]{6,20}$/.test(id)) return { type: 'youtube', src: `https://www.youtube.com/embed/${id}`, original: url };
    }
    if (host.endsWith('vimeo.com')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return { type: 'vimeo', src: `https://player.vimeo.com/video/${id}`, original: url };
    }
    if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) return { type: 'file', src: url, original: url };
    return { type: 'link', src: url, original: url };
  } catch (err) {
    return null;
  }
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatDate(value, withTime = true) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const bag = {};
  for (const part of parts) bag[part.type] = part.value;
  const base = `${bag.day} ${AR_MONTHS[parseInt(bag.month, 10) - 1] || bag.month} ${bag.year}`;
  return withTime ? `${base} — ${bag.hour}:${bag.minute}` : base;
}

function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${arabicDigits(mins)} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `منذ ${arabicDigits(hours)} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `منذ ${arabicDigits(days)} يوم`;
  return formatDate(value, false);
}

const PROJECT_STATUS = {
  published: 'منشور',
  draft: 'مسودة',
  archived: 'مؤرشف',
};

const INQUIRY_STATUS = {
  new: 'جديد',
  in_progress: 'قيد المتابعة',
  done: 'مكتمل',
};

const ROLE_LABEL = {
  admin: 'مدير',
  staff: 'موظف',
};

const MEDIA_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const MEDIA_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

module.exports = {
  escapeHtml,
  textToHtml,
  str,
  multiline,
  toInt,
  slugify,
  arabicDigits,
  isValidPhone,
  normalizePhone,
  safeUrl,
  whatsappLink,
  telLink,
  videoEmbed,
  formatDate,
  timeAgo,
  PROJECT_STATUS,
  INQUIRY_STATUS,
  ROLE_LABEL,
  MEDIA_IMAGE_TYPES,
  MEDIA_VIDEO_TYPES,
};
