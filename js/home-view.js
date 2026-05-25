import { updateSettings } from './state.js';
import { loadSettings, loadHistory, loadSession, saveSettings } from './storage.js';
import { setAutoPlayAudioInput, setMaxUnknownInput } from './ui.js';
import * as UI from './ui.js';

export function syncHomeSettings() {
  const settings = loadSettings();
  setMaxUnknownInput(settings.maxUnknown);
  setAutoPlayAudioInput(settings.autoPlayAudio);
  updateSettings(settings);
}

export function refreshHomeView({ syncSettings = false } = {}) {
  if (syncSettings) syncHomeSettings();

  const history = loadHistory();
  UI.renderOverallStats(history);
  UI.renderResumeButton(loadSession());
  UI.renderHomeNotebookSummary(history);
  UI.renderWordMap();
}

export function bindHomeResizeRefresh() {
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById('panel-home')?.classList.contains('active')) {
        UI.renderWordMap();
      }
    }, 150);
  });
}

export function bindHomeSettingsSave() {
  const saveHomeSettings = () => {
    const settings = saveSettings(UI.getHomeSettingsInput());
    updateSettings(settings);
  };

  document.getElementById('maxUnknown')?.addEventListener('change', saveHomeSettings);
  document.getElementById('autoPlayAudio')?.addEventListener('change', saveHomeSettings);
}
