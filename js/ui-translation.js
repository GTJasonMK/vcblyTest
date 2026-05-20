import { askAi } from './ai.js';
import { escapeHtml, toast } from './ui-common.js';

const SYSTEM_PROMPT = [
  '你是一个考研英语中译英训练出题助手。',
  '请只输出严格 JSON，不要 markdown，不要代码块，不要解释。',
  'JSON 字段固定为：{"zh":"中文句子","en":"English sentence."}',
  '要求英文句子自然、语法正确，中文与英文含义完全对应。',
  '英文句子只使用普通英文标点，避免括号、斜杠、编号和复杂专名。',
].join('\n');

const state = {
  current: null,
  hintCounts: [],
  loading: false,
};

function el(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  const node = el('translationStatus');
  if (node) node.textContent = text;
}

function setFeedback(text, type = '') {
  const node = el('translationFeedback');
  if (!node) return;
  node.textContent = text;
  node.className = 'translation-feedback' + (type ? ` ${type}` : '');
}

function stripJsonFence(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) return unfenced.slice(start, end + 1);
  return unfenced;
}

function parseAiPair(text) {
  const parsed = JSON.parse(stripJsonFence(text));
  const zh = String(parsed.zh || '').trim();
  const en = String(parsed.en || '').trim();
  if (!zh || !en) throw new Error('AI 返回缺少中文或英文句子');
  return { zh, en };
}

