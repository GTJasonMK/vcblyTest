import { PANEL } from './constants.js';

let initialized = false;

function isEditableTarget(target) {
  return target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

function isPanelActive(panelId) {
  return document.getElementById(panelId)?.classList.contains('active');
}

function handleReaderKeys(e, closeReader, switchReaderTab) {
  const readerModal = document.getElementById('readerModal');
  if (!readerModal || readerModal.hidden) return false;

  if (e.key === 'Escape') {
    closeReader();
    return true;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const onArticle = document.getElementById('readerTabArticle')?.classList.contains('active');
    const target = e.key === 'ArrowRight' ? 'translation' : 'article';
    if ((target === 'translation' && onArticle) || (target === 'article' && !onArticle)) {
      switchReaderTab(target);
      e.preventDefault();
    }
  }
  return true;
}

function handleModalKeys(e, ui) {
  const badgeModal = document.getElementById('badgeModal');
  if (badgeModal && !badgeModal.hidden) {
    if (e.key === 'Escape') ui.closeBadgeModal();
    return true;
  }

  const historyModal = document.getElementById('historyModal');
  if (historyModal && !historyModal.hidden) {
    if (e.key === 'Escape') ui.closeHistoryModal();
    return true;
  }

  return false;
}

function handleTranslationKeys(e, translation) {
  if (!isPanelActive(PANEL.TRANSLATION)) return false;

  const key = e.key.toLowerCase();
  if (key === 'h') {
    e.preventDefault();
    translation.giveTranslationHint();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    translation.checkTranslationAnswer();
  } else if (key === 'n') {
    e.preventDefault();
    translation.startTranslationTraining();
  }
  return true;
}

function handleNotebookKeys(e, ui) {
  if (!isPanelActive(PANEL.NOTEBOOK)) return false;

  const key = e.key.toLowerCase();
  let handled = false;
  if (e.key === 'ArrowUp' || key === 'k') handled = ui.moveNotebookWord(-1);
  if (e.key === 'ArrowDown' || key === 'j') handled = ui.moveNotebookWord(1);
  if (e.key === 'ArrowLeft' || key === 'a') handled = ui.moveNotebookSession(-1);
  if (e.key === 'ArrowRight' || key === 'd') handled = ui.moveNotebookSession(1);
  if (key === 'p') handled = ui.playNotebookSelectedAudio();
  if (e.key === 'Enter' || e.key === ' ') handled = ui.selectNotebookCurrentWord();
  if (handled) e.preventDefault();
  return true;
}

function handleReviewKeys(e, sessionApi) {
  if (!isPanelActive(PANEL.REVIEW)) return false;

  if (e.key === 'ArrowLeft' || e.key === 'a') sessionApi.reviewPrev();
  if (e.key === 'ArrowRight' || e.key === 'd') sessionApi.reviewNext();
  if (e.key === 'g' && !isEditableTarget(e.target)) {
    e.preventDefault();
    const input = document.getElementById('reviewJumpInput');
    if (input) {
      input.focus();
      input.select();
    }
  }
  if (e.key === 'Escape') {
    const input = document.getElementById('reviewJumpInput');
    if (input) input.blur();
  }
  return true;
}

function handleTestKeys(e, sessionState, sessionApi) {
  if (!isPanelActive(PANEL.TEST) || !sessionState.active) return false;

  if (['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    sessionApi.selectAnswer(parseInt(e.key, 10) - 1);
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn && nextBtn.style.display !== 'none') {
      sessionApi.nextWord();
    }
  }
  return true;
}

export function initKeyboardShortcuts({
  sessionState,
  ui,
  sessionApi,
  translation,
  closeReader,
  switchReaderTab,
}) {
  if (initialized) return;
  initialized = true;

  document.addEventListener('keydown', (e) => {
    // 阅读器浮窗优先处理，避免输入框残留焦点阻断 ←/→/Esc。
    if (handleReaderKeys(e, closeReader, switchReaderTab)) return;
    if (isEditableTarget(e.target)) return;
    if (handleModalKeys(e, ui)) return;
    if (handleTranslationKeys(e, translation)) return;
    if (handleNotebookKeys(e, ui)) return;
    if (handleReviewKeys(e, sessionApi)) return;
    handleTestKeys(e, sessionState, sessionApi);
  });
}
