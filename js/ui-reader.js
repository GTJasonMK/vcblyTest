// ========== 阅读训练模块 ==========
// 阅读 tab：把错词组成 AI 生成英文文章，目标词高亮 + 点击弹窗查看释义。
// 翻译 tab：对当前已生成的英文文章做整篇中文翻译，供对照学习。
// 两个 tab 各自独立的 AbortController，切 tab 不打断对方的流式生成。

import { askAi, renderMarkdown } from './ai.js';
import { escapeHtml } from './ui-common.js';
import { saveReaderArticle, getReaderArticle } from './storage.js';

// ===== 模块状态 =====

let _readerWords = [];          // [{w, uk, us, d}]
let _articleMarkdown = '';      // 阅读 tab 当前英文文章 markdown
let _translationMarkdown = '';  // 翻译 tab 当前中文译文 markdown
let _articleMeta = null;        // { dateKey, sessionKey } 用于保存
let _articleCtrl = null;        // 阅读 tab 的 AbortController
let _translationCtrl = null;    // 翻译 tab 的 AbortController
let _activeTab = 'article';     // 'article' | 'translation'

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

  if (_articleCtrl) { try { _articleCtrl.abort(); } catch {} _articleCtrl = null; }
  if (_translationCtrl) { try { _translationCtrl.abort(); } catch {} _translationCtrl = null; }

  _openModal({ showBegin: true });
  _setWordCount(words.length);
  switchReaderTab('article');
}

/** 用户点击"开始生成文章"后触发 AI 生成 */
export function startGenerateReader() {
  const begin = document.getElementById('readerBegin');
  const loading = document.getElementById('readerLoading');
  if (begin) begin.style.display = 'none';
  if (loading) loading.style.display = 'flex';
  generateReaderArticle();
}

/** 用户点击"开始生成翻译"后触发 AI 翻译 */
export function startGenerateTranslation() {
  if (!_articleMarkdown) return;
  generateTranslation();
}

/** 切换 tab */
export function switchReaderTab(tab) {
  if (tab !== 'article' && tab !== 'translation') return;
  _activeTab = tab;

  const tabArticle = document.getElementById('readerTabArticle');
  const tabTranslation = document.getElementById('readerTabTranslation');
  const paneArticle = document.getElementById('readerPaneArticle');
  const paneTranslation = document.getElementById('readerPaneTranslation');

  if (tabArticle) tabArticle.classList.toggle('active', tab === 'article');
  if (tabTranslation) tabTranslation.classList.toggle('active', tab === 'translation');
  if (paneArticle) paneArticle.style.display = tab === 'article' ? '' : 'none';
  if (paneTranslation) paneTranslation.style.display = tab === 'translation' ? '' : 'none';

  if (tab === 'translation') _syncTranslationPane();
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
  _translationMarkdown = saved.translation || '';
  _articleMeta = { dateKey, sessionKey };
  _activeTab = 'article';

  _openModal();
  if (_articleMarkdown) {
    _displayArticle(_articleMarkdown);
  }
  if (_translationMarkdown) {
    const t = document.getElementById('readerTranslation');
    if (t) t.innerHTML = renderMarkdown(_translationMarkdown);
  }
  switchReaderTab('article');
}

/** 关闭阅读器 */
export function closeReader() {
  if (_articleCtrl) { try { _articleCtrl.abort(); } catch {} _articleCtrl = null; }
  if (_translationCtrl) { try { _translationCtrl.abort(); } catch {} _translationCtrl = null; }
  _articleMeta = null;
  _activeTab = 'article';
  const modal = document.getElementById('readerModal');
  if (modal) {
    modal.hidden = true;
    modal.scrollTop = 0;
  }
  document.body.classList.remove('modal-open');
  _hidePopup();
}

/** 顶栏"换一篇"：按当前 tab 分派 */
export async function regenReaderArticle() {
  const btn = document.getElementById('readerRegenBtn');
  const setBtn = (busy) => {
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? '生成中…' : '换一篇';
  };

  if (_activeTab === 'translation') {
    if (!_articleMarkdown) return;
    setBtn(true);
    await generateTranslation();
    setBtn(false);
    return;
  }

  setBtn(true);
  _cascadeClearTranslation();
  await generateReaderArticle();
  setBtn(false);
}

// ===== 内部函数 =====

