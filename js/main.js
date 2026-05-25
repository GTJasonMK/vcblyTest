// ========== 应用入口 ==========

import { registerAudioServiceWorker } from './audio.js';
import { initTheme, bindThemeToggle } from './theme.js';
import { bootstrapAppView } from './app-bootstrap.js';
import { bindAppActions } from './app-actions.js';
import { showHashPanel } from './app-panels.js';

// ===== 初始化 =====
function init() {
  initTheme();
  registerAudioServiceWorker();
  bootstrapAppView();
  bindThemeToggle();
  bindAppActions();
}

// ===== 页面可见性 =====
// 后台标签页暂停非必要动画与任务，减少发热
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
});

// ===== 启动 =====
window.addEventListener('hashchange', showHashPanel);
try {
  init();
} finally {
  showHashPanel();
}
