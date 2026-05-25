// ========== localStorage 读写封装 ==========

import { STORAGE_KEY, DEFAULT_MAX_UNKNOWN, DEFAULT_AUTO_PLAY_AUDIO, MAX_HISTORY_ITEMS } from './constants.js';

const AI_DETAIL_CACHE_PREFIX = 'vcbly_ai_';
const EXAMPLE_CACHE_PREFIX = 'vcbly_examples_';

function getAiDetailCacheKey(word, tab) {
  return `${AI_DETAIL_CACHE_PREFIX}${word}_${tab}`;
}

function getExampleCacheKey(word) {
  return `${EXAMPLE_CACHE_PREFIX}${word}`;
}

function isExtraCacheKey(key) {
  return Boolean(key && (key.startsWith(AI_DETAIL_CACHE_PREFIX) || key.startsWith(EXAMPLE_CACHE_PREFIX)));
}

function collectExtraCache() {
  const cache = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (isExtraCacheKey(key)) cache[key] = localStorage.getItem(key);
    }
  } catch {}
  return cache;
}

function clearExtraCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (isExtraCacheKey(key)) localStorage.removeItem(key);
    }
  } catch {}
}

function restoreExtraCache(cacheData) {
  if (!cacheData || typeof cacheData !== 'object') return;
  try {
    for (const [key, val] of Object.entries(cacheData)) {
      if (isExtraCacheKey(key)) localStorage.setItem(key, val);
    }
  } catch {}
}

function normalizeSettings(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const maxUnknownSource = source.maxUnknown ?? fallbackSource.maxUnknown;
  const maxUnknown = Number.isFinite(Number(maxUnknownSource))
    ? Math.max(1, Math.floor(Number(maxUnknownSource)))
    : DEFAULT_MAX_UNKNOWN;
  const autoPlayAudio = typeof source.autoPlayAudio === 'boolean'
    ? source.autoPlayAudio
    : (typeof fallbackSource.autoPlayAudio === 'boolean' ? fallbackSource.autoPlayAudio : DEFAULT_AUTO_PLAY_AUDIO);
  return { maxUnknown, autoPlayAudio };
}

/** 读取设置 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY.SETTINGS);
    if (raw) {
      const s = JSON.parse(raw);
      return normalizeSettings(s);
    }
  } catch { /* 忽略解析错误，返回默认值 */ }
  return normalizeSettings();
}

/** 保存设置 */
export function saveSettings(settings) {
  const normalized = normalizeSettings(settings, loadSettings());
  localStorage.setItem(STORAGE_KEY.SETTINGS, JSON.stringify(normalized));
  return normalized;
}

/** 读取历史记录 */
export function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY.HISTORY) || '[]');
    const cleaned = normalizeHistoryList(raw);
    if (Array.isArray(raw) && cleaned.length !== raw.length) {
      saveHistory(cleaned);
    }
    return cleaned;
  } catch { return []; }
}

/** 保存历史记录（自动裁剪超量条目） */
export function saveHistory(history) {
  history = normalizeHistoryList(history);
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
  localStorage.removeItem(STORAGE_KEY.AI_CONFIG);
  localStorage.removeItem(STORAGE_KEY.READER_ARTICLES);
  clearSession();
  clearExtraCache();
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
  // 只保存剩余未测部分（cursor 之后），每次省 ~15KB
  const slim = {
    order: Array.isArray(sessionData.order) ? sessionData.order.slice(sessionData.cursor) : sessionData.order,
    cursor: 0,
    todayUnknown: sessionData.todayUnknown,
    testedCount: sessionData.testedCount,
    correctCount: sessionData.correctCount,
    maxUnknown: sessionData.maxUnknown,
    awaitingNext: sessionData.awaitingNext || false,
    isQuickTest: sessionData.isQuickTest || false,
    wordResults: Array.isArray(sessionData.wordResults) ? sessionData.wordResults : [],
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

// ===== 阅读训练文章 =====

/** 读取全部阅读文章：{ dateKey: { sessionKey: article } } */
export function loadReaderArticles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.READER_ARTICLES) || '{}');
  } catch { return {}; }
}

/** 保存全部阅读文章 */
export function saveReaderArticles(articles) {
  if (!articles || Object.keys(articles).length === 0) {
    localStorage.removeItem(STORAGE_KEY.READER_ARTICLES);
    return;
  }
  // 自动清理：超过 90 天的文章
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const now = new Date();
  for (const dateKey of Object.keys(articles)) {
    const d = new Date(dateKey);
    if (isNaN(d.getTime()) || d.getTime() < cutoff) {
      delete articles[dateKey];
    }
  }
  localStorage.setItem(STORAGE_KEY.READER_ARTICLES, JSON.stringify(articles));
}

/** 获取指定文章 */
export function getReaderArticle(dateKey, sessionKey) {
  const all = loadReaderArticles();
  return (all[dateKey] && all[dateKey][sessionKey]) ? all[dateKey][sessionKey] : null;
}

/** 保存/更新指定文章 */
export function saveReaderArticle(dateKey, sessionKey, article) {
  const all = loadReaderArticles();
  if (!all[dateKey]) all[dateKey] = {};
  all[dateKey][sessionKey] = article;
  saveReaderArticles(all);
}

