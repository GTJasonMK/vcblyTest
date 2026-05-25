import { PANEL } from './constants.js';
import {
  loadHistory,
  clearHistory as clearStoredHistory,
  clearAll as clearStoredData,
  exportAll as exportStoredData,
  importAll as importStoredData,
} from './storage.js';
import * as UI from './ui.js';
import { clearAudioCache as clearCachedAudio, playWordAudioFromButton } from './audio.js';
import { refreshHomeView } from './home-view.js';
import { showAppPanel } from './app-panels.js';

function isPanelActive(panelId) {
  return document.getElementById(panelId)?.classList.contains('active');
}

async function resetAllData() {
  if (!confirm('确定重置全部数据（历史记录+设置）吗？此操作不可恢复。')) return;
  clearStoredData();
  try { await clearCachedAudio(); } catch {}
  location.reload();
}

function clearHistoryData() {
  if (!confirm('确定清空全部历史记录吗？此操作不可恢复。')) return;
  clearStoredHistory();
  UI.closeHistoryModal();
  UI.renderHistory([]);
  UI.toast('历史记录已清空');
}

function exportAllData() {
  const result = exportStoredData();
  if (result === null) {
    UI.toast('没有可导出的数据');
  }
}

function refreshDataDependentPanels() {
  refreshHomeView({ syncSettings: true });
  if (isPanelActive(PANEL.NOTEBOOK)) UI.renderNotebook(loadHistory());
  if (isPanelActive(PANEL.HISTORY)) UI.renderHistory(loadHistory());
  if (!document.getElementById('badgeModal')?.hidden) UI.renderBadgePage(loadHistory());
}

function importAllData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const count = importStoredData(e.target.result);
      UI.toast(`导入成功，共 ${count} 条测试记录`);
      refreshDataDependentPanels();
    } catch (err) {
      UI.toast(err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function bindImportInput() {
  const importInput = document.getElementById('importFile');
  if (importInput) {
    importInput.addEventListener('change', (e) => window.importAll(e));
  }
}

export function bindDataActions() {
  window.showPanel = name => showAppPanel(name);
  window.resetAll = () => resetAllData();
  window.clearHistory = () => clearHistoryData();
  window.exportAll = () => exportAllData();
  window.importAll = event => importAllData(event);
  window.closeBadgeModal = () => UI.closeBadgeModal();
  window.playWordAudioFromButton = (button) => {
    if (!playWordAudioFromButton(button)) {
      UI.toast('当前单词暂无音频');
    }
  };
  window.clearAudioCache = async () => {
    await clearCachedAudio();
    UI.toast('音频缓存已清空');
  };

  bindImportInput();
}
