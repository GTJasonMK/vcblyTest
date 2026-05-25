import { escapeHtml } from './ui-common.js';

let initialized = false;

export function hideReaderPopup() {
  const popup = document.getElementById('readerPopup');
  if (popup) popup.remove();
}

function showReaderPopup(word, def, uk, us, event) {
  hideReaderPopup();

  const popup = document.createElement('div');
  popup.className = 'reader-popup';
  popup.id = 'readerPopup';

  let pronHtml = '';
  if (uk) pronHtml += `英 ${escapeHtml(uk)} `;
  if (us) pronHtml += `美 ${escapeHtml(us)}`;

  popup.innerHTML = `
    <button class="rp-close">&times;</button>
    <div class="rp-word">${escapeHtml(word)}</div>
    ${pronHtml ? `<div class="rp-pron">${pronHtml}</div>` : ''}
    <div class="rp-def">${escapeHtml(def)}</div>
  `;

  popup.querySelector('.rp-close').addEventListener('click', (e) => {
    e.stopPropagation();
    hideReaderPopup();
  });

  document.body.appendChild(popup);

  if (window.innerWidth <= 640) return;
  const rect = event.target.getBoundingClientRect();
  const popupH = popup.offsetHeight;
  const popupW = popup.offsetWidth;
  const gutter = 10;
  let top = rect.bottom + gutter;
  if (top + popupH > window.innerHeight - 12) {
    top = rect.top - popupH - gutter;
  }
  let left = rect.left + rect.width / 2 - popupW / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - popupW - 12));
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

export function bindReaderPopupEvents() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', (e) => {
    const popup = document.getElementById('readerPopup');
    if (!popup) return;
    if (popup.contains(e.target)) return;
    if (e.target.classList.contains('rw-target')) return;
    if (e.target.closest('.rp-close')) return;
    hideReaderPopup();
  }, true);

  document.addEventListener('scroll', () => {
    if (window.innerWidth <= 640) return;
    hideReaderPopup();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const popup = document.getElementById('readerPopup');
    if (!popup) return;
    hideReaderPopup();
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('.rw-target');
    if (!target) return;
    e.stopPropagation();
    const word = target.dataset.word;
    const def = target.dataset.def;
    const uk = target.dataset.uk;
    const us = target.dataset.us;
    if (word) showReaderPopup(word, def, uk, us, e);
  });
}
