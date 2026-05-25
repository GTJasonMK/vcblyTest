// ========== 阅读训练模块 ==========
// 阅读 tab：把错词组成 AI 生成英文文章，目标词高亮 + 点击弹窗查看释义。
// 翻译 tab：对当前已生成的英文文章做整篇中文翻译，供对照学习。
// 两个 tab 各自独立的 AbortController，切 tab 不打断对方的流式生成。

import { askAi, renderMarkdown } from './ai.js';
import { escapeHtml } from './ui-common.js';
import { saveReaderArticle, getReaderArticle } from './storage.js';
import {
  buildContextReaderQuestion,
  buildContextReaderSystemPrompt,
  buildReaderQuestion,
  buildReaderSystemPrompt,
  buildTranslationQuestion,
  buildTranslationSystemPrompt,
} from './reader-prompts.js';
import { highlightReaderWords } from './reader-highlight.js';
import { bindReaderPopupEvents, hideReaderPopup } from './reader-popup.js';

// ===== 模块状态 =====

const READER_MODE_ENGLISH = 'english';
const READER_MODE_CONTEXT = 'context';

let _readerWords = [];          // [{w, uk, us, d}]
let _articleMarkdown = '';      // 阅读 tab 当前英文文章 markdown
let _translationMarkdown = '';  // 翻译 tab 当前中文译文 markdown
let _articleMeta = null;        // { dateKey, sessionKey } 用于保存
let _articleCtrl = null;        // 阅读 tab 的 AbortController
let _translationCtrl = null;    // 翻译 tab 的 AbortController
let _activeTab = 'article';     // 'article' | 'translation'
let _readerMode = READER_MODE_ENGLISH; // 'english' | 'context'
let _pendingReaderAction = null; // 'generate' | 'regen'

// ===== 公开 API =====

/** 打开阅读器并用指定错词生成文章 */
export function openReaderWithWords(words, opts = {}) {
  if (!words || words.length === 0) {
    _showEmpty('请先去测试收集一些错词再来阅读吧。');
    return;
  }

  _readerWords = words.map(w => ({ w: w.w, uk: w.uk, us: w.us, d: w.d }));
  _articleMarkdown = '';
  _translationMarkdown = '';
  _articleMeta = (opts.dateKey && opts.sessionKey !== undefined)
    ? { dateKey: opts.dateKey, sessionKey: opts.sessionKey }
    : null;
  _activeTab = 'article';
  _readerMode = READER_MODE_ENGLISH;

  if (_articleCtrl) { try { _articleCtrl.abort(); } catch {} _articleCtrl = null; }
  if (_translationCtrl) { try { _translationCtrl.abort(); } catch {} _translationCtrl = null; }

  _openModal({ showBegin: true });
  _setWordCount(words.length);
  switchReaderTab('article');
}

/** 用户点击"开始生成文章"后触发 AI 生成 */
export function startGenerateReader() {
  _showReaderModeChoice('generate');
}

/** 选择文章生成方式后真正开始生成 */
export async function chooseReaderModeAndGenerate(mode) {
  const action = _pendingReaderAction || 'generate';
  _pendingReaderAction = null;
  _hideReaderModeChoice();

  _readerMode = _normalizeReaderMode(mode);
  _syncReaderModeVisibility();
  if (_isContextMode()) {
    _translationMarkdown = '';
    _clearTranslationPane();
  }

  if (action === 'regen') {
    switchReaderTab('article');
    _setRegenBusy(true);
    _cascadeClearTranslation();
    await generateReaderArticle();
    _setRegenBusy(false);
    return;
  }

  _beginReaderGeneration();
  await generateReaderArticle();
}

/** 关闭文章生成方式选择层 */
export function cancelReaderModeChoice() {
  _pendingReaderAction = null;
  _hideReaderModeChoice();
}

/** 用户点击"开始生成翻译"后触发 AI 翻译 */
export function startGenerateTranslation() {
  if (_isContextMode() || !_articleMarkdown) return;
  generateTranslation();
}

/** 切换 tab — 平移 track（两 pane 始终 mounted、并排在固定 stage 窗口内），保持 transition 平滑 */
export function switchReaderTab(tab) {
  if (tab !== 'article' && tab !== 'translation') return;
  if (_isContextMode() && tab === 'translation') tab = 'article';
  _activeTab = tab;
  hideReaderPopup();

  const tabArticle = document.getElementById('readerTabArticle');
  const tabTranslation = document.getElementById('readerTabTranslation');
  const track = document.getElementById('readerPaneTrack');

  if (tabArticle) tabArticle.classList.toggle('active', tab === 'article');
  if (tabTranslation) tabTranslation.classList.toggle('active', tab === 'translation');
  if (track) {
    track.classList.remove('dragging');
    track.style.transform = tab === 'article' ? 'translateX(0)' : 'translateX(-100%)';
  }

  if (tab === 'translation') _syncTranslationPane();
  _syncReaderModeVisibility();
  _updateRegenBtn();
}

