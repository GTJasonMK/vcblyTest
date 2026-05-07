// ========== 应用入口 ==========

import { initWords, session } from './state.js';
import { loadSettings, loadHistory, saveHistory, clearHistory, clearAll, loadTheme, saveTheme, loadSession, exportNotebook, importNotebook } from './storage.js';
import { setMaxUnknownInput } from './ui.js';
import * as UI from './ui.js';
import * as Session from './session.js';
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

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

// ===== 全局事件绑定（挂载到 window 供 HTML onclick 调用） =====
window.startSession = () => Session.startSession();
window.resumeSession = () => Session.resumeSession();
window.selectAnswer = (idx) => Session.selectAnswer(idx);
window.nextWord = () => Session.nextWord();
window.endSessionEarly = () => Session.endSessionEarly();
window.startReview = () => Session.startReview();
window.reviewPrev = () => Session.reviewPrev();
window.reviewNext = () => Session.reviewNext();

window.showPanel = (name) => {
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
  }
  if (name === 'result') {
    UI.renderResult();
  }
};

window.resetAll = () => {
  if (!confirm('确定重置全部数据（历史记录+设置）吗？此操作不可恢复。')) return;
  clearAll();
  setMaxUnknownInput(20);
  UI.toast('已重置全部数据');
};

window.clearHistory = () => {
  if (!confirm('确定清空全部历史记录吗？此操作不可恢复。')) return;
  clearHistory();
  UI.renderHistory([]);
  UI.toast('历史记录已清空');
};

window.exportNotebook = () => {
  const result = exportNotebook();
  if (result === null) {
    UI.toast('没有可导出的错词数据');
  }
};

window.importNotebook = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const count = importNotebook(e.target.result);
      UI.toast(`导入成功，共 ${count} 条测试记录`);
      // 如果当前在错词本页面，刷新显示
      if (document.getElementById('panel-notebook').classList.contains('active')) {
        UI.renderNotebook(loadHistory());
      }
    } catch (err) {
      UI.toast(err.message);
    }
  };
  reader.readAsText(file);
  // 重置 input 以便重复选择同一文件
  event.target.value = '';
};

// ===== 键盘快捷键 =====
document.addEventListener('keydown', e => {
  const testPanel = document.getElementById(PANEL.TEST);
  const reviewPanel = document.getElementById(PANEL.REVIEW);

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
init();
