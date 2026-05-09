// ========== 应用入口 ==========

import { initWords, session } from './state.js';
import { loadSettings, loadHistory, saveHistory, clearHistory, clearAll, loadTheme, saveTheme, loadSession, exportAll, importAll } from './storage.js';
import { setMaxUnknownInput } from './ui.js';
import * as UI from './ui.js';
import * as Session from './session.js';
import { playWordAudioFromButton } from './audio.js';
import { PANEL } from './constants.js';

// ===== 主题管理 =====
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

function toggleTheme() {
  const current = document.documentElement.hasAttribute('data-theme') ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveTheme(next);
}

function initTheme() {
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

// ===== 初始化 =====
function init() {
  initTheme();

  const count = initWords();
  const subtitle = document.querySelector('.subtitle');
  if (count > 0) {
    subtitle.textContent = `红宝书 · 共 ${count} 词`;
  } else {
    subtitle.textContent = '词库加载失败，请刷新页面';
  }

  const settings = loadSettings();
  setMaxUnknownInput(settings.maxUnknown);

  UI.renderOverallStats(loadHistory());
  UI.renderResumeButton(loadSession());
  UI.renderWordMap();

  // 窗口大小变化时重新渲染概率地图和分布图
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById('panel-home').classList.contains('active')) {
        UI.renderWordMap();
      }
    }, 150);
  });

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // 导入文件监听（避免 inline onchange 的模块加载时序问题）
  document.getElementById('importFile').addEventListener('change', (e) => window.importAll(e));
}

// ===== 全局事件绑定（挂载到 window 供 HTML onclick 调用） =====
window.startSession = () => Session.startSession();
window.resumeSession = () => Session.resumeSession();
window.selectAnswer = (idx) => Session.selectAnswer(idx);
window.markUnknown = () => Session.markUnknown();
window.nextWord = () => Session.nextWord();
window.endSessionEarly = () => Session.endSessionEarly();
window.playCurrentWordAudio = () => Session.playCurrentWordAudio();
window.startReview = () => Session.startReview();
window.reviewPrev = () => Session.reviewPrev();
window.reviewNext = () => Session.reviewNext();
window.playReviewWordAudio = () => Session.playReviewWordAudio();
window.playWordAudioFromButton = (button) => {
  if (!playWordAudioFromButton(button)) {
    UI.toast('当前单词暂无音频');
  }
};

window.showPanel = (name) => {
  if (name === 'badges') {
    UI.openBadgeModal(loadHistory());
    return;
  }

  UI.showPanel(name);
  if (name === 'history') {
    UI.renderHistory(loadHistory());
  }
  if (name === 'notebook') {
    UI.renderNotebook(loadHistory());
  }
  if (name === 'home') {
    UI.renderOverallStats(loadHistory());
    UI.renderResumeButton(loadSession());
    UI.renderHomeNotebookSummary(loadHistory());
    UI.renderWordMap();
  }
  if (name === 'result') {
    UI.renderResult();
  }
};

window.resetAll = () => {
  if (!confirm('确定重置全部数据（历史记录+设置）吗？此操作不可恢复。')) return;
  clearAll();
  location.reload();
};

window.clearHistory = () => {
  if (!confirm('确定清空全部历史记录吗？此操作不可恢复。')) return;
  clearHistory();
  UI.renderHistory([]);
  UI.toast('历史记录已清空');
};

window.exportAll = () => {
  const result = exportAll();
  if (result === null) {
    UI.toast('没有可导出的数据');
  }
};

window.importAll = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const count = importAll(e.target.result);
      UI.toast(`导入成功，共 ${count} 条测试记录`);
      // 刷新首页数据和错词本
      UI.renderOverallStats(loadHistory());
      UI.renderResumeButton(loadSession());
      UI.renderWordMap();
      if (document.getElementById('panel-notebook').classList.contains('active')) {
        UI.renderNotebook(loadHistory());
      }
      if (!document.getElementById('badgeModal').hidden) {
        UI.renderBadgePage(loadHistory());
      }
      // 更新设置输入
      const settings = loadSettings();
      const maxUnknownEl = document.getElementById('maxUnknown');
      if (maxUnknownEl) maxUnknownEl.value = settings.maxUnknown;
    } catch (err) {
      UI.toast(err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
};

window.closeBadgeModal = () => UI.closeBadgeModal();

function showHashPanel() {
  const params = new URLSearchParams(location.search);
  const hrefPanel = location.href.match(/[?&#]panel=([^&#]+)/)?.[1];
  const name = decodeURIComponent((params.get('panel') || hrefPanel || location.hash.replace('#', '')).trim());
  if (['home', 'history', 'notebook', 'badges'].includes(name)) {
    window.showPanel(name);
  }
}

// ===== 键盘快捷键 =====
function isEditableTarget(target) {
  return target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

document.addEventListener('keydown', e => {
  if (isEditableTarget(e.target)) return;

  const badgeModal = document.getElementById('badgeModal');
  if (badgeModal && !badgeModal.hidden) {
    if (e.key === 'Escape') UI.closeBadgeModal();
    return;
  }

  const testPanel = document.getElementById(PANEL.TEST);
  const reviewPanel = document.getElementById(PANEL.REVIEW);
  const notebookPanel = document.getElementById(PANEL.NOTEBOOK);

  // 错词本：上下选词，左右切换当天测试次数，P 播放发音
  if (notebookPanel && notebookPanel.classList.contains('active')) {
    const key = e.key.toLowerCase();
    let handled = false;
    if (e.key === 'ArrowUp' || key === 'k') handled = UI.moveNotebookWord(-1);
    if (e.key === 'ArrowDown' || key === 'j') handled = UI.moveNotebookWord(1);
    if (e.key === 'ArrowLeft' || key === 'a') handled = UI.moveNotebookSession(-1);
    if (e.key === 'ArrowRight' || key === 'd') handled = UI.moveNotebookSession(1);
    if (key === 'p') handled = UI.playNotebookSelectedAudio();
    if (e.key === 'Enter' || e.key === ' ') handled = UI.selectNotebookCurrentWord();
    if (handled) e.preventDefault();
    return;
  }

  // 复习模式：左右翻页
  if (reviewPanel && reviewPanel.classList.contains('active')) {
    if (e.key === 'ArrowLeft' || e.key === 'a') Session.reviewPrev();
    if (e.key === 'ArrowRight' || e.key === 'd') Session.reviewNext();
    return;
  }

  // 测试模式
  if (testPanel && testPanel.classList.contains('active') && session.active) {
    // 数字键 1-4 选择对应选项
    if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      Session.selectAnswer(parseInt(e.key) - 1);
    }
    // 空格或回车：下一题
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const nextBtn = document.getElementById('nextBtn');
      if (nextBtn && nextBtn.style.display !== 'none') {
        Session.nextWord();
      }
    }
  }
});

// ===== 启动 =====
window.addEventListener('hashchange', showHashPanel);
try {
  init();
} finally {
  showHashPanel();
}
