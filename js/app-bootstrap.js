import { initWords } from './state.js';
import { initHomeSearch } from './ui-home-search.js';
import { bindHomeResizeRefresh, bindHomeSettingsSave, refreshHomeView } from './home-view.js';

function normalizeDocumentStructure() {
  const container = document.querySelector('.container');
  if (container) {
    document.querySelectorAll('.panel').forEach(panel => {
      if (panel.parentElement !== container) container.appendChild(panel);
    });
  }

  document.querySelectorAll('.badge-modal').forEach(modal => {
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
  });
}

function renderVocabularyStatus() {
  const count = initWords();
  const subtitle = document.querySelector('.subtitle');
  if (!subtitle) return;
  subtitle.textContent = count > 0
    ? `红宝书 · 共 ${count} 词`
    : '词库加载失败，请刷新页面';
}

export function bootstrapAppView() {
  normalizeDocumentStructure();
  renderVocabularyStatus();
  refreshHomeView({ syncSettings: true });
  initHomeSearch();
  bindHomeSettingsSave();
  bindHomeResizeRefresh();
}
