// ========== 全局状态管理（单例） ==========

import { DEFAULT_MAX_UNKNOWN } from './constants.js';
import { loadSettings } from './storage.js';

/** 全部单词数据（从 WORDS_DATA 全局变量加载） */
export let allWords = [];

/** 应用设置（必须在session之前初始化，createEmptySession依赖此值） */
export let settings = loadSettings();

/** 当前测试会话状态 */
export let session = createEmptySession();

/** 初始化词库 */
export function initWords() {
  if (typeof WORDS_DATA !== 'undefined' && WORDS_DATA.length > 0) {
    allWords = WORDS_DATA;
  }
  return allWords.length;
}

/** 创建空会话 */
export function createEmptySession() {
  return {
    active: false,
    order: [],          // 随机后的单词索引序列
    cursor: 0,          // 当前测试位置
    todayUnknown: [],   // 本次选错的单词 [{idx, w, uk, us, d}]
    testedCount: 0,     // 已测试数量
    correctCount: 0,    // 正确数量
    maxUnknown: settings.maxUnknown || DEFAULT_MAX_UNKNOWN,
    options: [],        // 当前题目的选项 [{text, isCorrect}]
    answered: false,    // 当前题是否已作答
    correctIdx: -1,     // 当前题正确答案的选项索引
    awaitingNext: false, // 答错后等待点击"下一个"
  };
}

/** 重置会话 */
export function resetSession() {
  session = createEmptySession();
  session.maxUnknown = settings.maxUnknown;
}

/** 从保存的数据恢复会话（用于断点续测） */
export function restoreSession(saved) {
  session = createEmptySession();
  session.active = true;
  session.order = saved.order;
  session.cursor = saved.cursor;
  session.todayUnknown = saved.todayUnknown || [];
  session.testedCount = saved.testedCount || 0;
  session.correctCount = saved.correctCount || 0;
  session.maxUnknown = saved.maxUnknown;
  session.awaitingNext = saved.awaitingNext || false;
}

/** 更新设置并同步到session */
export function updateSettings(maxUnknown) {
  settings.maxUnknown = maxUnknown;
  session.maxUnknown = maxUnknown;
}

/** 获取当前要测试的单词 */
export function getCurrentWord() {
  if (session.cursor >= allWords.length) return null;
  const idx = session.order[session.cursor];
  return allWords[idx];
}

/** 获取当前单词在allWords中的索引 */
export function getCurrentWordIndex() {
  if (session.cursor >= session.order.length) return -1;
  return session.order[session.cursor];
}
