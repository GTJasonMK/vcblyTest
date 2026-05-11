// ========== 应用入口 ==========

import { initWords, session } from './state.js';
import { loadSettings, loadHistory, saveHistory, clearHistory, clearAll, loadTheme, saveTheme, loadSession, exportAll, importAll, loadAiConfig, saveAiConfig } from './storage.js';
import { setMaxUnknownInput } from './ui.js';
import * as UI from './ui.js';
import * as Session from './session.js';
import { clearAudioCache, playWordAudioFromButton, registerAudioServiceWorker } from './audio.js';
import { escapeHtml } from './ui-common.js';
import { askAi, renderMarkdown } from './ai.js';
import { PANEL } from './constants.js';

// ===== 主题管理 =====
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function toggleTheme() {
  const current = document.documentElement.hasAttribute('data-theme') ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveTheme(next);
}

function initTheme() {
  let theme = loadTheme();
  if (!theme || theme === 'auto') {
    theme = getSystemTheme();
  }
  applyTheme(theme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const saved = loadTheme();
    if (!saved || saved === 'auto') {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// ===== 初始化 =====
function init() {
  initTheme();
  registerAudioServiceWorker();

  // 修复 HTML 结构：确保所有 panel 在 container 中，所有 modal 在 body 下
  const container = document.querySelector('.container');
  if (container) {
    document.querySelectorAll('.panel').forEach(p => {
      if (p.parentElement !== container) container.appendChild(p);
    });
  }
  // 模态框（position:fixed）直接挂到 body 下
  document.querySelectorAll('.badge-modal').forEach(m => {
    if (m.parentElement !== document.body) document.body.appendChild(m);
  });

  const count = initWords();
  const subtitle = document.querySelector('.subtitle');
  if (count > 0) {
    subtitle.textContent = `红宝书 · 共 ${count} 词`;
  } else {
    subtitle.textContent = '词库加载失败，请刷新页面';
  }

  const settings = loadSettings();
  setMaxUnknownInput(settings.maxUnknown);
  console.log('init start');

  const h0 = loadHistory();
  console.log('init: history count=', h0?.length);
  UI.renderOverallStats(h0);
  UI.renderResumeButton(loadSession());
  UI.renderHomeNotebookSummary(h0);
  UI.renderWordMap();

  // 窗口大小变化时重新渲染概率地图和分布图
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById('panel-home').classList.contains('active')) {
        UI.renderWordMap();
      }
    }, 150);
  });

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // 导入文件监听（避免 inline onchange 的模块加载时序问题）
  document.getElementById('importFile').addEventListener('change', (e) => window.importAll(e));
}

// ===== 全局事件绑定（挂载到 window 供 HTML onclick 调用） =====
window.startSession = () => Session.startSession();
window.resumeSession = () => Session.resumeSession();
window.selectAnswer = (idx) => Session.selectAnswer(idx);
window.markUnknown = () => Session.markUnknown();
window.nextWord = () => Session.nextWord();
window.endSessionEarly = () => Session.endSessionEarly();
window.playCurrentWordAudio = () => Session.playCurrentWordAudio();
window.startReview = () => {
  window._reviewFromNotebook = false;
  Session.startReview();
};
window.reviewPrev = () => Session.reviewPrev();
window.reviewNext = () => Session.reviewNext();
window.playReviewWordAudio = () => Session.playReviewWordAudio();
window.reviewBack = () => showPanel('result'); // 默认返回结果，被 reviewFromNotebook 覆盖
window.playWordAudioFromButton = (button) => {
  if (!playWordAudioFromButton(button)) {
    UI.toast('当前单词暂无音频');
  }
};

window.clearAudioCache = async () => {
  await clearAudioCache();
  UI.toast('音频缓存已清空');
};

window.showPanel = (name) => {
  if (name === 'badges') {
    UI.openBadgeModal(loadHistory());
    return;
  }

  UI.showPanel(name);
  if (name === 'history') {
    UI.renderHistory(loadHistory());
  }
  if (name === 'notebook') {
    UI.renderNotebook(loadHistory());
  }
  if (name === 'home') {
    UI.renderOverallStats(loadHistory());
    UI.renderResumeButton(loadSession());
    UI.renderHomeNotebookSummary(loadHistory());
    UI.renderWordMap();
  }
  if (name === 'result') {
    UI.renderResult();
  }
};

