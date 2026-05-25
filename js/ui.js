// ========== UI 入口（barrel） ==========
// 子面板逻辑拆在独立模块里，本文件只 re-export 公开接口。

// 重新导出，让 import * as UI from './ui.js' 仍能拿到全部 API。
// 必须静态 re-export，副作用模块（错词本/词汇地图的 window.* 挂载、DOMContentLoaded
// 监听器）才能在主入口加载时立即注册。
export { escapeHtml, showPanel, toast, wrongCountOf } from './ui-common.js';
export {
  renderBadgePage,
  openBadgeModal,
  closeBadgeModal,
  positionAchievePanel,
} from './ui-badges.js';
export {
  renderHistory,
  openHistoryModal,
  closeHistoryModal,
} from './ui-history.js';
export { renderHomeNotebookSummary } from './ui-notebook-summary.js';
export {
  renderNotebook,
  moveNotebookWord,
  moveNotebookSession,
  selectNotebookCurrentWord,
  playNotebookSelectedAudio,
} from './ui-notebook.js';
export { renderWordMap } from './ui-word-map.js';
export {
  renderTestWord,
  renderOptions,
  showAnswerFeedback,
  updateProgress,
} from './ui-test-panel.js';
export { renderResult } from './ui-result.js';
export { renderOverallStats, renderResumeButton } from './ui-home-stats.js';
export { renderReviewWord } from './ui-review-panel.js';
export {
  getAutoPlayAudioInput,
  getHomeSettingsInput,
  getMaxUnknownInput,
  setAutoPlayAudioInput,
  setMaxUnknownInput,
} from './ui-settings.js';
