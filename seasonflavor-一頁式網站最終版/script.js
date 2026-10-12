// ============================================
// 肆菓 Season Flavor — Scripts
// ============================================

// ── Preloader ─────────────────────────────────────────────────────────────
const preloader = document.getElementById('preloader');
if (preloader) {
  window.addEventListener('load', () => {
    setTimeout(() => preloader.classList.add('hidden'), 1100);
  });
}

// ── Toast Notification System ─────────────────────────────────────────────
let _toastWrap = null;
window.showToast = function(msg, duration = 2600) {
  if (!_toastWrap) {
    _toastWrap = document.createElement('div');
    _toastWrap.className = 'toast-wrap';
    _toastWrap.setAttribute('role', 'status');      // 螢幕閱讀器會念出提示
    _toastWrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(_toastWrap);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  _toastWrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, duration);
};

// ── Back to Top ───────────────────────────────────────────────────────────
const backTop = document.getElementById('backTop');
window.addEventListener('scroll', () => {
  backTop?.classList.toggle('visible', window.scrollY > 600);
}, { passive: true });
backTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ── Nav scroll effect ─────────────────────────────────────────────────────
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.querySelector('.nav-links');
if (navToggle && navLinks) {
  navLinks.id = navLinks.id || 'navLinks';
  navToggle.setAttribute('aria-controls', navLinks.id);
  navToggle.setAttribute('aria-expanded', 'false');
}
navToggle?.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
  const spans = navToggle.querySelectorAll('span');
  spans[0].style.transform = navLinks.classList.contains('open') ? 'rotate(45deg) translate(5px, 5px)' : '';
  spans[1].style.opacity = navLinks.classList.contains('open') ? '0' : '1';
  spans[2].style.transform = navLinks.classList.contains('open') ? 'rotate(-45deg) translate(5px, -5px)' : '';
});

// Close mobile nav on link click
navLinks?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle?.setAttribute('aria-expanded', 'false');
    navToggle.querySelectorAll('span').forEach(s => {
      s.style.transform = '';
      s.style.opacity = '1';
    });
  });
});

// 手機選單開著時按 Esc 關閉，焦點回到選單按鈕
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !navLinks?.classList.contains('open')) return;
  navLinks.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = '1'; });
  navToggle.focus();
});

// ── Scroll Reveal ─────────────────────────────────────────────────────────
const revealElements = document.querySelectorAll(
  '.about-grid, .about-text, .about-visual, .phil-card, .philosophy-quote, .product-card, .contact-grid, .story-text'
);
revealElements.forEach((el, i) => {
  el.classList.add('reveal');
  if (i % 3 === 1) el.classList.add('reveal-delay-1');
  if (i % 3 === 2) el.classList.add('reveal-delay-2');
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// Phil cards stagger
document.querySelectorAll('.phil-card').forEach((card, i) => {
  card.classList.add(`reveal-delay-${i + 1}`);
});

// Product cards stagger
document.querySelectorAll('.product-card').forEach((card, i) => {
  card.classList.add(`reveal-delay-${i % 3 + 1}`);
});

// ── Contact Form ──────────────────────────────────────────────────────────
const form = document.getElementById('contactForm');
// 防機器人驗證：放在送出按鈕前，平常看不到（shop.js 的 tsMount）
// shop.js 在這支之後才載入，等 DOMContentLoaded 再掛
document.addEventListener('DOMContentLoaded', () => {
  if (!form || typeof tsMount !== 'function') return;
  const box = document.createElement('div');
  form.querySelector('button[type="submit"]')?.before(box);
  fetch('/api/checkout-config').then((r) => r.json()).then((c) => tsMount(box, c.turnstile)).catch(() => {});
});
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]');
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  btn.textContent = '送出中…';
  btn.disabled = true;
  const turnstile = typeof tsToken === 'function' ? await tsToken() : '';
  const payload = { name: val('name'), email: val('email'), message: val('message'), turnstile };
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (typeof tsReset === 'function') tsReset();
    if (!res.ok || !out.ok) throw new Error(out.error || ('HTTP ' + res.status));
    showToast('訊息已送出，我們會盡快回覆 ✓');
    form.reset();
  } catch (err) {
    // 送不出去就講實話，並給備用聯絡方式，不要假裝成功
    showToast('送出失敗，請改寄 seasonflavortw@gmail.com', 8000);   // 錯誤要留久一點，來得及看
    console.error('contact form:', err);
  } finally {
    btn.textContent = '送出訊息';
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.disabled = false;
  }
});