window.resetAll = () => {
  if (!confirm('确定重置全部数据（历史记录+设置）吗？此操作不可恢复。')) return;
  clearAll();
  location.reload();
};

window.clearHistory = () => {
  if (!confirm('确定清空全部历史记录吗？此操作不可恢复。')) return;
  clearHistory();
  UI.closeHistoryModal();
  UI.renderHistory([]);
  UI.toast('历史记录已清空');
};

window.exportAll = () => {
  const result = exportAll();
  if (result === null) {
    UI.toast('没有可导出的数据');
  }
};

window.importAll = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const count = importAll(e.target.result);
      UI.toast(`导入成功，共 ${count} 条测试记录`);
      // 刷新首页数据和错词本
      UI.renderOverallStats(loadHistory());
      UI.renderResumeButton(loadSession());
      UI.renderWordMap();
      if (document.getElementById('panel-notebook').classList.contains('active')) {
        UI.renderNotebook(loadHistory());
      }
      if (!document.getElementById('badgeModal').hidden) {
        UI.renderBadgePage(loadHistory());
      }
      // 更新设置输入
      const settings = loadSettings();
      const maxUnknownEl = document.getElementById('maxUnknown');
      if (maxUnknownEl) maxUnknownEl.value = settings.maxUnknown;
    } catch (err) {
      UI.toast(err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
};

window.closeBadgeModal = () => UI.closeBadgeModal();

// ===== AI 详解弹窗 + 例句 =====
let _aiDetailWord = null;

window.openAiDetailModal = async () => {
  try {
    const modal = document.getElementById('aiDetailModal');
    if (!modal) { UI.toast('弹窗元素未找到'); return; }
    const word = Session.getCurrentReviewWord();
    if (!word) { UI.toast('没有正在复习的单词'); return; }
    _aiDetailWord = word;
    const infoEl = document.getElementById('aiDetailWordInfo');
    if (infoEl) infoEl.textContent = `${word.w}  ${word.uk || ''}  ${word.us || ''}  —  ${word.d}`;
    // 检查各 tab 缓存，有内容的直接显示
    const tabs = [
      { name: 'Mnemonic', key: 'mnemonic', hasBtn: true },
      { name: 'Collocation', key: 'collocation', hasBtn: true },
      { name: 'Similar', key: 'similar', hasBtn: true },
      { name: 'QA', key: 'qa', hasBtn: false },
    ];
    // 重置问答 tab
    const qaResult = document.getElementById('aiResultQA');
    if (qaResult) qaResult.textContent = '';
    const qaInput = document.getElementById('aiQAInput');
    if (qaInput) qaInput.value = '';
    for (const { name, key, hasBtn } of tabs) {
      if (!hasBtn) continue;
      const el = document.getElementById('aiResult' + name);
      if (el) el.textContent = '';
      const btn = document.getElementById('aiBtn' + name);
      if (btn) { btn.style.display = ''; btn.disabled = false; btn.innerHTML = btn.dataset.text || btn.textContent; }
      try {
        const cacheKey = 'vcbly_ai_' + word.w + '_' + key;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const data = JSON.parse(cached);
          if (data.text && btn) {
            btn.style.display = 'none';
            if (el) el.innerHTML = '<div class="markdown-body">' + renderMarkdown(data.text) + '</div>'
              + '<div class="ai-regenerate" onclick="generateAiDetail(\'' + key + '\', true)">🔄 重新生成</div>';
          }
        }
      } catch {}
    }
    switchAiDetailTab('mnemonic');
    modal.hidden = false;
    document.body.classList.add('modal-open');
  } catch (e) {
    UI.toast('打开 AI 详解失败：' + e.message);
    console.error('openAiDetailModal error:', e);
  }
};

