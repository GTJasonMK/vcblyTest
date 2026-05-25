// ========== 测试会话核心逻辑 ==========

import { allWords, session, settings, getCurrentWord, getCurrentWordIndex, resetSession, restoreSession } from './state.js';
import { updateSettings } from './state.js';
import { saveSettings, loadHistory, saveHistory, saveSession, loadSession, clearSession, loadWordStats, recordWordResult } from './storage.js';
import * as UI from './ui.js';
import { autoplayWordAudio, playWordAudio, preloadWordAudioList } from './audio.js';
import {
  buildWeightedOrder,
  generateOptions,
  getWordProbabilities as getPlannerWordProbabilities,
  shuffle,
} from './session-planner.js';

export { computeBaseWeight } from './session-planner.js';

/** 获取所有单词的归一化概率（和为1），供可视化使用 */
export function getWordProbabilities() {
  const stats = loadWordStats();
  return getPlannerWordProbabilities(allWords, stats);
}

/** 自动保存当前测试进度（快速测试不保存） */
let _saveTimer = null;
function autoSave() {
  if (session.isQuickTest) return;
  // 异步延迟写入：连续多次答题只写一次，避免同步 JSON.stringify(30KB) 卡 UI
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (session.active) saveSession(session);
  }, 200);
}

function preloadTestAudioWindow() {
  const indices = session.order.slice(session.cursor, session.cursor + 5);
  preloadWordAudioList(
    indices.map(idx => ({ word: allWords[idx], index: idx })),
    { priority: 'high', warmMemory: true, prefetchedOnly: true }
  );
}

function autoplayCurrentTestWord() {
  if (settings.autoPlayAudio === false) return;
  const idx = getCurrentWordIndex();
  const word = allWords[idx];
  if (!word) return;
  autoplayWordAudio(word, idx, document.getElementById('wordAudioBtn'));
}

function recordPendingWordResult(wordIdx, isCorrect) {
  if (session.isQuickTest) return;
  if (!Array.isArray(session.wordResults)) session.wordResults = [];
  session.wordResults.push({ idx: wordIdx, isCorrect: Boolean(isCorrect) });
}

function commitPendingWordResults() {
  if (session.isQuickTest || !Array.isArray(session.wordResults)) return;
  session.wordResults.forEach(result => {
    if (!Number.isInteger(result?.idx)) return;
    recordWordResult(result.idx, result.isCorrect === true);
  });
  session.wordResults = [];
}

/** 开始本次测试 */
export function startSession() {
  if (!allWords.length) {
    UI.toast('词库未加载，请刷新页面');
    return;
  }

  clearSession(); // 丢弃旧进度

  const savedSettings = saveSettings(UI.getHomeSettingsInput());
  updateSettings(savedSettings);
  resetSession();

  session.active = true;
  session.order = buildWeightedOrder(allWords, loadWordStats());
  session.cursor = 0;
  session.maxUnknown = savedSettings.maxUnknown;

  UI.showPanel('test');
  showCurrentWord();
  autoSave();
}

/** 对指定词表开始测试（词汇地图范围筛选） */
export function startFilteredSession(indices) {
  if (!allWords.length) {
    UI.toast('词库未加载，请刷新页面');
    return;
  }
  if (!indices || indices.length === 0) {
    UI.toast('范围内没有单词');
    return;
  }

  clearSession();

  const savedSettings = saveSettings(UI.getHomeSettingsInput());
  updateSettings(savedSettings);
  resetSession();

  session.active = true;
  session.isQuickTest = true; // 快速测试，不记入历史
  // 对指定索引做随机洗牌
  session.order = shuffle(indices);
  session.cursor = 0;
  session.maxUnknown = Math.min(savedSettings.maxUnknown, indices.length);

  UI.showPanel('test');
  showCurrentWord();
  autoSave();
}

