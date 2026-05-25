import { getCurrentReviewWord } from './session.js';
import { loadExampleCache, saveExampleCache } from './storage.js';
import { escapeHtml } from './ui-common.js';

function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function translateExample(text) {
  try {
    const response = await fetchWithTimeout(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`
    );
    if (response.ok) {
      const data = await response.json();
      if (data.responseData?.translatedText) {
        const translated = data.responseData.translatedText.trim();
        if (translated && translated.toLowerCase() !== text.toLowerCase()) return translated;
      }
    }
  } catch {}
  return '';
}

function highlightWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escaped}(?:s|es|ed|ing|ly|er|est|ment|ness|able|ible|tion|al)?(?![a-zA-Z])`, 'gi'), '<mark>$&</mark>');
}

async function loadDictionaryExamples(word) {
  const response = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!response.ok) return null;

  const data = await response.json();
  if (!Array.isArray(data) || !data[0]) return null;

  const examples = [];
  for (const meaning of data[0].meanings || []) {
    for (const def of meaning.definitions || []) {
      if (def.example) examples.push({ en: def.example, cn: '' });
    }
  }
  return examples.length > 0 ? examples.slice(0, 6) : null;
}

async function fillMissingTranslations(examples) {
  const pending = examples
    .map((example, index) => example.en && !example.cn ? { index, en: example.en } : null)
    .filter(Boolean);
  if (pending.length === 0) return false;

  const results = await Promise.allSettled(pending.map(item => translateExample(item.en)));
  let changed = false;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      examples[pending[index].index].cn = result.value;
      changed = true;
    }
  });
  return changed;
}

function renderExamples(output, word, examples) {
  output.innerHTML = examples.map((example, index) =>
    `<div style="margin-bottom:10px">`
      + `<div><strong>${index + 1}.</strong> ${highlightWord(escapeHtml(example.en), word.w)}</div>`
      + (example.cn ? `<div style="color:var(--text-muted);font-size:0.82rem;margin-top:2px">${escapeHtml(example.cn)}</div>` : '')
    + `</div>`
  ).join('');
}

export async function fetchAndShowExample() {
  const section = document.getElementById('reviewExampleSection');
  const output = document.getElementById('reviewExampleOutput');
  const btn = document.getElementById('reviewExampleBtn');
  if (!section || !output) return;

  if (section.style.display === 'block') {
    section.style.display = 'none';
    output.style.display = 'none';
    if (btn) btn.classList.remove('active');
    return;
  }

  section.style.display = 'block';
  output.style.display = 'block';
  if (btn) btn.classList.add('active');

  const word = getCurrentReviewWord();
  if (!word) {
    output.textContent = '没有正在查看的单词';
    return;
  }

  let examples = loadExampleCache(word.w);
  if (!examples) {
    output.innerHTML = '<div class="ai-loading"><span class="ai-spinner"></span> 正在查找例句…</div>';
    try {
      examples = await loadDictionaryExamples(word.w);
      if (examples) {
        await fillMissingTranslations(examples);
        saveExampleCache(word.w, examples);
      }
    } catch {}
  }

  if (!examples || examples.length === 0) {
    output.textContent = `「${word.w}」暂时没有找到例句`;
    return;
  }

  if (await fillMissingTranslations(examples)) {
    saveExampleCache(word.w, examples);
  }
  renderExamples(output, word, examples);
}
