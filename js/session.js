// ========== 测试会话核心逻辑 ==========

import { allWords, session, getCurrentWord, getCurrentWordIndex, resetSession, restoreSession } from './state.js';
import { updateSettings } from './state.js';
import { saveSettings, loadHistory, saveHistory, saveSession, loadSession, clearSession, loadWordStats, recordWordResult } from './storage.js';
import * as UI from './ui.js';
import { playWordAudio, preloadWordAudioList } from './audio.js';

/** 计算每词基础权重（基于历史统计）
 *  全对最低 2.5，全错最高 5.0，未测过的新词为 5.0；
 *  权重越高越容易被抽到。 */
export function computeBaseWeight(stats, idx) {
  const s = stats[idx];
  const tested = Number(s?.tested);
  if (!Number.isFinite(tested) || tested <= 0) return 5.0;
  const wrongRaw = Number(s?.wrong);
  const wrong = Number.isFinite(wrongRaw) ? Math.max(0, Math.min(wrongRaw, tested)) : 0;
  return 2.5 + (wrong / tested) * 1.5;
}

/** 获取所有单词的归一化概率（和为1），供可视化使用 */
export function getWordProbabilities() {
  const stats = loadWordStats();
  const weights = allWords.map((_, i) => computeBaseWeight(stats, i));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / total);
}

/** 按权重比例无放回抽样（轮盘赌算法 + softmax 放大差距）
 *  每轮先对剩余词的权重做 softmax(T=0.5)，然后按概率落点。
 *  优化：merge maxW+exp 为一个循环，局部数组代替属性访问。 */
function buildWeightedOrder() {
  const stats = loadWordStats();
  const pool = allWords.map((_, i) => ({
    idx: i,
    weight: computeBaseWeight(stats, i),
  }));

  const order = [];
  // 局部数组缓存 exp 值，避免对象属性访问开销
  const expArr = new Array(pool.length);
  let len = pool.length;

  while (len > 0) {
    // 一轮循环完成：找 maxW + 算 exp + 求和
    let maxW = -Infinity;
    let expSum = 0;
    for (let i = 0; i < len; i++) {
      const w = pool[i].weight;
      if (w > maxW) maxW = w;
    }
    for (let i = 0; i < len; i++) {
      const e = Math.exp((pool[i].weight - maxW) / 0.5);
      expArr[i] = e;
      expSum += e;
    }

    const rand = Math.random();
    let acc = 0;
    let picked = false;
    for (let i = 0; i < len; i++) {
      acc += expArr[i] / expSum;
      if (rand < acc) {
        order.push(pool[i].idx);
        // swap-and-pop（O(1) 移除，同时交换 expArr 保持同步）
        const last = len - 1;
        if (i !== last) {
          const tmp = pool[i]; pool[i] = pool[last]; pool[last] = tmp;
          const etmp = expArr[i]; expArr[i] = expArr[last]; expArr[last] = etmp;
        }
        len--;
        picked = true;
        break;
      }
    }
    // 浮点安全兜底
    if (!picked && len > 0) {
      order.push(pool[len - 1].idx);
      len--;
    }
  }
  return order;
}

/** Fisher-Yates洗牌 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 为当前单词生成4个选项（1个正确释义+3个随机错误释义），返回选项数组 */
function generateOptions(correctIdx) {
  const correctDef = allWords[correctIdx].d;
  const total = allWords.length;

  // 拒绝采样：随机抽 3 个不同错误索引（避免 6000 元素 shuffle 的 GC 压力）
  const wrongIndices = [];
  const picked = new Set();
  while (wrongIndices.length < 3) {
    const r = Math.floor(Math.random() * total);
    if (r !== correctIdx && !picked.has(r)) {
      picked.add(r);
      wrongIndices.push(r);
    }
  }

  const options = [
    { text: correctDef, isCorrect: true },
    ...wrongIndices.map(i => ({ text: allWords[i].d, isCorrect: false })),
  ];

  // Fisher-Yates 洗 4 个选项
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  const correctOptIdx = options.findIndex(o => o.isCorrect);

  return { options, correctOptIdx };
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

/** 开始本次测试 */
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
  session.order = buildWeightedOrder();
  session.cursor = 0;
  session.maxUnknown = maxUnknown;

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

  const maxUnknown = UI.getMaxUnknownInput();
  saveSettings({ maxUnknown });
  updateSettings(maxUnknown);
  resetSession();

  session.active = true;
  session.isQuickTest = true; // 快速测试，不记入历史
  // 对指定索引做随机洗牌
  session.order = shuffle(indices);
  session.cursor = 0;
  session.maxUnknown = Math.min(maxUnknown, indices.length);

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
    const { options, correctOptIdx } = generateOptions(idx);
    session.options = options;
    session.correctIdx = correctOptIdx;
    session.answered = false;
    UI.renderOptions(options);
  }

  UI.updateProgress();
  preloadTestAudioWindow();
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
  preloadTestAudioWindow();
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

  // 记录词级统计（快速测试不记录）
  if (!session.isQuickTest) recordWordResult(wordIdx, false);

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

  // 记录词级统计（快速测试不记录）
  if (!session.isQuickTest) recordWordResult(wordIdx, isCorrect);

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

  if (session.todayUnknown.length >= session.maxUnknown) {
    endSession();
  }
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
  session.active = false;
  clearSession();

  // 快速测试不记入历史，但仍显示结果
  if (!isQuick) {
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
  const qmsg = session.isQuickTest ? '确定要提前结束本次快速测试吗？' : '确定要提前结束本次测试吗？当前不会单词将记入本次结果。';
  if (!confirm(qmsg)) return;

  const isQuick = session.isQuickTest;
  session.active = false;
  clearSession();

  if (!isQuick) {
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
}

export function reviewPrev() {
  if (reviewIndex > 0) {
    reviewIndex--;
    UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
    preloadReviewAudioWindow();
  }
}

export function reviewNext() {
  if (reviewIndex < session.todayUnknown.length - 1) {
    reviewIndex++;
    UI.renderReviewWord(reviewIndex, session.todayUnknown.length);
    preloadReviewAudioWindow();
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

/** 播放当前复习单词发音 */
export function playReviewWordAudio() {
  const word = session.todayUnknown[reviewIndex];
  if (!word) return;
  const button = document.getElementById('reviewAudioBtn');
  if (!playWordAudio(word, word.idx, button)) {
    UI.toast('当前单词暂无音频');
  }
}

/** 获取当前复习单词的信息 */
export function getCurrentReviewWord() {
  return session.todayUnknown[reviewIndex] || null;
}

/** 获取当前复习索引 */
export function getReviewIndex() {
  return reviewIndex;
}
