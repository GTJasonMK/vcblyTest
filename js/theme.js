import { loadTheme, saveTheme } from './storage.js';

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function toggleTheme() {
  const current = document.documentElement.hasAttribute('data-theme') ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveTheme(next);
}

export function initTheme() {
  let theme = loadTheme();
  if (!theme || theme === 'auto') {
    theme = getSystemTheme();
  }
  applyTheme(theme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const saved = loadTheme();
    if (!saved || saved === 'auto') {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

export function bindThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.addEventListener('click', toggleTheme);
}