function splitEnglishSentence(sentence) {
  const chunks = String(sentence || '').trim().split(/\s+/).filter(Boolean);
  return chunks.map((chunk) => {
    const match = chunk.match(/^([^A-Za-z0-9']*)([A-Za-z0-9]+(?:'[A-Za-z0-9]+)?)([^A-Za-z0-9']*)$/);
    if (!match) {
      return { raw: chunk, prefix: '', answer: chunk, suffix: '', isWord: /[A-Za-z0-9]/.test(chunk) };
    }
    return {
      raw: chunk,
      prefix: match[1] || '',
      answer: match[2] || '',
      suffix: match[3] || '',
      isWord: true,
    };
  }).filter(token => token.isWord && token.answer);
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

function updateActionState(disabled) {
  const generateBtn = el('translationGenerateBtn');
  if (generateBtn) {
    generateBtn.disabled = disabled;
    generateBtn.textContent = disabled ? '生成中…' : '生成句子';
  }
}

function renderExercise(pair) {
  const tokens = splitEnglishSentence(pair.en);
  if (tokens.length === 0) throw new Error('英文句子无法拆分为单词');

  state.current = { ...pair, tokens };
  state.hintCounts = new Array(tokens.length).fill(0);

  const zh = el('translationChinese');
  const count = el('translationWordCount');
  const blanks = el('translationBlanks');
  if (zh) zh.textContent = pair.zh;
  if (count) count.textContent = `${tokens.length} 个单词`;
  if (blanks) {
    blanks.innerHTML = tokens.map((token, index) => {
      const width = Math.max(4, Math.min(token.answer.length + 1, 16));
      return `<span class="translation-token" data-index="${index}">
        ${token.prefix ? `<span class="translation-punc">${escapeHtml(token.prefix)}</span>` : ''}
        <input class="translation-input" id="translationInput${index}" data-index="${index}" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" style="width:${width}ch" placeholder="${'-'.repeat(Math.min(token.answer.length, 12))}" aria-label="第 ${index + 1} 个英文单词">
        ${token.suffix ? `<span class="translation-punc">${escapeHtml(token.suffix)}</span>` : ''}
      </span>`;
    }).join('');
    blanks.querySelectorAll('.translation-input').forEach(input => {
      input.addEventListener('input', () => {
        input.classList.remove('correct', 'wrong', 'hinted');
        setFeedback('');
      });
      input.addEventListener('keydown', (e) => {
        handleInputKeydown(e, Number(input.dataset.index));
      });
    });
  }
  setFeedback('');
  setStatus('按每个横杠的长度填写英文单词；Enter 跳到下一个空格。');
  setTimeout(() => el('translationInput0')?.focus(), 30);
}

function buildUserPrompt() {
  const level = el('translationLevel')?.value || '考研英语中等难度';
  const length = el('translationLength')?.value || '10 到 14 个英文单词';
  return [
    `请生成 1 组中译英训练句。`,
    `难度：${level}。`,
    `英文长度：${length}。`,
    '句子应适合英语学习训练，包含常见学术、生活或思辨表达。',
    '英文句子不要太口语化，不要包含中文。',
    '返回示例：{"zh":"规律的复习能帮助学生长期保持词汇记忆。","en":"Regular review helps students retain vocabulary over time."}',
  ].join('\n');
}

export async function startTranslationTraining() {
  if (state.loading) return;
  state.loading = true;
  updateActionState(true);
  setFeedback('');
  setStatus('AI 正在生成翻译训练句…');

  const blanks = el('translationBlanks');
  if (blanks) blanks.innerHTML = '<span class="translation-loading">正在生成题目…</span>';

  try {
    const text = await askAi(
      'translation-training',
      {},
      'quiz',
      buildUserPrompt(),
      null,
      SYSTEM_PROMPT
    );
    renderExercise(parseAiPair(text));
  } catch (err) {
    state.current = null;
    if (blanks) blanks.innerHTML = '<span class="translation-empty">生成失败，请检查 AI 设置后重试</span>';
    setStatus('生成失败');
    setFeedback(err.message || 'AI 生成失败', 'wrong');
    toast(err.message || 'AI 生成失败');
  } finally {
    state.loading = false;
    updateActionState(false);
  }
}

export function checkTranslationAnswer() {
  if (!state.current) {
    toast('请先生成一句训练题');
    return false;
  }

  let wrongCount = 0;
  let emptyCount = 0;
  state.current.tokens.forEach((token, index) => {
    const input = el(`translationInput${index}`);
    if (!input) return;
    const value = normalize(input.value);
    const answer = normalize(token.answer);
    input.classList.remove('correct', 'wrong');
    if (!value) {
      emptyCount += 1;
      input.classList.add('wrong');
    } else if (value === answer) {
      input.classList.add('correct');
    } else {
      wrongCount += 1;
      input.classList.add('wrong');
    }
  });

  if (wrongCount === 0 && emptyCount === 0) {
    setFeedback('全部正确。', 'correct');
    setStatus(`答案：${state.current.en}`);
    return true;
  }

  const totalWrong = wrongCount + emptyCount;
  setFeedback(`还有 ${totalWrong} 个空格需要修改。`, 'wrong');
  focusFirstUnsolved();
  return false;
}

export function giveTranslationHint() {
  if (!state.current) {
    toast('请先生成一句训练题');
    return;
  }

  const index = findFirstUnsolvedIndex();
  if (index < 0) {
    setFeedback('当前句子已经全部正确。', 'correct');
    return;
  }

  const token = state.current.tokens[index];
  const input = el(`translationInput${index}`);
  if (!input) return;

  const correctPrefix = commonPrefixLength(normalize(input.value), normalize(token.answer));
  state.hintCounts[index] = Math.min(token.answer.length, Math.max(state.hintCounts[index], correctPrefix) + 1);
  const hint = token.answer.slice(0, state.hintCounts[index]);
  input.value = hint;
  input.classList.remove('correct', 'wrong');
  input.classList.add('hinted');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  setFeedback(`第 ${index + 1} 个单词提示：${hint}`, '');
}

export function focusTranslationInput(index) {
  el(`translationInput${index}`)?.focus();
}

function findFirstUnsolvedIndex() {
  if (!state.current) return -1;
  return state.current.tokens.findIndex((token, index) => {
    const input = el(`translationInput${index}`);
    return !input || normalize(input.value) !== normalize(token.answer);
  });
}

function commonPrefixLength(a, b) {
  let count = 0;
  const max = Math.min(a.length, b.length);
  while (count < max && a[count] === b[count]) count += 1;
  return count;
}

function focusFirstUnsolved() {
  const index = findFirstUnsolvedIndex();
  if (index >= 0) focusTranslationInput(index);
}

function handleInputKeydown(e, index) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const next = el(`translationInput${index + 1}`);
    if (next) {
      next.focus();
      next.select();
    } else {
      checkTranslationAnswer();
    }
  }
  if (e.key === 'Backspace' && !e.currentTarget.value && index > 0) {
    const prev = el(`translationInput${index - 1}`);
    if (prev) {
      e.preventDefault();
      prev.focus();
      prev.setSelectionRange(prev.value.length, prev.value.length);
    }
  }
}