function _openModal({ showBegin } = {}) {
  const modal = document.getElementById('readerModal');
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  const empty = document.getElementById('readerEmpty');
  const begin = document.getElementById('readerBegin');
  const regenBtn = document.getElementById('readerRegenBtn');
  const transEl = document.getElementById('readerTranslation');
  const transLoading = document.getElementById('readerTransLoading');
  const transEmpty = document.getElementById('readerTransEmpty');
  const transBegin = document.getElementById('readerTransBegin');
  if (!modal || !article || !loading || !empty) return;

  article.innerHTML = '';
  article.style.display = 'none';
  empty.style.display = 'none';
  loading.style.display = 'none';
  if (begin) begin.style.display = showBegin ? 'flex' : 'none';
  if (regenBtn) regenBtn.style.display = 'none';

  if (transEl) transEl.innerHTML = '';
  if (transLoading) transLoading.style.display = 'none';
  if (transEmpty) transEmpty.style.display = 'none';
  if (transBegin) transBegin.style.display = 'none';

  modal.hidden = false;
  modal.scrollTop = 0;
  document.body.classList.add('modal-open');
}

/** 渲染阅读 tab 的文章 + 高亮目标词 */
function _displayArticle(markdown) {
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  if (!article) return;

  if (loading) loading.style.display = 'none';
  article.style.display = '';
  article.innerHTML = renderMarkdown(markdown);
  _highlightWords(article, _readerWords);
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
  _hidePopup();
  _articleMarkdown = '';

  const full = await _runAiStream({
    contentEl: article,
    loadingEl: document.getElementById('readerLoading'),
    emptyEl: document.getElementById('readerEmpty'),
    beginEl: null,
    storeCtrl: (c) => { _articleCtrl = c; },
    anchorWord: _readerWords[0].w,
    question: _buildQuestion(_readerWords),
    systemPrompt: _buildSystemPrompt(),
    onChunkRender: (chunk) => {
      _articleMarkdown += chunk;
      article.innerHTML = renderMarkdown(_articleMarkdown);
      _highlightWords(article, _readerWords);
      article.scrollTop = article.scrollHeight;
    },
    errorLabel: '文章生成',
  });

  if (!full) _articleMarkdown = '';
  if (full && _articleMeta) _saveCurrent();
  _updateRegenBtn();
}

/** 生成/重新生成中文译文（翻译 tab） */
async function generateTranslation() {
  if (!_articleMarkdown) return;
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
    question: _buildTranslationQuestion(),
    systemPrompt: _buildTranslationSystemPrompt(),
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
    if (transEl && !transEl.innerHTML) {
      transEl.innerHTML = renderMarkdown(_translationMarkdown);
    }
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
  if (!btn) return;
  const visible = _activeTab === 'article'
    ? !!_articleMarkdown
    : !!_translationMarkdown;
  btn.style.display = visible ? '' : 'none';
}

function _buildSystemPrompt() {
  return '你是一个英语教学专家，擅长根据词汇表编写适合英语学习者的阅读文章。'
    + '请用给出的全部单词写一篇约250-400词的英语文章。'
    + '必须使用列表中的每一个单词（允许屈折变化如复数、过去式、进行时等）。'
    + '选一个能自然容纳这些词的主题，使文章读起来自然流畅、不牵强。'
    + '只输出文章正文（markdown 格式：标题+段落），不要附加任何其他内容。';
}

function _buildQuestion(words) {
  const list = words.map((w, i) => {
    let line = `${i + 1}. **${w.w}**`;
    if (w.d) line += ` — ${w.d}`;
    if (w.uk) line += ` 英/${w.uk}/`;
    if (w.us) line += ` 美/${w.us}/`;
    return line;
  }).join('\n');
  return `请根据以上系统指令，用以下全部${words.length}个单词写一篇文章：\n\n${list}`;
}

function _buildTranslationSystemPrompt() {
  return '你是一名英译中翻译专家。请将用户提供的英文文章逐段翻译为自然流畅的简体中文，'
    + '保留原文的 markdown 结构（标题、段落、列表、强调等）。'
    + '直译优先，必要时调整语序以符合中文表达习惯。'
    + '只输出译文，不要附加解释或英文原文。';
}

function _buildTranslationQuestion() {
  return `请将以下文章翻译为中文（保持 markdown 格式）：\n\n${_articleMarkdown}`;
}

function _setWordCount(n) {
  const el = document.getElementById('readerWordCount');
  if (el) el.textContent = n;
}

