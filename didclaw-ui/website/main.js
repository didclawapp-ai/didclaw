/* DidClaw Website — main.js */

// ── Language ──────────────────────────────────────────────
const LANG_KEY = 'didclaw-lang';
let currentLang = localStorage.getItem(LANG_KEY) ||
  (navigator.language.startsWith('zh') ? 'zh' : 'en');

function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  const strings = I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (strings[key] !== undefined) {
      if (key === 'hero.sub') {
        el.innerHTML = strings[key];
      } else {
        el.textContent = strings[key];
      }
    }
  });

  const btn = document.getElementById('langToggle');
  if (btn) {
    btn.classList.toggle('active-zh', lang === 'zh');
    btn.classList.toggle('active-en', lang === 'en');
  }

  document.title = lang === 'zh'
    ? 'DidClaw — 面向普通用户的 AI 桌面客户端'
    : 'DidClaw — AI Desktop Client for Everyone';
}

document.getElementById('langToggle')?.addEventListener('click', () => {
  applyLang(currentLang === 'zh' ? 'en' : 'zh');
});

// ── Mobile Nav ────────────────────────────────────────────
const hamburger = document.getElementById('navHamburger');
const mobileNav = document.getElementById('navMobile');

hamburger?.addEventListener('click', () => {
  mobileNav?.classList.toggle('open');
});
mobileNav?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => mobileNav.classList.remove('open'));
});

// ── Nav scroll + Back to top ──────────────────────────────
const nav = document.getElementById('nav');
const backToTop = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 20);
  backToTop?.classList.toggle('visible', window.scrollY > 600);
}, { passive: true });

backToTop?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Preview tabs ──────────────────────────────────────────
document.querySelectorAll('.ptab').forEach(tab => {
  tab.addEventListener('click', () => {
    const kind = tab.dataset.kind;
    // Update tab active state
    document.querySelectorAll('.ptab').forEach(t => t.classList.remove('ptab--active'));
    tab.classList.add('ptab--active');
    // Update panel
    document.querySelectorAll('.preview-panel').forEach(p => {
      p.classList.toggle('preview-panel--active', p.dataset.kind === kind);
    });
  });
});

// ── Stats counter animation ───────────────────────────────
function animateCounter(el, target, suffix) {
  const duration = 1200;
  const start = performance.now();
  const isInt = Number.isInteger(target);

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = isInt ? Math.round(target * eased) : (target * eased).toFixed(0);
    el.textContent = current + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target.querySelector('.stat-num');
      if (!el || el.dataset.animated) return;
      el.dataset.animated = '1';
      const raw = el.textContent.trim();
      const numMatch = raw.match(/^(\d+)/);
      const suffix = raw.replace(/^\d+/, '');
      if (numMatch) animateCounter(el, parseInt(numMatch[1], 10), suffix);
      entry.target.classList.add('visible');
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.stat-item').forEach(el => {
  el.classList.add('fade-up');
  statsObserver.observe(el);
});

// ── Scroll animations ─────────────────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll(
  '.feat-card, .everyone-card, .channel-card, .section-head, .preview-showcase, .how-step, .how-note'
).forEach(el => {
  el.classList.add('fade-up');
  observer.observe(el);
});

// ── Init ──────────────────────────────────────────────────
applyLang(currentLang);