/** 查看已保存的文章（跳过 AI 生成）。译文若存在则一并预渲染 */
export function viewReaderArticle(dateKey, sessionKey) {
  const saved = getReaderArticle(dateKey, sessionKey);
  if (!saved) {
    _showEmpty('文章已过期或不存在，请重新生成。');
    return;
  }

  _readerWords = (saved.words || []).map(w => {
    if (typeof w === 'string') return { w, uk: '', us: '', d: '' };
    return { w: w.w, uk: w.uk || '', us: w.us || '', d: w.d || '' };
  });
  _articleMarkdown = saved.markdown || '';
  _readerMode = _normalizeReaderMode(saved.mode);
  _translationMarkdown = _isContextMode() ? '' : (saved.translation || '');
  _articleMeta = { dateKey, sessionKey };
  _activeTab = 'article';

  _openModal();
  if (_articleMarkdown) {
    _displayArticle(_articleMarkdown);
  }
  // 翻译预渲染由 _openModal 内的 _syncTranslationPane 自动处理
  switchReaderTab('article');
}

/** 关闭阅读器 */
export function closeReader() {
  if (_articleCtrl) { try { _articleCtrl.abort(); } catch {} _articleCtrl = null; }
  if (_translationCtrl) { try { _translationCtrl.abort(); } catch {} _translationCtrl = null; }
  _articleMeta = null;
  _activeTab = 'article';
  _pendingReaderAction = null;
  _hideReaderModeChoice();
  const modal = document.getElementById('readerModal');
  if (modal) {
    modal.hidden = true;
    modal.scrollTop = 0;
  }
  document.body.classList.remove('modal-open');
  hideReaderPopup();
}

/** 顶栏"换一篇"：选择方式后重新生成文章 */
export async function regenReaderArticle() {
  _showReaderModeChoice('regen');
}

// ===== 内部函数 =====

function _normalizeReaderMode(mode) {
  return mode === READER_MODE_CONTEXT ? READER_MODE_CONTEXT : READER_MODE_ENGLISH;
}

function _isContextMode() {
  return _readerMode === READER_MODE_CONTEXT;
}

function _showReaderModeChoice(action) {
  if (_articleCtrl) return;
  _pendingReaderAction = action;
  hideReaderPopup();
  const choice = document.getElementById('readerModeChoice');
  if (choice) choice.hidden = false;
}

function _hideReaderModeChoice() {
  const choice = document.getElementById('readerModeChoice');
  if (choice) choice.hidden = true;
}

function _beginReaderGeneration() {
  const begin = document.getElementById('readerBegin');
  const loading = document.getElementById('readerLoading');
  const loadingText = document.getElementById('readerLoadingText');
  if (begin) begin.style.display = 'none';
  if (loading) loading.style.display = 'flex';
  if (loadingText) loadingText.textContent = _isContextMode() ? 'AI 正在生成中文语境…' : 'AI 正在生成文章…';
}

function _setRegenBusy(busy) {
  const btn = document.getElementById('readerRegenBtn');
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? '生成中…' : '换一篇';
}

function _syncReaderModeVisibility() {
  const isContext = _isContextMode();
  const tabs = document.querySelector('.reader-tabs');
  const tabTranslation = document.getElementById('readerTabTranslation');
  const paneTranslation = document.getElementById('readerPaneTranslation');
  const loadingText = document.getElementById('readerLoadingText');

  if (tabs) tabs.classList.toggle('reader-tabs-hidden', isContext);
  if (tabTranslation) {
    tabTranslation.hidden = isContext;
    tabTranslation.setAttribute('aria-hidden', isContext ? 'true' : 'false');
  }
  if (paneTranslation) paneTranslation.setAttribute('aria-hidden', isContext ? 'true' : 'false');
  if (loadingText) loadingText.textContent = isContext ? 'AI 正在生成中文语境…' : 'AI 正在生成文章…';

  if (isContext) {
    if (_translationCtrl) { try { _translationCtrl.abort(); } catch {} _translationCtrl = null; }
    _clearTranslationPane();
  }
}

