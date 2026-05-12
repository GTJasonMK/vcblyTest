// ========== AI 大模型调用模块 ==========
// 通用 OpenAI 兼容接口，用户需自行配置 endpoint / key / model。

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

/** 读取当前 AI 配置 */
function getConfig() {
  try {
    const raw = localStorage.getItem('vocab_ai_config');
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg.apiKey) return null;
    return {
      endpoint: cfg.endpoint || DEFAULT_ENDPOINT,
      model: cfg.model || DEFAULT_MODEL,
      apiKey: cfg.apiKey,
    };
  } catch { return null; }
}

/** 调用 AI 接口获取单词详解
 *  @param {string} word - 当前单词
 *  @param {object} options - { definition, pronunciation, extra }
 *  @param {'explain'|'quiz'} mode - 模式：详解 / 问答
 *  @param {string} [question] - 用户提问内容
 *  @param {(chunk: string) => void} [onChunk] - 流式回调，传入则启用 stream
 *  @param {string} [customPrompt] - 自定义 system prompt（用于不同 tab 的不同 prompt）
 *  @param {AbortSignal} [externalSignal] - 外部 AbortSignal；触发 abort 时立即中断请求
 *  @returns {Promise<string>} AI 返回的完整文本
 */
export async function askAi(word, options = {}, mode = 'explain', question = '', onChunk = null, customPrompt = null, externalSignal = null) {
  const config = getConfig();
  if (!config) throw new Error('请先在设置中配置 API Key');
  if (!/^[\x00-\xFF]*$/.test(config.apiKey)) {
    throw new Error('API Key 包含非 ASCII 字符（如中文/emoji），请检查');
  }

  const explainSystem = '你是一个考研英语词汇助教。请用简体中文给出单词的详细解析，包括：'
    + '1. 词根词缀分析与助记方法（用联想记忆法）\n'
    + '2. 近义词辨析（列出 2-3 个近义词，说明区别）\n'
    + '3. 常见搭配与短语（列举 2-3 个高频搭配）\n'
    + '4. 常见用法与例句（2-3 个例句，带中文翻译）\n'
    + '如果单词是动词，标注及物/不及物；如果是名词，标注可数/不可数。\n'
    + `单词：${word}\n`
    + `释义：${options.definition || '—'}\n`
    + (options.pronunciation ? `发音：${options.pronunciation}\n` : '')
    + (options.extra ? `${options.extra}\n` : '')
    + '请用简洁清晰的中文组织，每条 1-2 句话即可。';

  const quizSystem = '你是一个考研英语词汇助教。请根据用户的提问回答关于单词的用法、辨析等问题。'
    + '回答要简洁准确，用简体中文。如果有例句请附上中文翻译。'
    + `当前单词：${word}\n释义：${options.definition || '—'}\n`;

  const messages = [];
  // system：优先用 customPrompt，否则根据 mode 选默认
  const systemContent = customPrompt || (mode === 'explain' ? explainSystem : quizSystem);
  messages.push({ role: 'system', content: systemContent });
  // user：始终添加（AI 需要 user 消息才知道该做什么），空 question 不添加
  if (question) messages.push({ role: 'user', content: question });

  const useStream = typeof onChunk === 'function';
  const ctrl = new AbortController();
  // 外部 abort 与内部 timeout 任一触发都中断请求
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timeout = setTimeout(() => ctrl.abort(), 20000);
  const cleanup = () => {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  };
  const resp = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: 1200,
      temperature: 0.7,
      stream: useStream,
    }),
    signal: ctrl.signal,
  }).finally(cleanup);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`AI 请求失败（${resp.status}）：${errText.slice(0, 200)}`);
  }

  if (!useStream) {
    const data = await resp.json();
    if (!data.choices || !data.choices[0]) {
      throw new Error('AI 返回格式异常');
    }
    return data.choices[0].message.content;
  }

  // ---- 流式处理 ----
  let full = '';
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // 流式期间外部 abort 仍需能中断 reader
  const abortReader = () => { try { reader.cancel(); } catch {} };
  if (externalSignal) {
    if (externalSignal.aborted) abortReader();
    else externalSignal.addEventListener('abort', abortReader, { once: true });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // 按行分割 SSE
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onChunk(delta);
          }
        } catch {
          // 忽略解析失败的 chunk（非关键错误）
        }
      }
    }
  } finally {
    if (externalSignal) externalSignal.removeEventListener('abort', abortReader);
  }
  return full;
}

/** 检查 AI 配置是否就绪 */
export function isAiConfigured() {
  return getConfig() !== null;
}

// ---- Markdown → HTML ----

