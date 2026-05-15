// ========== 阅读训练模块 ==========
// 将错词组成 AI 生成文章，目标词高亮 + 点击弹窗查看释义。
// 与错词本的测试场次深度集成：每个场次可生成一篇文章。

import { askAi, renderMarkdown } from './ai.js';
import { escapeHtml } from './ui-common.js';
import { saveReaderArticle, getReaderArticle } from './storage.js';

// ===== 模块状态 =====

let _readerWords = [];         // [{w, uk, us, d}]
let _readerCtrl = null;       // AbortController
let _currentArticle = '';     // 当前文章原始 markdown
let _articleMeta = null;      // { dateKey, sessionKey } 用于保存

// ===== 公开 API =====

/** 打开阅读器并用指定错词生成文章 */
export function openReaderWithWords(words, opts = {}) {
  if (!words || words.length === 0) {
    _showEmpty('请先去测试收集一些错词再来阅读吧。');
    return;
  }

  _readerWords = words.map(w => ({ w: w.w, uk: w.uk, us: w.us, d: w.d }));
  _currentArticle = '';
  _articleMeta = (opts.dateKey && opts.sessionKey !== undefined)
    ? { dateKey: opts.dateKey, sessionKey: opts.sessionKey }
    : null;

  _openModal({ showBegin: true });
  _setWordCount(words.length);
}

/** 用户点击"开始生成"后触发 AI 生成 */
export function startGenerateReader() {
  const begin = document.getElementById('readerBegin');
  const loading = document.getElementById('readerLoading');
  if (begin) begin.style.display = 'none';
  if (loading) loading.style.display = 'flex';
  generateReaderArticle();
}

/** 查看已保存的文章（跳过 AI 生成） */
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
  _currentArticle = saved.markdown || '';
  _articleMeta = { dateKey, sessionKey };

  _openModal();
  if (_currentArticle) {
    _displayArticle(_currentArticle);
  }
}

/** 关闭阅读器 */
export function closeReader() {
  if (_readerCtrl) {
    try { _readerCtrl.abort(); } catch {}
    _readerCtrl = null;
  }
  _articleMeta = null;
  const modal = document.getElementById('readerModal');
  if (modal) {
    modal.hidden = true;
    modal.scrollTop = 0;
  }
  document.body.classList.remove('modal-open');
  _hidePopup();
}

/** 打开模态框并重置 UI。showBegin 为 true 时展示"开始生成"按钮而非直接加载 */
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
}

/** 显示文章内容（渲染 markdown + 高亮） */
function _displayArticle(markdown) {
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  const regenBtn = document.getElementById('readerRegenBtn');
  if (!article) return;

  if (loading) loading.style.display = 'none';
  article.style.display = '';
  article.innerHTML = renderMarkdown(markdown);
  _highlightWords(article, _readerWords);
  if (regenBtn) regenBtn.style.display = '';
}

/** 生成/重新生成文章 */
export async function generateReaderArticle() {
  if (_readerWords.length === 0) return;

  // 重置 UI
  const article = document.getElementById('readerArticle');
  const loading = document.getElementById('readerLoading');
  const empty = document.getElementById('readerEmpty');
  const regenBtn = document.getElementById('readerRegenBtn');
  if (!article || !loading) return;

  // 取消上一次请求
  if (_readerCtrl) {
    try { _readerCtrl.abort(); } catch {}
  }
  _hidePopup();

  article.innerHTML = '';
  empty.style.display = 'none';
  regenBtn.style.display = 'none';
  loading.style.display = 'flex';

  _readerCtrl = new AbortController();
  const ctrl = _readerCtrl;
  let firstChunk = true;

  try {
    _currentArticle = await askAi(
      _readerWords[0].w,
      {},
      'explain',
      _buildQuestion(_readerWords),
      (chunk) => {
        if (ctrl.signal.aborted) return;
        if (firstChunk) {
          firstChunk = false;
          loading.style.display = 'none';
          article.style.display = '';
          regenBtn.style.display = '';
        }
        _currentArticle += chunk;
        article.innerHTML = renderMarkdown(_currentArticle);
        _highlightWords(article, _readerWords);
        article.scrollTop = article.scrollHeight;
      },
      _buildSystemPrompt(),
      ctrl.signal
    );
  } catch (err) {
    loading.style.display = 'none';
    if (ctrl.signal.aborted) {
      // 超时或被用户取消，静默清理
      _readerCtrl = null;
      return;
    }
    console.error('生成阅读文章失败', err);
    article.innerHTML = '';
    empty.style.display = '';
    empty.innerHTML = `<p>😥 文章生成失败</p><p style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(err.message || '未知错误')}</p>`;
    regenBtn.style.display = 'none';
    _readerCtrl = null;
    return;
  }

  // 生成完成后确保渲染完整（非流式后端兼容）
  if (_currentArticle && !article.innerHTML) {
    _displayArticle(_currentArticle);
  }

  // 自动保存到本地
  if (_currentArticle && _articleMeta) {
    _saveCurrent();
  }

  _readerCtrl = null;
}

/** 换一篇：同组词重新生成 */
export async function regenReaderArticle() {
  const btn = document.getElementById('readerRegenBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '生成中…';
  }
  _currentArticle = '';
  await generateReaderArticle();
  if (btn) {
    btn.disabled = false;
    btn.textContent = '换一篇';
  }
}

// ===== 内部函数 =====

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

/** 设置词数提示 */
function _setWordCount(n) {
  const el = document.getElementById('readerWordCount');
  if (el) el.textContent = n;
}

/** 在文章容器中高亮目标词 */
function _highlightWords(container, words) {
  if (!container || words.length === 0) return;

  // 收集目标词及其屈折变体正则
  const targets = words.map(w => {
    const stem = _escapeRegex(w.w);
    // 匹配词根 + 常见屈折后缀（允许首字母大小写）
    const suffixes = '(?:s|es|ed|ing|ly|er|est|\'s|s\')?';
    return {
      word: w.w,
      uk: w.uk || '',
      us: w.us || '',
      d: w.d || '',
      regex: new RegExp(`\\b(${stem})${suffixes}\\b`, 'gi'),
    };
  });

  const used = new Set(); // 已高亮的词（首个出现）
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => {
      // 跳过代码块、链接、已高亮词内部
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
      // splitText 创建三个节点：before / matched / after
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
      break; // 当前文本节点只处理第一个匹配词
    }
  }
}

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 保存当前文章到 localStorage */
function _saveCurrent() {
  if (!_articleMeta || !_currentArticle) return;
  saveReaderArticle(_articleMeta.dateKey, _articleMeta.sessionKey, {
    words: _readerWords.map(w => ({ w: w.w, uk: w.uk, us: w.us, d: w.d })),
    markdown: _currentArticle,
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

  // 关闭按钮事件
  popup.querySelector('.rp-close').addEventListener('click', (e) => {
    e.stopPropagation();
    _hidePopup();
  });

  document.body.appendChild(popup);

  const isMobile = window.innerWidth <= 640;

  if (!isMobile) {
    // 移动端：CSS 媒体查询处理为底部固定浮窗，JS 不做定位
    // 桌面端：优先在点击词下方，溢出则翻到上方
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
  // 点击浮窗内部或目标词 → 不关闭
  if (popup.contains(e.target)) return;
  if (e.target.classList.contains('rw-target')) return;
  if (e.target.closest('.rp-close')) return;
  _hidePopup();
}, true);

document.addEventListener('scroll', () => {
  // 移动端浮窗固定在底部，无需在滚动时关闭
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

// 委托点击目标词 → 弹窗
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