/** 恢复未完成的测试 */
export function resumeSession() {
  const saved = loadSession();
  if (!saved) {
    UI.toast('没有可恢复的测试');
    return;
  }
  // 边界校验：损坏的 saved（order 缺失或 cursor 越界）直接丢弃，避免后续 renderTestWord 卡住。
  if (!Array.isArray(saved.order) || saved.order.length === 0
      || !Number.isInteger(saved.cursor) || saved.cursor < 0
      || saved.cursor >= saved.order.length) {
    clearSession();
    UI.toast('保存的测试数据已损坏，已清除');
    return;
  }
  restoreSession(saved);
  UI.showPanel('test');
  UI.renderTestWord();

  if (session.awaitingNext) {
    // 上次答错后未点"下一个"，直接显示释义和"下一个"按钮
    const idx = getCurrentWordIndex();
    const word = allWords[idx];
    document.getElementById('defText').textContent = word.d;
    document.getElementById('defText').classList.add('show');
    document.getElementById('nextBtn').style.display = 'flex';
    // 禁用选项（因为是上次保存的结果）
    document.getElementById('optionsGrid').innerHTML = '';
  } else {
    // 正常恢复：重新生成选项
    const idx = getCurrentWordIndex();
    const { options, correctOptIdx } = generateOptions(allWords, idx);
    session.options = options;
    session.correctIdx = correctOptIdx;
    session.answered = false;
    UI.renderOptions(options);
  }

  UI.updateProgress();
  preloadTestAudioWindow();
  autoplayCurrentTestWord();
}

/** 显示当前单词及其选项 */
function showCurrentWord() {
  UI.renderTestWord();

  const idx = getCurrentWordIndex();
  const { options, correctOptIdx } = generateOptions(allWords, idx);
  session.options = options;
  session.correctIdx = correctOptIdx;
  session.answered = false;

  UI.renderOptions(options);
  preloadTestAudioWindow();
  autoplayCurrentTestWord();
}

/** 播放当前测试单词发音 */
export function playCurrentWordAudio() {
  const idx = getCurrentWordIndex();
  const word = allWords[idx];
  if (!word) return;
  const button = document.getElementById('wordAudioBtn');
  if (!playWordAudio(word, idx, button)) {
    UI.toast('当前单词暂无音频');
  }
}

/** 不认识当前单词 —— 直接标记为错词，无需猜测 */
export function markUnknown() {
  if (!session.active || session.answered) return;
  session.answered = true;
  session.testedCount++;

  const wordIdx = getCurrentWordIndex();
  const word = allWords[wordIdx];

  // 加入生词本
  if (!session.todayUnknown.find(w => w.idx === wordIdx)) {
    session.todayUnknown.push({
      idx: wordIdx,
      w: word.w,
      uk: word.uk,
      us: word.us,
      d: word.d,
    });
  }

  recordPendingWordResult(wordIdx, false);

  // 高亮正确选项，帮助学习
  UI.showAnswerFeedback(-1, session.correctIdx);

  UI.updateProgress();
  session.awaitingNext = true;
  autoSave();
  document.getElementById('nextBtn').style.display = 'flex';

  if (session.todayUnknown.length >= session.maxUnknown) {
    setTimeout(() => endSession(), 600);
  }
}

/** 用户选择答案 */
export function selectAnswer(optIdx) {
  if (!session.active || session.answered) return;
  // 防御：恢复未完成测试时 options 可能尚未生成，键盘 1-4 走到这里要直接忽略。
  if (!Array.isArray(session.options) || !session.options[optIdx]) return;
  session.answered = true;
  session.testedCount++;

  const wordIdx = getCurrentWordIndex();
  const isCorrect = session.options[optIdx].isCorrect;

  recordPendingWordResult(wordIdx, isCorrect);

  UI.showAnswerFeedback(optIdx, session.correctIdx);

  if (isCorrect) {
    session.correctCount++;
    session.cursor++;
    UI.updateProgress();
    autoSave();
    // 选项已高亮正确答案，短暂停留后自动下一题
    setTimeout(() => advanceOrReshuffle(), 400);
  } else {
    // 选错：加入单词本
    const word = allWords[wordIdx];

    if (!session.todayUnknown.find(w => w.idx === wordIdx)) {
      session.todayUnknown.push({
        idx: wordIdx,
        w: word.w,
        uk: word.uk,
        us: word.us,
        d: word.d,
      });
    }

    UI.updateProgress();
    session.awaitingNext = true;
    autoSave();
    document.getElementById('nextBtn').style.display = 'flex';

    if (session.todayUnknown.length >= session.maxUnknown) {
      setTimeout(() => endSession(), 600);
    }
  }
}