/** 删除指定文章 */
export function deleteReaderArticle(dateKey, sessionKey) {
  const all = loadReaderArticles();
  if (all[dateKey]) {
    delete all[dateKey][sessionKey];
    if (Object.keys(all[dateKey]).length === 0) delete all[dateKey];
  }
  saveReaderArticles(all);
}

// ===== AI API 配置 =====

export function loadAiConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.AI_CONFIG)) || {};
  } catch { return {}; }
}

export function saveAiConfig(config) {
  localStorage.setItem(STORAGE_KEY.AI_CONFIG, JSON.stringify(config));
}

// ===== AI 详解与例句缓存 =====

export function loadAiDetailCache(word, tab) {
  try {
    const raw = localStorage.getItem(getAiDetailCacheKey(word, tab));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveAiDetailCache(word, tab, text) {
  try {
    localStorage.setItem(getAiDetailCacheKey(word, tab), JSON.stringify({
      text,
      word,
      tab,
      time: Date.now(),
    }));
    return true;
  } catch { return false; }
}

export function loadExampleCache(word) {
  try {
    const raw = localStorage.getItem(getExampleCacheKey(word));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveExampleCache(word, examples) {
  try {
    localStorage.setItem(getExampleCacheKey(word), JSON.stringify(examples));
    return true;
  } catch { return false; }
}

// ===== 全量数据导入导出 =====

/** 校验单条历史记录形状：缺关键字段则丢弃 */
function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const dateMs = new Date(entry.date).getTime();
  if (!Number.isFinite(dateMs)) return null;
  const words = Array.isArray(entry.words)
    ? entry.words.filter(w => w && typeof w === 'object' && typeof w.w === 'string')
    : [];
  const hasTestedCount = entry.testedCount !== undefined && entry.testedCount !== null && entry.testedCount !== '';
  const testedRaw = Number(entry.testedCount);
  const tested = hasTestedCount && Number.isFinite(testedRaw)
    ? Math.max(0, Math.floor(testedRaw))
    : words.length;
  if (tested <= 0) return null;
  const correct = Math.max(0, Math.floor(Number(entry.correctCount) || 0));
  return {
    date: entry.date,
    words,
    testedCount: tested,
    correctCount: Math.min(correct, tested),
  };
}

function normalizeHistoryList(history) {
  if (!Array.isArray(history)) return [];
  return history.map(sanitizeHistoryEntry).filter(Boolean);
}

/** 校验词级统计：剔除 tested/wrong 异常的条目，确保后续加权抽样不退化为 NaN */
function sanitizeWordStats(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const tested = Math.max(0, Math.floor(Number(val.tested) || 0));
    if (tested === 0) continue;
    const wrongRaw = Math.floor(Number(val.wrong) || 0);
    const wrong = Math.max(0, Math.min(wrongRaw, tested));
    cleaned[key] = { tested, wrong };
  }
  return cleaned;
}

/** 导出全量数据为 JSON 文件下载 */
export function exportAll() {
  const history = loadHistory();
  const wordStats = loadWordStats();
  const extraCache = collectExtraCache();
  const session = loadSession();
  const readerArticles = loadReaderArticles();
  if (history.length === 0 && Object.keys(wordStats).length === 0 && Object.keys(extraCache).length === 0 && !session && Object.keys(readerArticles).length === 0) {
    return null;
  }
  const data = {
    version: 4,
    exportedAt: new Date().toISOString(),
    history,
    wordStats,
    settings: loadSettings(),
    theme: loadTheme(),
    aiConfig: loadAiConfig(),
    session,
    readerArticles,
  };
  if (Object.keys(extraCache).length > 0) data.extraCache = extraCache;
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
      const cleaned = data.map(sanitizeHistoryEntry).filter(Boolean);
      // 与新格式保持一致的"导入=替换"语义：清掉非历史的其他数据
      clearWordStats();
      clearSession();
      clearExtraCache();
      saveHistory(cleaned);
      return cleaned.length;
    }

    // 新格式：完整数据对象，直接替换当前数据（不清除会重复）
    if (!data.history || !Array.isArray(data.history)) {
      throw new Error('格式错误：缺少 history 字段');
    }

    const cleaned = data.history.map(sanitizeHistoryEntry).filter(Boolean);
    saveHistory(cleaned);

    if (data.wordStats) {
      saveWordStats(sanitizeWordStats(data.wordStats));
    }

    // 恢复设置（仅当新数据中存在合法值时）
    if (data.settings && typeof data.settings === 'object') {
      saveSettings(data.settings);
    }

    // 恢复 AI 缓存 + 例句缓存
    const cacheData = data.aiCache || data.extraCache;
    restoreExtraCache(cacheData);

    // 恢复主题偏好
    if (data.theme && ['dark', 'light', 'auto'].includes(data.theme)) {
      saveTheme(data.theme);
    }

    // 恢复 AI 配置
    if (data.aiConfig && typeof data.aiConfig === 'object') {
      try { saveAiConfig(data.aiConfig); } catch {}
    }

    // 恢复未完成的测试（先清除再写入，避免残留）
    clearSession();
    if (data.session && typeof data.session === 'object'
        && Array.isArray(data.session.order) && data.session.order.length > 0) {
      try { localStorage.setItem(STORAGE_KEY.SESSION, JSON.stringify(data.session)); } catch {}
    }

    // 恢复阅读文章
    if (data.readerArticles && typeof data.readerArticles === 'object') {
      try { saveReaderArticles(data.readerArticles); } catch {}
    }

    return cleaned.length;
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