function _clearTranslationPane() {
  const begin = document.getElementById('readerTransBegin');
  const empty = document.getElementById('readerTransEmpty');
  const transEl = document.getElementById('readerTranslation');
  const loading = document.getElementById('readerTransLoading');
  if (begin) begin.style.display = 'none';
  if (empty) empty.style.display = 'none';
  if (loading) loading.style.display = 'none';
  if (transEl) transEl.innerHTML = '';
}

function _openModal({ showBegin } = {}) {
  const modal = document.getElementById('readerModal');
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  const empty = document.getElementById('readerEmpty');
  const begin = document.getElementById('readerBegin');
  const regenBtn = document.getElementById('readerRegenBtn');
  if (!modal || !article || !loading || !empty) return;

  article.innerHTML = '';
  article.style.display = 'none';
  empty.style.display = 'none';
  loading.style.display = 'none';
  if (begin) begin.style.display = showBegin ? 'flex' : 'none';
  if (regenBtn) regenBtn.style.display = 'none';

  modal.hidden = false;
  modal.scrollTop = 0;
  document.body.classList.add('modal-open');

  _pendingReaderAction = null;
  _hideReaderModeChoice();
  _syncReaderModeVisibility();
  // 翻译 pane 状态统一由 _syncTranslationPane 管理（不再在这里硬隐藏 transBegin，
  // 否则 swipe 翻到 translation pane 但 switchReaderTab 还没触发时会看到空白页）
  _syncTranslationPane();
}

/** 渲染阅读 tab 的文章 + 高亮目标词 */
function _displayArticle(markdown) {
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  if (!article) return;

  if (loading) loading.style.display = 'none';
  article.style.display = '';
  article.innerHTML = renderMarkdown(markdown);
  highlightReaderWords(article, _readerWords);
  _updateRegenBtn();
}

/** 通用 AI 流式生成骨架：abort 旧 ctrl / 重置 UI / 处理流式 chunk / 错误兜底 / 释放 ctrl。
 *  内容渲染（markdown 解析、目标词高亮等）由 onChunkRender 承担。
 *  返回最终完整字符串；任何失败/中止都返回 ''。 */
async function _runAiStream(opts) {
  const {
    contentEl, loadingEl, emptyEl, beginEl,
    storeCtrl, anchorWord, question, systemPrompt,
    onChunkRender, errorLabel,
  } = opts;
  if (!contentEl || !loadingEl) return '';

  contentEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = 'none';
  if (beginEl) beginEl.style.display = 'none';
  loadingEl.style.display = 'flex';

  const ctrl = new AbortController();
  storeCtrl(ctrl);
  let firstChunk = true;
  let full = '';

  try {
    full = await askAi(
      anchorWord, {}, 'explain', question,
      (chunk) => {
        if (ctrl.signal.aborted) return;
        if (firstChunk) {
          firstChunk = false;
          loadingEl.style.display = 'none';
          contentEl.style.display = '';
          _updateRegenBtn();
        }
        onChunkRender(chunk);
      },
      systemPrompt, ctrl.signal,
    );
  } catch (err) {
    loadingEl.style.display = 'none';
    if (ctrl.signal.aborted) {
      storeCtrl(null);
      return '';
    }
    console.error(`${errorLabel}失败`, err);
    contentEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.innerHTML = `<p>😥 ${errorLabel}失败</p><p style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(err.message || '未知错误')}</p>`;
    }
    storeCtrl(null);
    return '';
  }

  // 非流式后端兜底：onChunkRender 从未触发，渲染一次完整结果
  if (firstChunk && full) {
    loadingEl.style.display = 'none';
    contentEl.style.display = '';
    onChunkRender(full);
    _updateRegenBtn();
  }

  storeCtrl(null);
  return full;
}