/** 进入下一个单词 */
export function nextWord() {
  if (!session.active) return;
  // 已达上限则直接结束，避免下一题闪现
  if (session.todayUnknown.length >= session.maxUnknown) {
    endSession();
    return;
  }
  session.awaitingNext = false;
  session.cursor++;
  autoSave();
  advanceOrReshuffle();
}

/** 推进游标，如果本次抽样序列耗尽则结束测试（保证同一次测试不出现重复单词） */
function advanceOrReshuffle() {
  if (session.cursor >= session.order.length) {
    // 全部单词已测完，结束本次测试
    endSession();
    return;
  }
  if (session.active) {
    showCurrentWord();
  }
}

/** 结束本次测试 */
export function endSession() {
  if (!session.active) return;
  const isQuick = session.isQuickTest;
  session.endedEarly = false;
  session.active = false;
  clearSession();

  // 快速测试不记入历史，但仍显示结果
  if (!isQuick) {
    commitPendingWordResults();
    const history = loadHistory();
    history.push({
      date: new Date().toISOString(),
      words: session.todayUnknown.map(w => ({ idx: w.idx, w: w.w, uk: w.uk, us: w.us, d: w.d })),
      testedCount: session.testedCount,
      correctCount: session.correctCount,
    });
    saveHistory(history);
  }

  UI.showPanel('result');
  UI.renderResult();
}

/** 提前结束 */
export function endSessionEarly() {
  if (!session.active) return;
  const qmsg = session.isQuickTest
    ? '确定要提前结束本次快速测试吗？'
    : '确定要提前结束本次测试吗？提前结束不会记入历史记录。';
  if (!confirm(qmsg)) return;

  session.endedEarly = true;
  session.active = false;
  session.wordResults = [];
  clearSession();

  UI.showPanel('result');
  UI.renderResult();
}

// ===== 复习模式 =====
let reviewIndex = 0;

export function startReview() {
  if (session.todayUnknown.length === 0) {
    UI.toast('没有需要复习的单词');
    return;
  }
  reviewIndex = 0;
  UI.showPanel('review');
  UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
  preloadReviewAudioWindow();
  autoplayCurrentReviewWord();
}

export function reviewPrev() {
  if (reviewIndex > 0) {
    reviewIndex--;
    UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
    preloadReviewAudioWindow();
    autoplayCurrentReviewWord();
  }
}

export function reviewNext() {
  if (reviewIndex < session.todayUnknown.length - 1) {
    reviewIndex++;
    UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
    preloadReviewAudioWindow();
    autoplayCurrentReviewWord();
  }
}

function preloadReviewAudioWindow() {
  const start = Math.max(0, reviewIndex - 2);
  const words = session.todayUnknown.slice(start, reviewIndex + 3);
  preloadWordAudioList(
    words.map(w => ({ word: w, index: w.idx })),
    { priority: 'high', warmMemory: true, prefetchedOnly: true }
  );
}

function autoplayCurrentReviewWord() {
  if (settings.autoPlayAudio === false) return;
  const word = session.todayUnknown[reviewIndex];
  if (!word) return;
  autoplayWordAudio(word, word.idx, document.getElementById('reviewAudioBtn'));
}

/** 播放当前复习单词发音 */
export function playReviewWordAudio() {
  const word = session.todayUnknown[reviewIndex];
  if (!word) return;
  const button = document.getElementById('reviewAudioBtn');
  if (!playWordAudio(word, word.idx, button)) {
    UI.toast('当前单词暂无音频');
  }
}

/** 跳转到复习列表中的指定位置（1-based） */
export function reviewJumpTo(n) {
  const total = session.todayUnknown.length;
  if (total === 0) return;
  const target = Math.max(1, Math.min(total, Math.floor(Number(n)) || 1)) - 1;
  if (target === reviewIndex) return;
  reviewIndex = target;
  UI.renderReviewWord(reviewIndex, total);
  preloadReviewAudioWindow();
  autoplayCurrentReviewWord();
}

/** 获取当前复习单词的信息 */
export function getCurrentReviewWord() {
  return session.todayUnknown[reviewIndex] || null;
}

/** 获取当前复习索引 */
export function getReviewIndex() {
  return reviewIndex;
}
