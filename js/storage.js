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
  clearSession();
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

// ===== 错词本导入导出 =====

/** 导出错词本为 JSON 文件下载 */
export function exportNotebook() {
  const history = loadHistory();
  if (history.length === 0) {
    return null; // 调用方应提示无数据
  }
  const json = JSON.stringify(history, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  a.download = `考研词汇错词本-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** 导入错词本 JSON 文件，合并到现有历史 */
export function importNotebook(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (!Array.isArray(data)) throw new Error('格式错误：需要数组');
    // 基本验证
    for (const item of data) {
      if (!item.date || !Array.isArray(item.words)) {
        throw new Error('格式错误：缺少必要字段');
      }
    }
    const existing = loadHistory();
    const merged = [...existing, ...data];
    // 按日期排序
    merged.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveHistory(merged);
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