/** 生成/重新生成英文文章（阅读 tab） */
async function generateReaderArticle() {
  if (_readerWords.length === 0) return;
  const article = document.getElementById('readerArticle');
  if (!article) return;

  if (_articleCtrl) { try { _articleCtrl.abort(); } catch {} }
  hideReaderPopup();
  _articleMarkdown = '';
  const isContext = _isContextMode();
  if (isContext) {
    _translationMarkdown = '';
    _clearTranslationPane();
  }

  const full = await _runAiStream({
    contentEl: article,
    loadingEl: document.getElementById('readerLoading'),
    emptyEl: document.getElementById('readerEmpty'),
    beginEl: null,
    storeCtrl: (c) => { _articleCtrl = c; },
    anchorWord: _readerWords[0].w,
    question: isContext ? buildContextReaderQuestion(_readerWords) : buildReaderQuestion(_readerWords),
    systemPrompt: isContext ? buildContextReaderSystemPrompt() : buildReaderSystemPrompt(),
    onChunkRender: (chunk) => {
      _articleMarkdown += chunk;
      article.innerHTML = renderMarkdown(_articleMarkdown);
      highlightReaderWords(article, _readerWords);
      article.scrollTop = article.scrollHeight;
    },
    errorLabel: '文章生成',
  });

  if (!full) _articleMarkdown = '';
  if (full && _articleMeta) _saveCurrent();
  _syncReaderModeVisibility();
  _updateRegenBtn();
  // 用户可能在 article 流式期间已切到翻译 tab，文章完成后让翻译 pane 露出生成按钮
  if (_activeTab === 'translation' && !_isContextMode()) _syncTranslationPane();
}

/** 生成/重新生成中文译文（翻译 tab） */
async function generateTranslation() {
  if (_isContextMode() || !_articleMarkdown) return;
  const transEl = document.getElementById('readerTranslation');
  if (!transEl) return;

  if (_translationCtrl) { try { _translationCtrl.abort(); } catch {} }
  _translationMarkdown = '';

  const full = await _runAiStream({
    contentEl: transEl,
    loadingEl: document.getElementById('readerTransLoading'),
    emptyEl: document.getElementById('readerTransEmpty'),
    beginEl: document.getElementById('readerTransBegin'),
    storeCtrl: (c) => { _translationCtrl = c; },
    anchorWord: _readerWords[0]?.w || 'translate',
    question: buildTranslationQuestion(_articleMarkdown),
    systemPrompt: buildTranslationSystemPrompt(),
    onChunkRender: (chunk) => {
      _translationMarkdown += chunk;
      transEl.innerHTML = renderMarkdown(_translationMarkdown);
      transEl.scrollTop = transEl.scrollHeight;
    },
    errorLabel: '翻译生成',
  });

  if (!full) _translationMarkdown = '';
  if (full && _articleMeta) _saveCurrent();
  _updateRegenBtn();
}

/** 切到翻译 tab 时，根据当前状态同步 pane（无文章 / 已有译文 / 待生成） */
function _syncTranslationPane() {
  if (_isContextMode()) {
    _clearTranslationPane();
    return;
  }

  const begin = document.getElementById('readerTransBegin');
  const empty = document.getElementById('readerTransEmpty');
  const transEl = document.getElementById('readerTranslation');
  const loading = document.getElementById('readerTransLoading');

  if (_translationCtrl) return; // 流式生成中，让 onChunk 自行管理 UI

  if (!_articleMarkdown) {
    if (begin) begin.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (transEl) transEl.innerHTML = '';
    _setTransEmpty('请先在「阅读」标签生成文章。');
    return;
  }

  if (_translationMarkdown) {
    // 强制重渲染：避免 modal 关闭再打开后看到上一篇的 stale 译文
    if (transEl) transEl.innerHTML = renderMarkdown(_translationMarkdown);
    if (begin) begin.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (loading) loading.style.display = 'none';
  } else {
    if (begin) begin.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (transEl) transEl.innerHTML = '';
  }
}

/** 文章重生时级联清空翻译，并提示用户 */
function _cascadeClearTranslation() {
  if (_translationCtrl) {
    try { _translationCtrl.abort(); } catch {}
    _translationCtrl = null;
  }
  _translationMarkdown = '';
  const transEl = document.getElementById('readerTranslation');
  if (transEl) transEl.innerHTML = '';
  const begin = document.getElementById('readerTransBegin');
  const loading = document.getElementById('readerTransLoading');
  if (loading) loading.style.display = 'none';
  if (_isContextMode()) {
    _clearTranslationPane();
    return;
  }
  _setTransEmpty('文章已更新，请重新生成翻译。');
  if (begin) begin.style.display = 'flex';
}

/** 翻译 pane 空状态文案：统一字号/颜色 */
function _setTransEmpty(msg) {
  const empty = document.getElementById('readerTransEmpty');
  if (!empty) return;
  empty.style.display = '';
  empty.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem">${escapeHtml(msg)}</p>`;
}

/** 顶栏"换一篇"按钮显隐：当前 tab 有内容才出现 */
function _updateRegenBtn() {
  const btn = document.getElementById('readerRegenBtn');
  const visible = _activeTab === 'article'
    ? !!_articleMarkdown
    : !!_translationMarkdown;
  if (btn) btn.style.display = visible ? '' : 'none';
}

