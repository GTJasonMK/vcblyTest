// ========== UI 通用工具与公用组件 ==========
// 给 ui.js 主模块及 ui-badges / ui-notebook / ui-word-map 子模块共用，
// 把这些放到独立模块可以避免子模块反向依赖 ui.js 而形成循环。

import { PANEL, TOAST_DURATION } from './constants.js';
import { getAudioPath, preloadWordAudioList } from './audio.js';

export const AUDIO_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
    <path d="M16 9.5a4 4 0 0 1 0 5"></path>
    <path d="M18.5 7a7 7 0 0 1 0 10"></path>
  </svg>
`;

export function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function escapeHtml(value) {
  return escapeAttr(value);
}

/** 历史条目里 words 字段非数组时返回 0，避免导入数据形状异常时 .length 抛错 */
export function wrongCountOf(h) {
  return Array.isArray(h?.words) ? h.words.length : 0;
}

export function getStoredWordIndex(word) {
  if (Number.isInteger(word?.idx)) return word.idx;
  if (Number.isInteger(word?.wordIndex)) return word.wordIndex - 1;
  return undefined;
}

export function toAudioItem(word) {
  return { word, index: getStoredWordIndex(word) };
}

export function preloadWordWindow(words, centerIdx, radius = 3) {
  if (!Array.isArray(words) || words.length === 0) return;
  const start = Math.max(0, centerIdx - radius);
  const end = Math.min(words.length, centerIdx + radius + 1);
  preloadWordAudioList(
    words.slice(start, end).map(toAudioItem),
    { priority: 'high', warmMemory: true, prefetchedOnly: true }
  );
}

export function renderAudioButton(word, extraClass = '') {
  const idx = getStoredWordIndex(word);
  if (!getAudioPath(word, idx)) return '';

  const indexAttr = Number.isInteger(idx) ? ` data-audio-index="${idx}"` : '';
  const spelling = word?.w || '';
  return `
    <button class="audio-btn audio-btn-inline ${extraClass}" onclick="event.stopPropagation();playWordAudioFromButton(this)" data-audio-word="${escapeAttr(spelling)}"${indexAttr} title="播放发音" aria-label="播放 ${escapeAttr(spelling)} 发音">
      ${AUDIO_ICON}
    </button>
  `;
}

export function renderNotebookGamepadControls() {
  return `
    <div class="nb-mobile-gamepad" aria-label="错词本触控操作">
      <button type="button" class="nb-pad-btn nb-pad-up" id="nbMobilePrevWordBtn" onclick="notebookPrevWord()" title="上一个错词" aria-label="上一个错词">
        <span aria-hidden="true">↑</span>
      </button>
      <button type="button" class="nb-pad-btn nb-pad-left" id="nbMobilePrevSessionBtn" onclick="notebookPrevSession()" title="上一场测试" aria-label="上一场测试">
        <span aria-hidden="true">←</span>
      </button>
      <button type="button" class="nb-pad-btn nb-pad-center" id="nbMobilePlayBtn" onclick="notebookPlaySelectedAudio(this)" title="播放发音" aria-label="播放当前错词发音">
        ${AUDIO_ICON}
      </button>
      <button type="button" class="nb-pad-btn nb-pad-right" id="nbMobileNextSessionBtn" onclick="notebookNextSession()" title="下一场测试" aria-label="下一场测试">
        <span aria-hidden="true">→</span>
      </button>
      <button type="button" class="nb-pad-btn nb-pad-down" id="nbMobileNextWordBtn" onclick="notebookNextWord()" title="下一个错词" aria-label="下一个错词">
        <span aria-hidden="true">↓</span>
      </button>
    </div>
  `;
}

export function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(PANEL[name.toUpperCase()]);
  if (panel) panel.classList.add('active');
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_DURATION);
}

/** 给 DOM 文本节点赋值的小工具，跨子模块复用 */
export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
