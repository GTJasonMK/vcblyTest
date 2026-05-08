// ========== localStorage 读写封装 ==========

import { STORAGE_KEY, DEFAULT_MAX_UNKNOWN, MAX_HISTORY_ITEMS } from './constants.js';

/** 读取设置 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY.SETTINGS);
    if (raw) {
      const s = JSON.parse(raw);
      return { maxUnknown: s.maxUnknown || DEFAULT_MAX_UNKNOWN };
    }
  } catch { /* 忽略解析错误，返回默认值 */ }
  return { maxUnknown: DEFAULT_MAX_UNKNOWN };
}

/** 保存设置 */
export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY.SETTINGS, JSON.stringify(settings));
}

/** 读取历史记录 */
export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.HISTORY) || '[]');
  } catch { return []; }
}

/** 保存历史记录（自动裁剪超量条目） */
export function saveHistory(history) {
  if (history.length > MAX_HISTORY_ITEMS) {
    history = history.slice(-MAX_HISTORY_ITEMS);
  }
  localStorage.setItem(STORAGE_KEY.HISTORY, JSON.stringify(history));
}

/** 清空历史记录 */
export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY.HISTORY);
}

/** 清空全部数据（保留主题设置） */
export function clearAll() {
  localStorage.removeItem(STORAGE_KEY.HISTORY);
  localStorage.removeItem(STORAGE_KEY.SETTINGS);
  localStorage.removeItem(STORAGE_KEY.WORD_STATS);
  clearSession();
}

// ===== 每词答题统计（加权随机用） =====

/** 读取词级统计：{ [idx]: { tested, correct, wrong, last } } */
export function loadWordStats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.WORD_STATS) || '{}');
  } catch { return {}; }
}

/** 保存词级统计 */
export function saveWordStats(stats) {
  localStorage.setItem(STORAGE_KEY.WORD_STATS, JSON.stringify(stats));
}

/** 记录一次答题结果 */
export function recordWordResult(wordIdx, isCorrect) {
  const stats = loadWordStats();
  if (!stats[wordIdx]) {
    stats[wordIdx] = { tested: 0, wrong: 0 };
  }
  stats[wordIdx].tested++;
  if (!isCorrect) stats[wordIdx].wrong++;
  // 自动清理旧数据中的冗余字段
  delete stats[wordIdx].correct;
  delete stats[wordIdx].last;
  saveWordStats(stats);
}

/** 清空词级统计 */
export function clearWordStats() {
  localStorage.removeItem(STORAGE_KEY.WORD_STATS);
}

// ===== 未完成测试的保存与恢复 =====

/** 保存当前未完成的测试状态 */
export function saveSession(sessionData) {
  if (!sessionData.active) {
    clearSession();
    return;
  }
  // 只保存必要字段，避免存储过大
  const slim = {
    order: sessionData.order,
    cursor: sessionData.cursor,
    todayUnknown: sessionData.todayUnknown,
    testedCount: sessionData.testedCount,
    correctCount: sessionData.correctCount,
    maxUnknown: sessionData.maxUnknown,
    awaitingNext: sessionData.awaitingNext || false,
  };
  localStorage.setItem(STORAGE_KEY.SESSION, JSON.stringify(slim));
}

/** 读取未完成的测试状态，无则返回 null */
export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY.SESSION);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

/** 清除未完成的测试状态 */
export function clearSession() {
  localStorage.removeItem(STORAGE_KEY.SESSION);
}

// ===== 全量数据导入导出 =====

/** 导出全量数据为 JSON 文件下载 */
export function exportAll() {
  const history = loadHistory();
  const wordStats = loadWordStats();
  if (history.length === 0 && Object.keys(wordStats).length === 0) {
    return null;
  }
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    history,
    wordStats,
    settings: loadSettings(),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  a.download = `考研词汇数据-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** 导入全量数据 JSON 文件，合并覆盖现有数据 */
export function importAll(jsonText) {
  try {
    const data = JSON.parse(jsonText);

    // 兼容旧格式：纯数组（仅历史记录）
    if (Array.isArray(data)) {
      const merged = [...loadHistory(), ...data];
      merged.sort((a, b) => new Date(a.date) - new Date(b.date));
      saveHistory(merged);
      return merged.length;
    }

    // 新格式：完整数据对象
    if (!data.history || !Array.isArray(data.history)) {
      throw new Error('格式错误：缺少 history 字段');
    }

    // 合并历史记录
    const existing = loadHistory();
    const merged = [...existing, ...data.history];
    merged.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveHistory(merged);

    // 合并词级统计（保留已有，新数据覆盖）
    if (data.wordStats) {
      const existingStats = loadWordStats();
      const mergedStats = { ...existingStats, ...data.wordStats };
      saveWordStats(mergedStats);
    }

    // 恢复设置（仅当新数据中存在时）
    if (data.settings && data.settings.maxUnknown) {
      saveSettings(data.settings);
    }

    return merged.length;
  } catch (e) {
    throw new Error(`导入失败：${e.message}`);
  }
}

// ===== 主题 =====

/** 读取主题偏好：dark / light / null（自动跟随系统） */
export function loadTheme() {
  return localStorage.getItem(STORAGE_KEY.THEME) || 'auto';
}

/** 保存主题偏好 */
export function saveTheme(theme) {
  localStorage.setItem(STORAGE_KEY.THEME, theme);
}
