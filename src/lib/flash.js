'use strict';

/** رسائل النظام (نجاح / خطأ) تُمرَّر عبر بارامتر msg في الرابط */

const MESSAGES = {
  logged_in: { type: 'ok', text: 'تم تسجيل الدخول بنجاح.' },
  logged_out: { type: 'ok', text: 'تم تسجيل الخروج.' },
  login_failed: { type: 'err', text: 'بيانات الدخول غير صحيحة أو الحساب غير مُفعَّل.' },
  login_required: { type: 'err', text: 'يجب تسجيل الدخول للوصول إلى لوحة التحكم.' },
  rate_limited: { type: 'err', text: 'محاولات دخول كثيرة. انتظر عشر دقائق ثم حاول مرة أخرى.' },
  setup_done: { type: 'ok', text: 'تم إنشاء حساب المدير. يمكنك تسجيل الدخول الآن.' },
  setup_invalid: { type: 'err', text: 'رمز الإعداد غير صحيح أو غير مطلوب في الوقت الحالي.' },
  project_created: { type: 'ok', text: 'تم إنشاء المشروع.' },
  project_updated: { type: 'ok', text: 'تم حفظ بيانات المشروع.' },
  project_deleted: { type: 'ok', text: 'تم حذف المشروع.' },
  status_changed: { type: 'ok', text: 'تم تحديث حالة النشر.' },
  media_uploaded: { type: 'ok', text: 'تم رفع الملفات وربطها بالمشروع.' },
  media_deleted: { type: 'ok', text: 'تم حذف الملف.' },
  media_updated: { type: 'ok', text: 'تم تحديث بيانات الملف.' },
  primary_set: { type: 'ok', text: 'تم تعيين الصورة الرئيسية.' },
  media_moved: { type: 'ok', text: 'تم تغيير الترتيب.' },
  inquiry_sent: { type: 'ok', text: 'تم حفظ طلبك بنجاح، وسيتم التواصل معك على الرقم الذي أدخلته.' },
  inquiry_updated: { type: 'ok', text: 'تم تحديث حالة الطلب.' },
  inquiry_deleted: { type: 'ok', text: 'تم حذف الطلب.' },
  user_created: { type: 'ok', text: 'تم إنشاء الحساب.' },
  user_updated: { type: 'ok', text: 'تم تحديث الحساب.' },
  user_deleted: { type: 'ok', text: 'تم حذف الحساب.' },
  password_changed: { type: 'ok', text: 'تم تغيير كلمة المرور.' },
  settings_saved: { type: 'ok', text: 'تم حفظ الإعدادات وتحديث الموقع.' },
  service_created: { type: 'ok', text: 'تمت إضافة الخدمة.' },
  service_updated: { type: 'ok', text: 'تم تحديث الخدمة.' },
  service_deleted: { type: 'ok', text: 'تم حذف الخدمة.' },
  team_created: { type: 'ok', text: 'تمت إضافة عضو الفريق.' },
  team_updated: { type: 'ok', text: 'تم تحديث بيانات العضو.' },
  team_deleted: { type: 'ok', text: 'تم حذف العضو.' },

  invalid_form: { type: 'err', text: 'تحقق من الحقول المطلوبة ثم أعد المحاولة.' },
  file_error: { type: 'err', text: 'تعذّر رفع الملف. تأكد من النوع (JPG/PNG/WEBP/AVIF) والحجم (حتى 12 ميجابايت للصور).' },
  too_many_files: { type: 'err', text: 'عدد الملفات أكبر من الحد المسموح.' },
  denied: { type: 'err', text: 'لا تملك صلاحية لتنفيذ هذه العملية.' },
  not_found: { type: 'err', text: 'العنصر المطلوب غير موجود.' },
  last_admin: { type: 'err', text: 'لا يمكن تعطيل أو حذف آخر حساب مدير في النظام.' },
  duplicate_email: { type: 'err', text: 'البريد الإلكتروني مستخدم بالفعل.' },
  duplicate_slug: { type: 'err', text: 'الرابط المختصر مستخدم بالفعل.' },
  self_change: { type: 'err', text: 'لا يمكنك تغيير صلاحيتك أو تعطيل حسابك بنفسك.' },
  password_policy: { type: 'err', text: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي أحرفًا وأرقامًا.' },
  wrong_current_password: { type: 'err', text: 'كلمة المرور الحالية غير صحيحة.' },
  bad_credentials: { type: 'err', text: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
  missing_fields: { type: 'err', text: 'من فضلك أكمل الحقول المطلوبة.' },
  bad_phone: { type: 'err', text: 'رقم الهاتف غير صحيح. اكتب رقمًا مصريًا مثل 01092877921.' },
  db_error: { type: 'err', text: 'حدث خطأ أثناء الحفظ في قاعدة البيانات. حاول مرة أخرى.' },
};

function getMessage(code) {
  if (!code) return null;
  return MESSAGES[String(code)] || null;
}

module.exports = { MESSAGES, getMessage };