/** 把 AI 返回的 Markdown 文本渲染为安全 HTML */
export function renderMarkdown(text) {
  if (!text) return '';

  // 1) 用占位符保护代码块、行内代码，避免内部被后续规则破坏
  const codeBlocks = [];
  const inlineCodes = [];
  let html = text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const escaped = code
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      codeBlocks.push(`<pre><code>${escaped}</code></pre>`);
      return `\x00CODEBLOCK${idx}\x00`;
    })
    .replace(/`([^`]+)`/g, (_, c) => {
      const idx = inlineCodes.length;
      const escaped = c
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      inlineCodes.push(`<code>${escaped}</code>`);
      return `\x00INLINECODE${idx}\x00`;
    });

  // 2) 转义 HTML（保护占位符）
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    ;

  // 3) 恢复占位符（避免被后续规则损坏）
  codeBlocks.forEach((block, i) => {
    html = html.replace(`\x00CODEBLOCK${i}\x00`, () => block);
  });
  inlineCodes.forEach((block, i) => {
    html = html.replace(`\x00INLINECODE${i}\x00`, () => block);
  });

  // 4) 块级元素（逐行处理）
  const lines = html.split('\n');
  const out = [];
  let inList = false;       // 当前是否在列表中
  let listType = '';        // 'ul' 或 'ol'
  let inBlockquote = false;
  let tableRows = [];       // 暂存表格行，遇到非表格行时 flush

  function closeList() {
    if (inList) { out.push(`</${listType}>`); inList = false; listType = ''; }
  }
  function closeBlockquote() {
    if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
  }
  function flushTable() {
    if (tableRows.length === 0) return;
    const header = tableRows[0];
    const body = tableRows.slice(1);
    out.push('<table>');
    if (header) out.push('<thead>', header.replace(/<tr>/i, '<tr>').replace(/<td>/gi, '<th>').replace(/<\/td>/gi, '</th>'), '</thead>');
    if (body.length > 0) out.push('<tbody>', ...body, '</tbody>');
    out.push('</table>');
    tableRows = [];
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // 空行 → 关闭打开的块，flush 表格
    if (!trimmed) {
      closeList(); closeBlockquote(); flushTable();
      out.push('');
      continue;
    }

    // 已经保护起来的代码块原样输出
    if (trimmed.startsWith('<pre><code>') || trimmed.startsWith('<code>')) {
      closeList(); closeBlockquote();
      out.push(line);
      continue;
    }

    // 水平分割线 --- / *** / ___
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      closeList(); closeBlockquote();
      out.push('<hr>');
      continue;
    }

    // 引用块 > text
    if (/^>\s?(.*)$/.test(trimmed)) {
      closeList();
      const content = trimmed.replace(/^>\s?/, '');
      if (!inBlockquote) { inBlockquote = true; out.push('<blockquote>'); }
      out.push(content || '<br>');
      continue;
    }
    if (inBlockquote) { closeBlockquote(); }

    // 标题
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      closeList();
      const level = headerMatch[1].length;
      const text = processInline(headerMatch[2]);
      out.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    // 任务列表 - [ ] / - [x]
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const checked = taskMatch[1].toLowerCase() === 'x' ? ' checked' : '';
      const text = processInline(taskMatch[2]);
      if (!inList || listType !== 'ul') { closeList(); inList = true; listType = 'ul'; out.push('<ul class="md-task-list">'); }
      out.push(`<li class="md-task"><label><input type="checkbox"${checked} disabled>${text}</label></li>`);
      continue;
    }

    // 无序列表 - / * / +
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      const text = processInline(ulMatch[1]);
      if (!inList || listType !== 'ul') { closeList(); inList = true; listType = 'ul'; out.push('<ul>'); }
      out.push(`<li>${text}</li>`);
      continue;
    }

    // 有序列表 1. / 1)
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      const text = processInline(olMatch[2]);
      if (!inList || listType !== 'ol') { closeList(); inList = true; listType = 'ol'; out.push('<ol>'); }
      out.push(`<li>${text}</li>`);
      continue;
    }

    // 表格行 | ... | ... |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      closeList(); closeBlockquote();
      const cells = trimmed.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(s => s.trim());
      if (cells.every(c => /^:?-+:?\s*$/.test(c))) continue; // 分隔行，跳过（支持 :--- 和 :---:）
      // 暂存到 tableRows，遇到非表格行时统一 flush
      tableRows.push(`<tr>${cells.map(c => `<td>${processInline(c)}</td>`).join('')}</tr>`);
      continue;
    }

    // 非表格行 → 先 flush 表格
    flushTable();
    // 普通段落
    closeList();
    out.push(processInline(line));
  }

  closeList(); closeBlockquote(); flushTable();

  // 5) 用 <p> 包裹段落（连续非空行合为一段）
  const result = [];
  let paraLines = [];
  for (const line of out) {
    if (line === '') {
      if (paraLines.length > 0) {
        result.push(`<p>${paraLines.join('<br>')}</p>`);
        paraLines = [];
      }
      continue;
    }
    // 块级元素直接输出
    if (/^<(h[1-6]|pre|blockquote|ul|ol|li|hr|tr|table)/.test(line) || /^<\/(ul|ol|blockquote|table)>/.test(line)) {
      if (paraLines.length > 0) { result.push(`<p>${paraLines.join('<br>')}</p>`); paraLines = []; }
      result.push(line);
      continue;
    }
    paraLines.push(line);
  }
  if (paraLines.length > 0) result.push(`<p>${paraLines.join('<br>')}</p>`);

  return result.join('\n');

  // ---- 行内处理 ----
  function escapeAttr(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
  // 安全 URL：仅放行 http/https/mailto 与同源相对路径，阻断 javascript:/data: 等
  function safeUrl(raw) {
    const u = String(raw ?? '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:)/i.test(u)) return u;
    // 相对路径、协议相对、片段、查询：放行
    if (/^[/?#]/.test(u) || !/:/.test(u.split(/[/?#]/)[0])) return u;
    return '';
  }
  function processInline(str) {
    if (!str) return '';
    let s = str;
    // 图片 ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const href = safeUrl(url);
      if (!href) return escapeAttr(alt);
      return `<img src="${escapeAttr(href)}" alt="${escapeAttr(alt)}" loading="lazy">`;
    });
    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const href = safeUrl(url);
      if (!href) return text;
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${text}</a>`;
    });
    // ~~删除线~~
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // **粗体**
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *斜体*（不匹配 **）
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    return s;
  }
}