window.closeAiDetailModal = () => {
  try {
    const modal = document.getElementById('aiDetailModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  } catch (e) {
    console.error('closeAiDetailModal error:', e);
  }
};

window.switchAiDetailTab = (tab) => {
  try {
    const tabs = { mnemonic: 'aiTabMnemonic', collocation: 'aiTabCollocation', similar: 'aiTabSimilar', qa: 'aiTabQA' };
    const contents = { mnemonic: 'aiDetailMnemonic', collocation: 'aiDetailCollocation', similar: 'aiDetailSimilar', qa: 'aiDetailQA' };
    Object.values(tabs).forEach(id => document.getElementById(id)?.classList.remove('active'));
    Object.values(contents).forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    document.getElementById(tabs[tab])?.classList.add('active');
    const contentEl = document.getElementById(contents[tab]);
    if (contentEl) contentEl.style.display = 'block';
    // 问答 tab 自动聚焦输入框
    if (tab === 'qa') {
      const input = document.getElementById('aiQAInput');
      setTimeout(() => input?.focus(), 100);
    }
  } catch (e) {
    console.error('switchAiDetailTab error:', e);
  }
};

const AI_PROMPTS = {
  mnemonic: '你是一个考研英语词汇助教。请用简体中文给出单词的词根词缀分析和联想助记方法。要求：\n'
    + '1. 拆解词根词缀（如果有）\n'
    + '2. 提供 1-2 个联想记忆技巧\n'
    + '3. 如果有同根词可以列举\n'
    + '请用 markdown 格式组织，保持简洁。',
  collocation: '你是一个考研英语词汇助教。请用简体中文给出单词的常见搭配和用法。要求：\n'
    + '1. 常见搭配短语（3-5 个，带中文翻译）\n'
    + '2. 典型例句（2-3 个，带中文翻译）\n'
    + '3. 如果是动词标注及物/不及物，名词标注可数/不可数\n'
    + '请用 markdown 格式组织。',
  similar: '你是一个考研英语词汇助教。请用简体中文给出单词的近义词辨析。要求：\n'
    + '1. 列出 2-3 个近义词\n'
    + '2. 说明每个词的核心区别和使用场景\n'
    + '3. 给出典型搭配或例句帮助区分\n'
    + '请用 markdown 格式组织，可以用表格对比。',
  qa: '你是一个考研英语词汇助教。请用简体中文回答用户关于单词的疑问。'
    + '回答要简洁准确，可以包含例句。如果有近义词对比请说明区别。',
};

window.generateAiDetail = async (tab, force = false) => {
  if (!_aiDetailWord) { UI.toast('没有单词信息'); return; }
  const btnId = 'aiBtn' + tab.charAt(0).toUpperCase() + tab.slice(1);
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById('aiResult' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (!resultEl) return;
  const word = _aiDetailWord;

  // 检查缓存（除非强制刷新）
  if (!force) {
    try {
      const cacheKey = 'vcbly_ai_' + word.w + '_' + tab;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
            const data = JSON.parse(cached);
        if (data.text) {
          if (btn) btn.style.display = 'none';
          resultEl.innerHTML = '<div class="markdown-body">' + renderMarkdown(data.text) + '</div>'
            + '<div class="ai-regenerate" onclick="generateAiDetail(\'' + tab + '\', true)">🔄 重新生成</div>';
          return;
        }
      }
    } catch {}
  }

  // 按钮变为加载状态
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ai-spinner-inline"></span> 生成中…'; }
  resultEl.innerHTML = '';

  try {
    let loaded = false;
    let fullText = '';
    let container = null;
    const prompt = AI_PROMPTS[tab] || '';
    // wordInfo 作为 user 消息，不塞进 system prompt — 空 user 消息会导致 AI 延迟
    const question = `单词：${word.w}\n释义：${word.d || ''}\n发音：${word.uk || ''} ${word.us || ''}`;
    await askAi(
      word.w,
      { definition: word.d, pronunciation: `${word.uk || ''} ${word.us || ''}` },
      'explain', question, '',
      (chunk) => {
        // 竞态守卫：用户在生成过程中切换单词 → 丢弃旧响应
        if (_aiDetailWord?.w !== word.w) return;
        if (!loaded) {
          loaded = true;
          if (btn) btn.style.display = 'none';
          container = document.createElement('div');
          container.className = 'markdown-body';
          resultEl.appendChild(container);
        }
        fullText += chunk;
        container.innerHTML = renderMarkdown(fullText);
      },
      prompt
    );
    // 再次守卫，防止生成完成时用户已切换单词
    if (container && _aiDetailWord?.w === word.w) {
      container.innerHTML = renderMarkdown(fullText);
      const regen = document.createElement('div');
      regen.className = 'ai-regenerate';
      regen.textContent = '🔄 重新生成';
      regen.onclick = () => generateAiDetail(tab, true);
      resultEl.appendChild(regen);
      try {
        const cacheKey = 'vcbly_ai_' + word.w + '_' + tab;
        localStorage.setItem(cacheKey, JSON.stringify({ text: fullText, word: word.w, tab, time: Date.now() }));
      } catch {}
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.text || btn.textContent || '生成'; btn.style.display = ''; }
    resultEl.innerHTML = '<p style="color:var(--accent)">调用失败：' + e.message.replace(/</g, '&lt;') + '</p>';
  }
};

/** AI 问答（问答 tab 的发送处理） */
window.sendAiQuestion = async () => {
  const input = document.getElementById('aiQAInput');
  const output = document.getElementById('aiResultQA');
  if (!input || !output || !input.value.trim() || !_aiDetailWord) return;
  const question = input.value.trim();
  const word = _aiDetailWord;
  // XSS 防护后显示用户问题
  output.innerHTML += `<div style="margin:6px 0 2px;font-weight:600;color:var(--text)">你：${escapeHtml(question)}</div>`;
  output.innerHTML += '<div class="ai-loading" id="aiQAStatus"><span class="ai-spinner"></span> AI 回答中…</div>';
  output.scrollTop = output.scrollHeight;
  input.value = '';
  try {
    let full = '';
    const container = document.createElement('div');
    container.className = 'markdown-body';
    container.style.marginBottom = '8px';
    // 把单词信息注入 QA prompt，让 AI 知道在讨论哪个词
    const qaPrompt = AI_PROMPTS.qa + `\n当前单词：${word.w}\n释义：${word.d || ''}`;
    await askAi(
      word.w,
      { definition: word.d, pronunciation: `${word.uk || ''} ${word.us || ''}` },
      'explain', question, '',
      (chunk) => {
        // 竞态守卫
        if (_aiDetailWord?.w !== word.w) return;
        // 移除加载指示器（首次 chunk 时）
        const status = document.getElementById('aiQAStatus');
        if (status) status.remove();
        if (!container.parentNode) output.appendChild(container);
        full += chunk;
        container.innerHTML = renderMarkdown(full);
        output.scrollTop = output.scrollHeight;
      },
      qaPrompt
    );
  } catch (e) {
    const status = document.getElementById('aiQAStatus');
    if (status) status.remove();
    output.innerHTML += `<p style="color:var(--accent)">调用失败：${escapeHtml(e.message)}</p>`;
    output.scrollTop = output.scrollHeight;
    // 恢复输入（防止用户输入丢失）
    if (input && !input.value) input.value = question;
  }
};

/** 带超时的 fetch */
function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

/** 翻译例句 */
async function translateExample(text) {
  // MyMemory API（支持 CORS）
  try {
    const r = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`
    );
    if (r.ok) {
      const d = await r.json();
      if (d.responseData?.translatedText) {
        const t = d.responseData.translatedText.trim();
        if (t && t.toLowerCase() !== text.toLowerCase()) return t;
      }
    }
  } catch {}
  return '';
}

function highlightWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配原词 + 常见屈折后缀，避免 {0,5} 通配导致的假阳性（如 rest→restaurant）
  // 用 (?![a-zA-Z]) 代替 \b 避免撇号处断词（如 don't 不会匹配到 don）
  return text.replace(new RegExp(`${escaped}(?:s|es|ed|ing|ly|er|est|ment|ness|able|ible|tion|al)?(?![a-zA-Z])`, 'gi'), '<mark>$&</mark>');
}

window.fetchAndShowExample = async () => {
  const section = document.getElementById('reviewExampleSection');
  const output = document.getElementById('reviewExampleOutput');
  const btn = document.getElementById('reviewExampleBtn');
  if (!section || !output) return;

  // 切换：已显示则隐藏
  if (section.style.display === 'block') {
    section.style.display = 'none';
    output.style.display = 'none';
    if (btn) btn.classList.remove('active');
    return;
  }

  section.style.display = 'block';
  output.style.display = 'block';
  if (btn) btn.classList.add('active');

  const word = Session.getCurrentReviewWord();
  if (!word) { output.textContent = '没有正在查看的单词'; return; }

  const localKey = 'vcbly_examples_' + word.w;
  let examples = (() => { try { return JSON.parse(localStorage.getItem(localKey)); } catch { return null; } })();

  // 无缓存 → 调免费词典 API + 翻译
  if (!examples) {
    output.innerHTML = '<div class="ai-loading"><span class="ai-spinner"></span> 正在查找例句…</div>';
    try {
      const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.w)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data[0]) {
          const apiExamples = [];
          for (const meaning of data[0].meanings || []) {
            for (const def of meaning.definitions || []) {
              if (def.example) apiExamples.push({ en: def.example, cn: '' });
            }
          }
          if (apiExamples.length > 0) {
            examples = apiExamples.slice(0, 6);
            output.innerHTML = '<div class="ai-loading"><span class="ai-spinner"></span> 正在查找例句…</div>';
            const translateResults = await Promise.allSettled(
              examples.map(ex => translateExample(ex.en))
            );
            translateResults.forEach((r, i) => {
              if (r.status === 'fulfilled' && r.value) examples[i].cn = r.value;
            });
            try { localStorage.setItem(localKey, JSON.stringify(examples)); } catch {}
          }
        }
      }
    } catch {}
  }

  if (examples && examples.length > 0) {
    let needUpdate = false;
    for (const ex of examples) {
      if (ex.en && !ex.cn) {
        ex.cn = await translateExample(ex.en);
        if (ex.cn) needUpdate = true;
      }
    }
    if (needUpdate) {
      try { localStorage.setItem(localKey, JSON.stringify(examples)); } catch {}
    }
    output.innerHTML = examples.map((ex, i) =>
      `<div style="margin-bottom:10px">`
        + `<div><strong>${i + 1}.</strong> ${highlightWord(escapeHtml(ex.en), word.w)}</div>`
        + (ex.cn ? `<div style="color:var(--text-muted);font-size:0.82rem;margin-top:2px">${escapeHtml(ex.cn)}</div>` : '')
      + `</div>`
    ).join('');
  } else {
    output.textContent = `「${word.w}」暂时没有找到例句`;
  }
};

window.toggleAiConfig = () => {
  const modal = document.getElementById('aiConfigModal');
  if (!modal) return;
  const show = modal.hidden;
  modal.hidden = !show;
  document.body.classList.toggle('modal-open', show);
  if (show) {
    document.getElementById('aiConfigStatus').textContent = '';
    const cfg = loadAiConfig();
    document.getElementById('aiEndpoint').value = cfg.endpoint || '';
    document.getElementById('aiApiKey').value = cfg.apiKey || '';
    document.getElementById('aiModel').value = cfg.model || '';
  }
};

window.saveAiConfigForm = () => {
  const rawKey = document.getElementById('aiApiKey').value.trim();
  if (rawKey && !/^[\x00-\xFF]*$/.test(rawKey)) {
    UI.toast('API Key 包含非 ASCII 字符，请检查');
    return;
  }
  saveAiConfig({
    endpoint: document.getElementById('aiEndpoint').value.trim(),
    apiKey: rawKey,
    model: document.getElementById('aiModel').value.trim(),
  });
  const status = document.getElementById('aiConfigStatus');
  if (status) status.textContent = '配置已保存 ✓';
  UI.toast('AI 配置已保存');
};

window.testAiConfig = async () => {
  const rawKey = document.getElementById('aiApiKey').value.trim();
  if (rawKey && !/^[\x00-\xFF]*$/.test(rawKey)) {
    UI.toast('API Key 包含非 ASCII 字符，请检查');
    return;
  }
  // 先把表单内容保存到 localStorage，这样用户即使没点"保存"也能测试
  saveAiConfig({
    endpoint: document.getElementById('aiEndpoint').value.trim(),
    apiKey: rawKey,
    model: document.getElementById('aiModel').value.trim(),
  });
  const status = document.getElementById('aiConfigStatus');
  if (status) status.textContent = '测试连接中…';
  UI.toast('正在测试 API 连接…');
  try {
    // ai.js imported at top
    await askAi('test', {}, 'explain');
    if (status) status.textContent = '连接成功 ✓';
    UI.toast('AI 连接测试成功');
  } catch (e) {
    if (status) status.textContent = '连接失败：' + e.message;
    UI.toast('AI 连接测试失败：' + e.message);
  }
};

function showHashPanel() {
  const params = new URLSearchParams(location.search);
  const hrefPanel = location.href.match(/[?&#]panel=([^&#]+)/)?.[1];
  const name = decodeURIComponent((params.get('panel') || hrefPanel || location.hash.replace('#', '')).trim());
  if (['history', 'notebook', 'badges'].includes(name)) {
    window.showPanel(name);
  } else {
    window.showPanel('home');
  }
}

// ===== 键盘快捷键 =====
function isEditableTarget(target) {
  return target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

document.addEventListener('keydown', e => {
  if (isEditableTarget(e.target)) return;

  const badgeModal = document.getElementById('badgeModal');
  if (badgeModal && !badgeModal.hidden) {
    if (e.key === 'Escape') UI.closeBadgeModal();
    return;
  }
  const historyModal = document.getElementById('historyModal');
  if (historyModal && !historyModal.hidden) {
    if (e.key === 'Escape') UI.closeHistoryModal();
    return;
  }

  const testPanel = document.getElementById(PANEL.TEST);
  const reviewPanel = document.getElementById(PANEL.REVIEW);
  const notebookPanel = document.getElementById(PANEL.NOTEBOOK);

  // 错词本：上下选词，左右切换当天测试次数，P 播放发音
  if (notebookPanel && notebookPanel.classList.contains('active')) {
    const key = e.key.toLowerCase();
    let handled = false;
    if (e.key === 'ArrowUp' || key === 'k') handled = UI.moveNotebookWord(-1);
    if (e.key === 'ArrowDown' || key === 'j') handled = UI.moveNotebookWord(1);
    if (e.key === 'ArrowLeft' || key === 'a') handled = UI.moveNotebookSession(-1);
    if (e.key === 'ArrowRight' || key === 'd') handled = UI.moveNotebookSession(1);
    if (key === 'p') handled = UI.playNotebookSelectedAudio();
    if (e.key === 'Enter' || e.key === ' ') handled = UI.selectNotebookCurrentWord();
    if (handled) e.preventDefault();
    return;
  }

  // 复习模式：左右翻页
  if (reviewPanel && reviewPanel.classList.contains('active')) {
    if (e.key === 'ArrowLeft' || e.key === 'a') Session.reviewPrev();
    if (e.key === 'ArrowRight' || e.key === 'd') Session.reviewNext();
    return;
  }

  // 测试模式
  if (testPanel && testPanel.classList.contains('active') && session.active) {
    // 数字键 1-4 选择对应选项
    if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      Session.selectAnswer(parseInt(e.key) - 1);
    }
    // 空格或回车：下一题
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const nextBtn = document.getElementById('nextBtn');
      if (nextBtn && nextBtn.style.display !== 'none') {
        Session.nextWord();
      }
    }
  }
});

// ===== 页面可见性 =====
// 后台标签页暂停非必要动画与任务，减少发热
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
});

// ===== 启动 =====
window.addEventListener('hashchange', showHashPanel);
try {
  init();
} finally {
  showHashPanel();
}
