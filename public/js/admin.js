/* لوحة التحكم: تأكيد الحذف، معاينة الصور قبل الرفع، توليد الرابط المختصر */
(function () {
  'use strict';

  /* تأكيد العمليات الحساسة */
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var message = form.getAttribute('data-confirm') || 'هل أنت متأكد من تنفيذ هذه العملية؟';
      if (!window.confirm(message)) {
        e.preventDefault();
      }
    });
  });

  /* قائمة اللوحة على الهاتف */
  var menuBtn = document.getElementById('adminMenuBtn');
  var side = document.getElementById('adminSide');
  if (menuBtn && side) {
    menuBtn.addEventListener('click', function () {
      var open = side.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  /* توليد الرابط المختصر من العنوان */
  var titleInput = document.querySelector('[data-slug-source]');
  var slugInput = document.querySelector('[data-slug-target]');
  if (titleInput && slugInput) {
    var touched = slugInput.value.trim().length > 0;
    slugInput.addEventListener('input', function () {
      touched = slugInput.value.trim().length > 0;
    });
    titleInput.addEventListener('input', function () {
      if (touched) return;
      slugInput.value = titleInput.value
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^\u0600-\u06FF\w-]/g, '')
        .replace(/-+/g, '-');
    });
  }

  /* معاينة الصور قبل الرفع */
  document.querySelectorAll('input[type="file"][data-preview]').forEach(function (input) {
    var targetId = input.getAttribute('data-preview');
    var target = document.getElementById(targetId);
    if (!target) return;
    input.addEventListener('change', function () {
      target.innerHTML = '';
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      files.forEach(function (file) {
        if (!file.type || file.type.indexOf('image') !== 0) {
          var row = document.createElement('div');
          row.className = 'cell-sub';
          row.textContent = file.name + ' — سيُرفع كملف فيديو';
          target.appendChild(row);
          return;
        }
        var url = URL.createObjectURL(file);
        var img = document.createElement('img');
        img.src = url;
        img.alt = file.name;
        img.onload = function () { URL.revokeObjectURL(url); };
        target.appendChild(img);
      });
    });
  });

  /* فتح تفاصيل الطلب بسرعة */
  document.querySelectorAll('[data-href]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('a, button, form')) return;
      window.location.href = el.getAttribute('data-href');
    });
  });
})();
