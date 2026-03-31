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

// ── Nav scroll ────────────────────────────────────────────
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

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
  '.feat-card, .everyone-card, .channel-card, .stat-item, .section-head, .preview-showcase'
).forEach(el => {
  el.classList.add('fade-up');
  observer.observe(el);
});

// ── Init ──────────────────────────────────────────────────
applyLang(currentLang);