/** 在文章容器中高亮目标词 */
function _highlightWords(container, words) {
  if (!container || words.length === 0) return;

  const targets = words.map(w => {
    const stem = _escapeRegex(w.w);
    const suffixes = '(?:s|es|ed|ing|ly|er|est|\'s|s\')?';
    return {
      word: w.w,
      uk: w.uk || '',
      us: w.us || '',
      d: w.d || '',
      regex: new RegExp(`\\b(${stem})${suffixes}\\b`, 'gi'),
    };
  });

  const used = new Set();
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => {
      const parent = n.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'CODE' || tag === 'PRE' || tag === 'A' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains('rw-target')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }}
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const t of targets) {
      if (used.has(t.word.toLowerCase())) continue;
      const match = node.textContent.match(t.regex);
      if (!match) continue;

      const matchedText = match[0];
      const idx = match.index;
      const afterNode = node.splitText(idx);
      const targetNode = afterNode.splitText(matchedText.length);

      const span = document.createElement('span');
      span.className = 'rw-target';
      span.dataset.word = t.word;
      span.dataset.def = t.d;
      span.dataset.uk = t.uk;
      span.dataset.us = t.us;
      span.textContent = matchedText;
      afterNode.replaceWith(span);

      used.add(t.word.toLowerCase());
      break;
    }
  }
}

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 保存当前条目（阅读+翻译合并写入）到 localStorage。
 *  内存状态即为完整真值，直接覆写整条；无需读旧值合并。 */
function _saveCurrent() {
  if (!_articleMeta || !_articleMarkdown) return;
  saveReaderArticle(_articleMeta.dateKey, _articleMeta.sessionKey, {
    words: _readerWords.map(w => ({ w: w.w, uk: w.uk, us: w.us, d: w.d })),
    markdown: _articleMarkdown,
    translation: _translationMarkdown || undefined,
    generatedAt: new Date().toISOString(),
  });
}

/** 显示释义浮窗 */
function _showPopup(w, def, uk, us, event) {
  _hidePopup();

  const popup = document.createElement('div');
  popup.className = 'reader-popup';
  popup.id = 'readerPopup';

  let pronHtml = '';
  if (uk) pronHtml += `英 ${escapeHtml(uk)} `;
  if (us) pronHtml += `美 ${escapeHtml(us)}`;

  popup.innerHTML = `
    <button class="rp-close">&times;</button>
    <div class="rp-word">${escapeHtml(w)}</div>
    ${pronHtml ? `<div class="rp-pron">${pronHtml}</div>` : ''}
    <div class="rp-def">${escapeHtml(def)}</div>
  `;

  popup.querySelector('.rp-close').addEventListener('click', (e) => {
    e.stopPropagation();
    _hidePopup();
  });

  document.body.appendChild(popup);

  const isMobile = window.innerWidth <= 640;

  if (!isMobile) {
    const rect = event.target.getBoundingClientRect();
    const popupH = popup.offsetHeight;
    const popupW = popup.offsetWidth;
    const gutter = 10;
    let top = rect.bottom + gutter;
    if (top + popupH > window.innerHeight - 12) {
      top = rect.top - popupH - gutter;
    }
    let left = rect.left + rect.width / 2 - popupW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - popupW - 12));
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
  }
}

function _hidePopup() {
  const popup = document.getElementById('readerPopup');
  if (popup) popup.remove();
}

function _showEmpty(msg) {
  const modal = document.getElementById('readerModal');
  const empty = document.getElementById('readerEmpty');
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  const regen = document.getElementById('readerRegenBtn');
  if (!modal || !empty) return;

  if (article) article.innerHTML = '';
  if (loading) loading.style.display = 'none';
  if (regen) regen.style.display = 'none';
  empty.style.display = '';
  empty.innerHTML = `<p>${escapeHtml(msg)}</p>`;
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

// ===== 全局事件：浮窗关闭 =====

document.addEventListener('click', (e) => {
  const popup = document.getElementById('readerPopup');
  if (!popup) return;
  if (popup.contains(e.target)) return;
  if (e.target.classList.contains('rw-target')) return;
  if (e.target.closest('.rp-close')) return;
  _hidePopup();
}, true);

document.addEventListener('scroll', () => {
  if (window.innerWidth <= 640) return;
  _hidePopup();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popup = document.getElementById('readerPopup');
    if (popup) {
      _hidePopup();
      e.preventDefault();
      e.stopPropagation();
    }
  }
});

