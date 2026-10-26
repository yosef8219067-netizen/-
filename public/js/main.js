/* الموقع العام: قائمة الهاتف + معرض الصور (Lightbox) + معالجة الصور المفقودة */
(function () {
  'use strict';

  /* ----------------------------- قائمة الهاتف ----------------------------- */
  var toggle = document.getElementById('menuToggle');
  var nav = document.getElementById('mainNav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
    });
  }

  /* ----------------------------- معرض الصور ----------------------------- */
  var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
  var lb = document.getElementById('lightbox');
  var stage = lb ? lb.querySelector('.lightbox__stage') : null;
  var counter = document.getElementById('lbCounter');
  var cap = document.getElementById('lbCap');
  var btnClose = document.getElementById('lbClose');
  var btnPrev = document.getElementById('lbPrev');
  var btnNext = document.getElementById('lbNext');
  var index = 0;
  var lastFocus = null;

  var items = triggers.map(function (btn) {
    return {
      src: btn.getAttribute('data-src'),
      type: btn.getAttribute('data-type') || 'image',
      caption: btn.getAttribute('data-caption') || '',
    };
  });

  function render() {
    if (!stage || !items.length) return;
    var item = items[index];
    stage.innerHTML = '';
    if (item.type === 'video') {
      var video = document.createElement('video');
      video.src = item.src;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.className = 'lb-video';
      stage.appendChild(video);
    } else {
      var img = document.createElement('img');
      img.src = item.src;
      img.alt = item.caption || 'صورة من المشروع';
      stage.appendChild(img);
    }
    if (counter) counter.textContent = index + 1 + ' / ' + items.length;
    if (cap) cap.textContent = item.caption;
    var single = items.length < 2;
    if (btnPrev) btnPrev.disabled = single;
    if (btnNext) btnNext.disabled = single;
  }

  function open(i) {
    if (!lb) return;
    index = i;
    lastFocus = document.activeElement;
    lb.hidden = false;
    lb.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    render();
    if (btnClose) btnClose.focus();
  }

  function close() {
    if (!lb) return;
    lb.classList.remove('is-open');
    lb.hidden = true;
    document.body.style.overflow = '';
    if (stage) stage.innerHTML = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function step(dir) {
    if (!items.length) return;
    index = (index + dir + items.length) % items.length;
    render();
  }

  triggers.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      open(i);
    });
  });

  if (lb) {
    if (btnClose) btnClose.addEventListener('click', close);
    if (btnPrev) btnPrev.addEventListener('click', function () { step(-1); });
    if (btnNext) btnNext.addEventListener('click', function () { step(1); });
    lb.addEventListener('click', function (e) {
      if (e.target === lb) close();
    });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(1);
      else if (e.key === 'ArrowRight') step(-1);
    });
  }

  /* ----------------------------- الصور المفقودة ----------------------------- */
  var fallbackFor = function (img) {
    if (!img || img.dataset.brokenHandled) return;
    img.dataset.brokenHandled = '1';
    img.style.display = 'none';
    var holder = img.parentElement;
    if (!holder || holder.querySelector('.ph--fallback')) return;
    var ph = document.createElement('div');
    ph.className = 'ph ph--fallback';
    ph.innerHTML = '<span class="ph__mark">م</span><span class="ph__text">الصورة غير متوفرة حاليًا</span>';
    holder.appendChild(ph);
  };

  Array.prototype.slice.call(document.images).forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) fallbackFor(img);
    img.addEventListener('error', function () { fallbackFor(img); });
  });
})();
