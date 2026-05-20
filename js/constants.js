// ========== DOM选择器与常量 ==========

// 面板ID
export const PANEL = {
  HOME: 'panel-home',
  TEST: 'panel-test',
  RESULT: 'panel-result',
  REVIEW: 'panel-review',
  HISTORY: 'panel-history',
  NOTEBOOK: 'panel-notebook',
  TRANSLATION: 'panel-translation',
};

// localStorage key
export const STORAGE_KEY = {
  HISTORY: 'vocab_history',
  SETTINGS: 'vocab_settings',
  THEME: 'vocab_theme',
  SESSION: 'vocab_session',   // 未完成的测试状态
  WORD_STATS: 'vocab_word_stats', // 每词答题统计
  AI_CONFIG: 'vocab_ai_config', // AI API 配置
  READER_ARTICLES: 'vocab_reader_articles', // 阅读训练文章
};

// 默认设置
export const DEFAULT_MAX_UNKNOWN = 20;
export const MAX_HISTORY_ITEMS = 60;

// toast显示时长（毫秒）
export const TOAST_DURATION = 2000;