document.addEventListener('click', (e) => {
  const target = e.target.closest('.rw-target');
  if (!target) return;
  e.stopPropagation();
  const w = target.dataset.word;
  const def = target.dataset.def;
  const uk = target.dataset.uk;
  const us = target.dataset.us;
  if (w) _showPopup(w, def, uk, us, e);
});

// ===== 移动端：左右滑动切 tab（跟手平移 + snap） =====
// 仅在 ≤640px、触点落在 reader pane 内时启用；
// touchmove 锁主方向后实时 translateX 当前 pane；
// touchend 按距离/速度判定 snap-out 或回弹；
// 越界方向（无下一 tab 可去）给 1/4 阻尼。

(() => {
  const LOCK_AXIS_AT = 8;
  const SNAP_MS = 220;

  let startX = 0, startY = 0, startT = 0;
  let tracking = false;
  let horizontal = null; // null | true | false
  let dragPane = null;

  function inPane(target) {
    const modal = document.getElementById('readerModal');
    if (!modal || modal.hidden) return false;
    const a = document.getElementById('readerPaneArticle');
    const b = document.getElementById('readerPaneTranslation');
    return (a && a.contains(target)) || (b && b.contains(target));
  }

  function _currentPaneEl() {
    return document.getElementById(
      _activeTab === 'translation' ? 'readerPaneTranslation' : 'readerPaneArticle'
    );
  }

  function _canSwipeTo(dir) {
    if (dir === 'left') return _activeTab === 'article';
    if (dir === 'right') return _activeTab === 'translation';
    return false;
  }

  function _resetPane(pane) {
    pane.style.transition = '';
    pane.style.transform = '';
  }

  function _cancelDrag(pane) {
    pane.style.transition = `transform ${SNAP_MS}ms ease`;
    pane.style.transform = '';
    setTimeout(() => _resetPane(pane), SNAP_MS + 20);
  }

  function _completeDrag(pane, dir) {
    const offset = dir === 'left' ? '-100%' : '100%';
    pane.style.transition = `transform ${SNAP_MS}ms ease`;
    pane.style.transform = `translateX(${offset})`;
    const targetTab = dir === 'left' ? 'translation' : 'article';
    setTimeout(() => {
      _resetPane(pane);
      _swipeToTab(targetTab, dir);
    }, SNAP_MS);
  }

  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 640) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!inPane(t.target)) return;
    startX = t.clientX;
    startY = t.clientY;
    startT = Date.now();
    tracking = true;
    horizontal = null;
    dragPane = null;
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
        dragPane = _currentPaneEl();
        if (dragPane) dragPane.style.transition = 'none';
      }
      return;
    }
    if (!horizontal || !dragPane) return;
    const dir = dx < 0 ? 'left' : 'right';
    const damped = _canSwipeTo(dir) ? dx : dx * 0.25;
    dragPane.style.transform = `translateX(${damped}px)`;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    if (!horizontal || !dragPane) return;
    const pane = dragPane;
    dragPane = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dt = Date.now() - startT;
    const threshold = Math.min(window.innerWidth * 0.25, 100);
    const fling = dt < 250 && Math.abs(dx) > 30;
    const passed = Math.abs(dx) > threshold || fling;
    const dir = dx < 0 ? 'left' : 'right';
    if (passed && _canSwipeTo(dir)) {
      _completeDrag(pane, dir);
    } else {
      _cancelDrag(pane);
    }
  });

  document.addEventListener('touchcancel', () => {
    if (dragPane) _cancelDrag(dragPane);
    dragPane = null;
    tracking = false;
    horizontal = null;
  });
})();

/** 滑动触发的 tab 切换：给目标 pane 短暂加上方向动画 class，再走常规 switchReaderTab */
function _swipeToTab(tab, fromDir) {
  const paneId = tab === 'translation' ? 'readerPaneTranslation' : 'readerPaneArticle';
  const pane = document.getElementById(paneId);
  if (pane) {
    pane.classList.remove('swipe-in-right', 'swipe-in-left');
    const cls = fromDir === 'left' ? 'swipe-in-right' : 'swipe-in-left';
    pane.classList.add(cls);
    pane.addEventListener('animationend', () => {
      pane.classList.remove(cls);
    }, { once: true });
  }
  switchReaderTab(tab);
}