function _setWordCount(n) {
  const el = document.getElementById('readerWordCount');
  if (el) el.textContent = n;
}

/** 保存当前条目（阅读+翻译合并写入）到 localStorage。
 *  内存状态即为完整真值，直接覆写整条；无需读旧值合并。 */
function _saveCurrent() {
  if (!_articleMeta || !_articleMarkdown) return;
  saveReaderArticle(_articleMeta.dateKey, _articleMeta.sessionKey, {
    words: _readerWords.map(w => ({ w: w.w, uk: w.uk, us: w.us, d: w.d })),
    mode: _readerMode,
    markdown: _articleMarkdown,
    translation: _isContextMode() ? undefined : (_translationMarkdown || undefined),
    generatedAt: new Date().toISOString(),
  });
}

function _showEmpty(msg) {
  const modal = document.getElementById('readerModal');
  const empty = document.getElementById('readerEmpty');
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  const regen = document.getElementById('readerRegenBtn');
  if (!modal || !empty) return;

  _pendingReaderAction = null;
  _hideReaderModeChoice();
  if (article) article.innerHTML = '';
  if (loading) loading.style.display = 'none';
  if (regen) regen.style.display = 'none';
  empty.style.display = '';
  empty.innerHTML = `<p>${escapeHtml(msg)}</p>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

bindReaderPopupEvents();

// ===== 移动端：左右滑动切 tab（双 pane 同时跟手 + snap） =====
// 两 pane 在 .reader-pane-stage 内并排始终 mounted；
// 跟手时整体 translateX(base + dx)，松手按距离/速度 snap；
// 越界方向（无下一 tab）给 1/4 阻尼，制造橡皮筋反馈。

(() => {
  const LOCK_AXIS_AT = 8;

  let startX = 0, startY = 0, startT = 0;
  let tracking = false;
  let horizontal = null;
  let trackEl = null;
  let trackWidth = 0;

  function _inPane(target) {
    const modal = document.getElementById('readerModal');
    if (!modal || modal.hidden) return false;
    const a = document.getElementById('readerPaneArticle');
    const b = document.getElementById('readerPaneTranslation');
    return (a && a.contains(target)) || (b && b.contains(target));
  }

  function _canSwipeTo(dir) {
    if (_isContextMode()) return false;
    if (dir === 'left') return _activeTab === 'article';
    if (dir === 'right') return _activeTab === 'translation';
    return false;
  }

  function _baseOffsetPx() {
    return _activeTab === 'translation' ? -trackWidth : 0;
  }

  function _snapToActive() {
    if (!trackEl) return;
    trackEl.classList.remove('dragging');
    trackEl.style.transform = _activeTab === 'translation' ? 'translateX(-100%)' : 'translateX(0)';
  }

  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 640) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!_inPane(t.target)) return;
    startX = t.clientX;
    startY = t.clientY;
    startT = Date.now();
    tracking = true;
    horizontal = null;
    trackEl = null;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (horizontal === null) {
      if (Math.abs(dx) < LOCK_AXIS_AT && Math.abs(dy) < LOCK_AXIS_AT) return;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) {
        trackEl = document.getElementById('readerPaneTrack');
        if (trackEl) {
          trackWidth = trackEl.getBoundingClientRect().width || window.innerWidth;
          trackEl.classList.add('dragging');
        }
      }
      return;
    }
    if (!horizontal || !trackEl) return;
    const dir = dx < 0 ? 'left' : 'right';
    const damped = _canSwipeTo(dir) ? dx : dx * 0.25;
    trackEl.style.transform = `translateX(${_baseOffsetPx() + damped}px)`;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    if (!horizontal || !trackEl) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dt = Date.now() - startT;
    const threshold = Math.min(trackWidth * 0.25, 120);
    const fling = dt < 250 && Math.abs(dx) > 30;
    const passed = Math.abs(dx) > threshold || fling;
    const dir = dx < 0 ? 'left' : 'right';

    trackEl.classList.remove('dragging');

    if (passed && _canSwipeTo(dir)) {
      switchReaderTab(dir === 'left' ? 'translation' : 'article');
    } else {
      _snapToActive();
    }
    trackEl = null;
  });

  document.addEventListener('touchcancel', () => {
    if (trackEl) _snapToActive();
    trackEl = null;
    tracking = false;
    horizontal = null;
  });
})();
