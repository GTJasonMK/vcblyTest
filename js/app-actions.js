import { session } from './state.js';
import * as UI from './ui.js';
import * as Session from './session.js';
import {
  openReaderWithWords,
  closeReader,
  regenReaderArticle,
  startGenerateReader,
  startGenerateTranslation,
  switchReaderTab,
} from './ui-reader.js';
import { initKeyboardShortcuts } from './keyboard-shortcuts.js';
import { bindDataActions } from './app-data-actions.js';
import { showAppPanel } from './app-panels.js';
import * as AiConfig from './ui-ai-config.js';
import * as AiDetail from './ui-ai-detail.js';
import * as ReviewExamples from './ui-review-examples.js';
import * as Translation from './ui-translation.js';

let initialized = false;

function toggleReviewDef() {
  const el = document.getElementById('reviewDef');
  const btn = document.getElementById('reviewToggleDefBtn');
  if (!el || !btn) return;
  const show = el.classList.toggle('show');
  btn.textContent = show ? '🙈' : '👁️';
  btn.title = show ? '遮挡释义' : '显示释义';
  btn.dataset.blurred = show ? 'false' : 'true';
}

function bindSessionActions() {
  window.startSession = () => Session.startSession();
  window.resumeSession = () => Session.resumeSession();
  window.selectAnswer = idx => Session.selectAnswer(idx);
  window.markUnknown = () => Session.markUnknown();
  window.nextWord = () => Session.nextWord();
  window.endSessionEarly = () => Session.endSessionEarly();
  window.playCurrentWordAudio = () => Session.playCurrentWordAudio();
  window.startReview = () => {
    window._reviewFromNotebook = false;
    Session.startReview();
  };
  window.reviewPrev = () => Session.reviewPrev();
  window.reviewNext = () => Session.reviewNext();
  window.reviewJumpTo = n => Session.reviewJumpTo(n);
  window.playReviewWordAudio = () => Session.playReviewWordAudio();
  window.reviewBack = () => showAppPanel('result');
  window.toggleReviewDef = () => toggleReviewDef();
}

function bindReaderActions() {
  window.openReaderWithWords = (words, opts) => openReaderWithWords(words, opts);
  window.closeReader = () => closeReader();
  window.regenReaderArticle = () => regenReaderArticle();
  window.startGenerateReader = () => startGenerateReader();
  window.startGenerateTranslation = () => startGenerateTranslation();
  window.switchReaderTab = tab => switchReaderTab(tab);
}

function bindTranslationActions() {
  window.startTranslationTraining = () => Translation.startTranslationTraining();
  window.checkTranslationAnswer = () => Translation.checkTranslationAnswer();
  window.giveTranslationHint = () => Translation.giveTranslationHint();
}

function bindAiActions() {
  window.openAiDetailModal = () => AiDetail.openAiDetailModal();
  window.closeAiDetailModal = () => AiDetail.closeAiDetailModal();
  window.switchAiDetailTab = tab => AiDetail.switchAiDetailTab(tab);
  window.generateAiDetail = (tab, force = false) => AiDetail.generateAiDetail(tab, force);
  window.sendAiQuestion = () => AiDetail.sendAiQuestion();
  window.fetchAndShowExample = () => ReviewExamples.fetchAndShowExample();
  window.toggleAiConfig = () => AiConfig.toggleAiConfig();
  window.saveAiConfigForm = () => AiConfig.saveAiConfigForm();
  window.testAiConfig = () => AiConfig.testAiConfig();
}

export function bindAppActions() {
  if (initialized) return;
  initialized = true;

  bindSessionActions();
  bindDataActions();
  bindReaderActions();
  bindTranslationActions();
  bindAiActions();

  initKeyboardShortcuts({
    sessionState: session,
    ui: UI,
    sessionApi: Session,
    translation: Translation,
    closeReader,
    switchReaderTab,
  });
}
