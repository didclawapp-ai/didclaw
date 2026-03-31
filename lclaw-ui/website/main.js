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
      // Allow simple HTML in hero sub
      if (key === 'hero.sub') {
        el.innerHTML = strings[key];
      } else {
        el.textContent = strings[key];
      }
    }
  });

  // Toggle button highlight
  const btn = document.getElementById('langToggle');
  if (btn) {
    btn.classList.toggle('active-zh', lang === 'zh');
    btn.classList.toggle('active-en', lang === 'en');
  }

  // Update page title & meta
  document.title = lang === 'zh'
    ? 'DidClaw — 开源 AI 桌面客户端'
    : 'DidClaw — Open Source AI Desktop Client';
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

// Close mobile nav on link click
mobileNav?.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => mobileNav.classList.remove('open'));
});

// ── Nav scroll style ──────────────────────────────────────
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// ── Intersection Observer animations ─────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll(
  '.feat-card, .step, .scenario-card, .channel-card, .tech-card, .stat-item, .section-head'
).forEach(el => {
  el.classList.add('fade-up');
  observer.observe(el);
});

// ── Init ──────────────────────────────────────────────────
applyLang(currentLang);
