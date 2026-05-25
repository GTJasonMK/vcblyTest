import { loadHistory } from './storage.js';
import * as UI from './ui.js';
import { refreshHomeView } from './home-view.js';

export function showAppPanel(name) {
  if (name === 'badges') {
    UI.openBadgeModal(loadHistory());
    return;
  }

  UI.showPanel(name);
  if (name === 'history') UI.renderHistory(loadHistory());
  if (name === 'notebook') UI.renderNotebook(loadHistory());
  if (name === 'home') refreshHomeView();
  if (name === 'result') UI.renderResult();
}

export function showHashPanel() {
  const params = new URLSearchParams(location.search);
  const hrefPanel = location.href.match(/[?&#]panel=([^&#]+)/)?.[1];
  const name = decodeURIComponent((params.get('panel') || hrefPanel || location.hash.replace('#', '')).trim());
  if (['history', 'notebook', 'badges', 'translation'].includes(name)) {
    showAppPanel(name);
  } else {
    showAppPanel('home');
  }
}
