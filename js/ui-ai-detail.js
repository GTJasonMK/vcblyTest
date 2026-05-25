import { askAi, renderMarkdown } from './ai.js';
import { getCurrentReviewWord } from './session.js';
import { loadAiDetailCache, saveAiDetailCache } from './storage.js';
import { escapeHtml, toast } from './ui-common.js';

let _aiDetailWord = null;
const _aiAbortControllers = new Set();

const AI_PROMPTS = {
  mnemonic: '你是一个考研英语词汇助教。请用简体中文给出单词的词根词缀分析和联想助记方法。要求：\n'
    + '1. 拆解词根词缀（如果有）\n'
    + '2. 提供 1-2 个联想记忆技巧\n'
    + '3. 如果有同根词可以列举\n'
    + '4. 列举 2-3 个典型使用场合（如正式/非正式、口语/书面、学术/日常等），各配一个例句和中文翻译\n'
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

function abortAllAi() {
  for (const c of _aiAbortControllers) {
    try { c.abort(); } catch {}
  }
  _aiAbortControllers.clear();
}

function resetAiButton(btn) {
  if (!btn) return;
  btn.style.display = '';
  btn.disabled = false;
  btn.innerHTML = btn.dataset.text || btn.textContent;
}

function renderCachedDetail(resultEl, tab, text) {
  resultEl.innerHTML = '<div class="markdown-body">' + renderMarkdown(text) + '</div>'
    + '<div class="ai-regenerate" onclick="generateAiDetail(\'' + tab + '\', true)">🔄 重新生成</div>';
}

export async function openAiDetailModal() {
  try {
    const modal = document.getElementById('aiDetailModal');
    if (!modal) { toast('弹窗元素未找到'); return; }
    const word = getCurrentReviewWord();
    if (!word) { toast('没有正在复习的单词'); return; }

    if (_aiDetailWord && _aiDetailWord.w !== word.w) abortAllAi();
    _aiDetailWord = word;

    const infoEl = document.getElementById('aiDetailWordInfo');
    if (infoEl) infoEl.textContent = `${word.w}  ${word.uk || ''}  ${word.us || ''}  —  ${word.d}`;

    const tabs = [
      { name: 'Mnemonic', key: 'mnemonic', hasBtn: true },
      { name: 'Collocation', key: 'collocation', hasBtn: true },
      { name: 'Similar', key: 'similar', hasBtn: true },
      { name: 'QA', key: 'qa', hasBtn: false },
    ];

    const qaResult = document.getElementById('aiResultQA');
    if (qaResult) qaResult.textContent = '';
    const qaInput = document.getElementById('aiQAInput');
    if (qaInput) qaInput.value = '';

    for (const { name, key, hasBtn } of tabs) {
      if (!hasBtn) continue;
      const el = document.getElementById('aiResult' + name);
      if (el) el.textContent = '';
      const btn = document.getElementById('aiBtn' + name);
      resetAiButton(btn);
      const data = loadAiDetailCache(word.w, key);
      if (data?.text && btn && el) {
        btn.style.display = 'none';
        renderCachedDetail(el, key, data.text);
      }
    }

    switchAiDetailTab('mnemonic');
    modal.hidden = false;
    document.body.classList.add('modal-open');
  } catch (e) {
    toast('打开 AI 详解失败：' + e.message);
    console.error('openAiDetailModal error:', e);
  }
}

export function closeAiDetailModal() {
  try {
    const modal = document.getElementById('aiDetailModal');
    if (!modal) return;
    abortAllAi();
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  } catch (e) {
    console.error('closeAiDetailModal error:', e);
  }
}

export function switchAiDetailTab(tab) {
  try {
    const tabs = { mnemonic: 'aiTabMnemonic', collocation: 'aiTabCollocation', similar: 'aiTabSimilar', qa: 'aiTabQA' };
    const contents = { mnemonic: 'aiDetailMnemonic', collocation: 'aiDetailCollocation', similar: 'aiDetailSimilar', qa: 'aiDetailQA' };
    Object.values(tabs).forEach(id => document.getElementById(id)?.classList.remove('active'));
    Object.values(contents).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.getElementById(tabs[tab])?.classList.add('active');
    const contentEl = document.getElementById(contents[tab]);
    if (contentEl) contentEl.style.display = 'block';
    if (tab === 'qa') {
      const input = document.getElementById('aiQAInput');
      setTimeout(() => input?.focus(), 100);
    }
  } catch (e) {
    console.error('switchAiDetailTab error:', e);
  }
}

export async function generateAiDetail(tab, force = false) {
  if (!_aiDetailWord) { toast('没有单词信息'); return; }
  const btnId = 'aiBtn' + tab.charAt(0).toUpperCase() + tab.slice(1);
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById('aiResult' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (!resultEl) return;
  const word = _aiDetailWord;

  if (!force) {
    const data = loadAiDetailCache(word.w, tab);
    if (data?.text) {
      if (btn) btn.style.display = 'none';
      renderCachedDetail(resultEl, tab, data.text);
      return;
    }
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="ai-spinner-inline"></span> 生成中…';
  }
  resultEl.innerHTML = '';

  const aiCtrl = new AbortController();
  _aiAbortControllers.add(aiCtrl);
  try {
    let loaded = false;
    let fullText = '';
    let container = null;
    const prompt = AI_PROMPTS[tab] || '';
    const question = `单词：${word.w}\n释义：${word.d || ''}\n发音：${word.uk || ''} ${word.us || ''}`;
    await askAi(
      word.w,
      { definition: word.d, pronunciation: `${word.uk || ''} ${word.us || ''}` },
      'explain', question,
      (chunk) => {
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
      prompt,
      aiCtrl.signal
    );
    if (container && _aiDetailWord?.w === word.w) {
      container.innerHTML = renderMarkdown(fullText);
      const regen = document.createElement('div');
      regen.className = 'ai-regenerate';
      regen.textContent = '🔄 重新生成';
      regen.onclick = () => generateAiDetail(tab, true);
      resultEl.appendChild(regen);
      saveAiDetailCache(word.w, tab, fullText);
    }
  } catch (e) {
    if (aiCtrl.signal.aborted) return;
    resetAiButton(btn);
    resultEl.innerHTML = '<p style="color:var(--accent)">调用失败：' + escapeHtml(e.message) + '</p>';
  } finally {
    _aiAbortControllers.delete(aiCtrl);
  }
}

export async function sendAiQuestion() {
  const input = document.getElementById('aiQAInput');
  const output = document.getElementById('aiResultQA');
  if (!input || !output || !input.value.trim() || !_aiDetailWord) return;
  const question = input.value.trim();
  const word = _aiDetailWord;

  output.innerHTML += `<div style="margin:6px 0 2px;font-weight:600;color:var(--text)">你：${escapeHtml(question)}</div>`;
  output.innerHTML += '<div class="ai-loading" id="aiQAStatus"><span class="ai-spinner"></span> AI 回答中…</div>';
  output.scrollTop = output.scrollHeight;
  input.value = '';

  const aiCtrl = new AbortController();
  _aiAbortControllers.add(aiCtrl);
  try {
    let full = '';
    const container = document.createElement('div');
    container.className = 'markdown-body';
    container.style.marginBottom = '8px';
    const qaPrompt = AI_PROMPTS.qa + `\n当前单词：${word.w}\n释义：${word.d || ''}`;
    await askAi(
      word.w,
      { definition: word.d, pronunciation: `${word.uk || ''} ${word.us || ''}` },
      'explain', question,
      (chunk) => {
        if (_aiDetailWord?.w !== word.w) return;
        const status = document.getElementById('aiQAStatus');
        if (status) status.remove();
        if (!container.parentNode) output.appendChild(container);
        full += chunk;
        container.innerHTML = renderMarkdown(full);
        output.scrollTop = output.scrollHeight;
      },
      qaPrompt,
      aiCtrl.signal
    );
  } catch (e) {
    const status = document.getElementById('aiQAStatus');
    if (status) status.remove();
    if (aiCtrl.signal.aborted) return;
    output.innerHTML += `<p style="color:var(--accent)">调用失败：${escapeHtml(e.message)}</p>`;
    output.scrollTop = output.scrollHeight;
    if (input && !input.value) input.value = question;
  } finally {
    _aiAbortControllers.delete(aiCtrl);
  }
}
