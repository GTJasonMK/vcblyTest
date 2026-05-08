// ========== 测试会话核心逻辑 ==========

import { allWords, session, getCurrentWord, getCurrentWordIndex, resetSession, restoreSession } from './state.js';
import { updateSettings } from './state.js';
import { saveSettings, loadHistory, saveHistory, saveSession, loadSession, clearSession } from './storage.js';
import * as UI from './ui.js';
import { playWordAudio } from './audio.js';

/** Fisher-Yates洗牌 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 生成随机索引序列 */
function shuffleIndices(length) {
  return shuffle(Array.from({ length }, (_, i) => i));
}

/** 为当前单词生成4个选项（1个正确释义+3个随机错误释义），返回选项数组 */
function generateOptions(correctIdx) {
  const correctWord = allWords[correctIdx];
  const correctDef = correctWord.d;

  // 随机选3个不同的错误单词
  const pool = [];
  for (let i = 0; i < allWords.length; i++) {
    if (i !== correctIdx) pool.push(i);
  }
  const wrongIndices = shuffle(pool).slice(0, 3);

  const options = [
    { text: correctDef, isCorrect: true },
    ...wrongIndices.map(i => ({ text: allWords[i].d, isCorrect: false })),
  ];

  // 洗牌打乱顺序
  const shuffled = shuffle(options);
  const correctOptIdx = shuffled.findIndex(o => o.isCorrect);

  return { options: shuffled, correctOptIdx };
}

/** 自动保存当前测试进度 */
function autoSave() {
  saveSession(session);
}

/** 开始新一轮测试 */
export function startSession() {
  if (!allWords.length) {
    UI.toast('词库未加载，请刷新页面');
    return;
  }

  clearSession(); // 丢弃旧进度

  const maxUnknown = UI.getMaxUnknownInput();
  saveSettings({ maxUnknown });
  updateSettings(maxUnknown);
  resetSession();

  session.active = true;
  session.order = shuffleIndices(allWords.length);
  session.cursor = 0;
  session.maxUnknown = maxUnknown;

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
    // 禁用选项（因为是上一轮的结果）
    document.getElementById('optionsGrid').innerHTML = '';
  } else {
    // 正常恢复：重新生成选项
    const idx = getCurrentWordIndex();
    const { options, correctOptIdx } = generateOptions(idx);
    session.options = options;
    session.correctIdx = correctOptIdx;
    session.answered = false;
    UI.renderOptions(options);
  }

  UI.updateProgress();
}

/** 显示当前单词及其选项 */
function showCurrentWord() {
  UI.renderTestWord();

  const idx = getCurrentWordIndex();
  const { options, correctOptIdx } = generateOptions(idx);
  session.options = options;
  session.correctIdx = correctOptIdx;
  session.answered = false;

  UI.renderOptions(options);
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

/** 用户选择答案 */
export function selectAnswer(optIdx) {
  if (!session.active || session.answered) return;
  session.answered = true;
  session.testedCount++;

  const isCorrect = session.options[optIdx].isCorrect;

  UI.showAnswerFeedback(optIdx, session.correctIdx);

  if (isCorrect) {
    session.correctCount++;
    session.cursor++;
    UI.updateProgress();
    autoSave();
    // 显示释义，短暂高亮后自动下一题
    UI.flashCorrectAndAdvance(() => advanceOrReshuffle());
  } else {
    // 选错：加入单词本
    const wordIdx = getCurrentWordIndex();
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
    // 显示释义和"下一个"按钮
    document.getElementById('defText').classList.add('show');
    document.getElementById('nextBtn').style.display = 'flex';

    if (session.todayUnknown.length >= session.maxUnknown) {
      setTimeout(() => endSession(), 600);
    }
  }
}

/** 进入下一个单词 */
export function nextWord() {
  if (!session.active) return;
  session.awaitingNext = false;
  session.cursor++;
  autoSave();
  advanceOrReshuffle();

  if (session.todayUnknown.length >= session.maxUnknown) {
    endSession();
  }
}

/** 推进游标，如果一轮耗尽则结束测试（保证同一次测试不出现重复单词） */
function advanceOrReshuffle() {
  if (session.cursor >= session.order.length) {
    // 全部单词已测完一轮，结束本次测试
    endSession();
    return;
  }
  if (session.active) {
    showCurrentWord();
  }
}

/** 结束本轮测试 */
export function endSession() {
  if (!session.active) return;
  session.active = false;
  clearSession(); // 测试结束，清除进度

  const history = loadHistory();
  history.push({
    date: new Date().toISOString(),
    words: session.todayUnknown.map(w => ({ idx: w.idx, w: w.w, uk: w.uk, us: w.us, d: w.d })),
    testedCount: session.testedCount,
    correctCount: session.correctCount,
  });
  saveHistory(history);

  UI.showPanel('result');
  UI.renderResult();
}

/** 提前结束 */
export function endSessionEarly() {
  if (!session.active) return;
  if (!confirm('确定要提前结束本轮测试吗？当前不会单词将记入单词本。')) return;

  session.active = false;
  clearSession(); // 测试结束，清除进度

  const history = loadHistory();
  history.push({
    date: new Date().toISOString(),
    words: session.todayUnknown.map(w => ({ idx: w.idx, w: w.w, uk: w.uk, us: w.us, d: w.d })),
    testedCount: session.testedCount,
    correctCount: session.correctCount,
  });
  saveHistory(history);

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
}

export function reviewPrev() {
  if (reviewIndex > 0) {
    reviewIndex--;
    UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
  }
}

export function reviewNext() {
  if (reviewIndex < session.todayUnknown.length - 1) {
    reviewIndex++;
    UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
  }
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
