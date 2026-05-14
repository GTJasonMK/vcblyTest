// ========== UI 入口（barrel） ==========
// 通用工具放在 ./ui-common.js；徽章 / 错词本 / 词汇地图三大块拆为独立子模块。
// 本文件只保留：测试 / 结果 / 复习 / 历史 / 首页统计 / 恢复横幅 / 设置 input 这些
// 体量较小、相互耦合的面板，并 re-export 子模块的公开接口供 main.js 与 session.js
// 通过 `import * as UI from './ui.js'` 使用。

import { allWords, session } from './state.js';
import {
  escapeHtml,
  preloadWordWindow,
  renderAudioButton,
  showPanel,
  toast,
  toAudioItem,
  wrongCountOf,
} from './ui-common.js';

import {
  preloadWordAudio,
  preloadWordAudioList,
  updateAudioButton,
} from './audio.js';
import { renderAchievements } from './ui-badges.js';

// 重新导出，让 import * as UI from './ui.js' 仍能拿到全部 API。
// 必须静态 re-export，副作用模块（错词本/词汇地图的 window.* 挂载、DOMContentLoaded
// 监听器）才能在主入口加载时立即注册。
export { escapeHtml, showPanel, toast, wrongCountOf } from './ui-common.js';
export {
  renderBadgePage,
  openBadgeModal,
  closeBadgeModal,
  positionAchievePanel,
} from './ui-badges.js';
export {
  renderHomeNotebookSummary,
  renderNotebook,
  moveNotebookWord,
  moveNotebookSession,
  selectNotebookCurrentWord,
  playNotebookSelectedAudio,
} from './ui-notebook.js';
export { renderWordMap } from './ui-word-map.js';

// ===== 测试面板 =====

/** 隐藏复习面板的例句输出（切换单词时重置） */
/** 旧记录释义缺失时，从当前词库回补 */
function resolveDef(w) {
  if (!w.d || !w.d.includes('找不到解释')) return w.d;
  const cur = allWords.find(aW => aW.w === w.w);
  if (cur) return cur.d;
  return w.d;
}

function hideReviewAiOutput() {
  const section = document.getElementById('reviewExampleSection');
  const output = document.getElementById('reviewExampleOutput');
  const btn = document.getElementById('reviewExampleBtn');
  if (section) section.style.display = 'none';
  if (output) { output.textContent = ''; output.style.display = 'none'; }
  if (btn) btn.classList.remove('active');
}

/** 显示当前测试单词，由 session.js 在每题前调用 */
export function renderTestWord() {
  const idx = session.order[session.cursor];
  if (idx === undefined || !allWords[idx]) return;

  // 立即清空选项区，避免新单词+旧高亮的闪烁
  document.getElementById('optionsGrid').innerHTML = '';

  const word = allWords[idx];
  const wordEl = document.getElementById('wordText');
  wordEl.classList.add('updating');
  wordEl.textContent = word.w;
  updateAudioButton(document.getElementById('wordAudioBtn'), word, idx);
  requestAnimationFrame(() => wordEl.classList.remove('updating'));
  document.getElementById('pronUk').textContent = word.uk ? `英 ${word.uk}` : '';
  document.getElementById('pronUs').textContent = word.us ? `美 ${word.us}` : '';

  // 预填释义（隐藏状态），答题后直接 reveal
  const defEl = document.getElementById('defText');
  defEl.textContent = word.d;
  defEl.classList.remove('show');
  document.getElementById('nextBtn').style.display = 'none';

  // 更新题号计数器
  document.getElementById('testCounter').textContent = `第 ${session.cursor + 1} 题`;

  updateProgress();
}

/** 渲染选项按钮（由 session.js 调用） */
export function renderOptions(options) {
  const grid = document.getElementById('optionsGrid');
  const labels = ['A', 'B', 'C', 'D'];
  grid.innerHTML = options.map((opt, i) => `
    <button class="option-btn" data-index="${i}" onclick="selectAnswer(${i})">
      <span class="option-label">${labels[i]}</span>
      <span class="option-text">${escapeHtml(opt.text)}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.option-btn').forEach(b => b.disabled = false);
  document.getElementById('nextBtn').style.display = 'none';
  // 显示不认识按钮
  const dk = document.getElementById('dontKnowWrap');
  dk.style.display = 'block';
  dk.querySelector('.btn-dont-know').disabled = false;
}

/** 显示答题反馈 */
export function showAnswerFeedback(selectedIdx, correctIdx) {
  // 隐藏不认识按钮
  const dk = document.getElementById('dontKnowWrap');
  dk.style.display = 'none';

  const buttons = document.querySelectorAll('#optionsGrid .option-btn');
  buttons.forEach(b => {
    b.disabled = true;
    const idx = parseInt(b.dataset.index);
    if (idx === correctIdx) {
      b.classList.add('correct');
    } else if (idx === selectedIdx && idx !== correctIdx) {
      b.classList.add('wrong');
    }
  });
}

/** 更新进度条 */
export function updateProgress() {
  const denom = Math.max(session.maxUnknown, 1);
  const pct = Math.min((session.todayUnknown.length / denom) * 100, 100);
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    `已测 ${session.testedCount} 词 · 正确 ${session.correctCount} · 不会 ${session.todayUnknown.length} / ${session.maxUnknown}`;
}

// ===== 结果面板 =====

export function renderResult() {
  const words = session.todayUnknown;
  const isQuick = session.isQuickTest;
  document.getElementById('statTested').textContent = session.testedCount;
  document.getElementById('statCorrect').textContent = session.correctCount;
  document.getElementById('statUnknown').textContent = words.length;
  document.getElementById('resultDate').textContent = isQuick ? '' : new Date().toLocaleString('zh-CN');
  // 快速测试调整标题和按钮
  const titleEl = document.querySelector('#panel-result h2');
  if (titleEl) titleEl.textContent = isQuick ? '📝 快速测试完成（不记入记录）' : '此次测试完成';
  document.getElementById('resultDate').style.display = isQuick ? 'none' : '';
  // 非快速测试才显示"查看历史记录"
  const historyLink = document.querySelector('#panel-result .nav-links .nav-link[onclick*="history"]');
  if (historyLink) historyLink.style.display = isQuick ? 'none' : '';

  const listEl = document.getElementById('todayWordList');
  if (words.length === 0) {
    listEl.innerHTML = '<p style="text-align:center;color:var(--text-light)">全部正确！</p>';
  } else {
    listEl.innerHTML = words.map((w, i) => `
      <div class="word-list-item" onclick="this.querySelector('.wl-def').classList.toggle('show');this.classList.toggle('expanded')">
        <div class="wl-head">
          <div class="wl-main">
            <span class="wl-word">${i + 1}. ${escapeHtml(w.w)}</span>
            <span class="wl-pron">${w.uk ? '英' + escapeHtml(w.uk) : ''}${w.us ? ' 美' + escapeHtml(w.us) : ''}</span>
          </div>
          ${renderAudioButton(w)}
        </div>
        <div class="wl-def">${escapeHtml(resolveDef(w))}</div>
      </div>
    `).join('');
    preloadWordAudioList(
      words.slice(0, 20).map(toAudioItem),
      { priority: 'normal', warmMemory: true, prefetchedOnly: true }
    );
  }
}

// ===== 首页：总览统计 =====

export function renderOverallStats(historyList) {
  historyList = Array.isArray(historyList) ? historyList : [];
  const today = new Date().toLocaleDateString('zh-CN');

  if (historyList.length === 0) {
    document.getElementById('scTotalTests').textContent = '0';
    document.getElementById('scTotalWords').textContent = '0';
    document.getElementById('scWrongWords').textContent = '0';
    document.getElementById('scTodayTests').style.display = 'none';
    document.getElementById('scTodayWords').style.display = 'none';
    document.getElementById('scTodayWrong').style.display = 'none';
    renderAchievements(historyList);
    return;
  }

  const uniqueWords = new Set();
  // 累计测词：从 wordStats 统计测试过的不同单词总数（去重）
  let totalTested = 0;
  try {
    const stats = JSON.parse(localStorage.getItem('vocab_word_stats') || '{}');
    totalTested = Object.values(stats).filter(s => s && s.tested > 0).length;
  } catch {}
  // 今日统计
  let todayTests = 0, todayTested = 0;
  const todayWords = new Set();

  historyList.forEach(h => {
    (h.words || []).forEach(w => uniqueWords.add(w.w));

    const hDate = new Date(h.date).toLocaleDateString('zh-CN');
    if (hDate === today) {
      todayTests++;
      todayTested += (h.testedCount || 0);
      (h.words || []).forEach(w => todayWords.add(w.w));
    }
  });

  document.getElementById('scTotalTests').textContent = historyList.length;
  document.getElementById('scTotalWords').textContent = totalTested;
  document.getElementById('scWrongWords').textContent = uniqueWords.size;

  // 今日增量标签
  updateTodayBadge('scTodayTests', todayTests);
  updateTodayBadge('scTodayWords', todayTested);
  updateTodayBadge('scTodayWrong', todayWords.size);

  renderAchievements(historyList);
}

function updateTodayBadge(id, count) {
  const el = document.getElementById(id);
  if (count > 0) {
    el.textContent = '+' + count;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// ===== 历史面板 =====

let _historyModalList = [];

export function renderHistory(historyList) {
  const listEl = document.getElementById('historyList');
  if (!listEl) return;
  _historyModalList = Array.isArray(historyList) ? historyList : [];

  if (_historyModalList.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-light);text-align:center">暂无记录</p>';
    return;
  }

  listEl.innerHTML = _historyModalList.map((h, index) => ({ h, index })).reverse().map(({ h, index }) => {
    const d = new Date(h.date);
    const tested = h.testedCount ?? wrongCountOf(h);
    const wrong = wrongCountOf(h);
    const correct = h.correctCount ?? Math.max(tested - wrong, 0);
    return `
      <button class="history-item" type="button" onclick="openHistoryDetail(${index})">
        <span class="h-date">${escapeHtml(d.toLocaleString('zh-CN'))}</span>
        <span class="h-count">测试 ${tested} 词 · 正确 ${correct} 词 · 不会 ${wrong} 词</span>
        <span class="h-open">查看错词</span>
      </button>
    `;
  }).join('');
}

export function openHistoryModal(index) {
  const h = _historyModalList[index];
  if (!h) return;

  const titleEl = document.getElementById('historyModalTitle');
  const summaryEl = document.getElementById('historyModalSummary');
  const wordsEl = document.getElementById('historyModalWords');
  const modal = document.getElementById('historyModal');
  if (!titleEl || !summaryEl || !wordsEl || !modal) return;

  const d = new Date(h.date);
  const words = Array.isArray(h.words) ? h.words : [];
  const tested = h.testedCount ?? words.length;
  const correct = h.correctCount ?? Math.max(tested - words.length, 0);
  const wrong = words.length;
  const accuracy = tested > 0 ? Math.round((correct / tested) * 100) : 0;

  titleEl.textContent = '历史详情';
  summaryEl.innerHTML = `
    <div class="history-modal-date">${escapeHtml(d.toLocaleString('zh-CN'))}</div>
    <div class="history-modal-stats">
      <span>测试 ${tested}</span>
      <span>正确 ${correct}</span>
      <span>不会 ${wrong}</span>
      <span>正确率 ${accuracy}%</span>
    </div>
  `;

  wordsEl.innerHTML = words.length > 0
    ? words.map((w, j) => `
      <div class="history-word-item">
        <div class="history-word-row">
          <div class="history-word-main">
            <strong>${j + 1}. ${escapeHtml(w.w)}</strong>
            <span>${w.uk ? '英' + escapeHtml(w.uk) : ''}${w.us ? ' 美' + escapeHtml(w.us) : ''}</span>
          </div>
          ${renderAudioButton(w)}
        </div>
        <div class="history-word-def">${escapeHtml(resolveDef(w))}</div>
      </div>
    `).join('')
    : '<p class="history-modal-empty">本次没有错词</p>';

  modal.hidden = false;
  modal.scrollTop = 0;
  wordsEl.scrollTop = 0;
  document.body.classList.add('modal-open');

  preloadWordAudioList(
    words.slice(0, 10).map(toAudioItem),
    { priority: 'normal', warmMemory: true, prefetchedOnly: true }
  );
}

export function closeHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

window.openHistoryDetail = index => openHistoryModal(index);
window.closeHistoryModal = () => closeHistoryModal();
window.scrollHistoryBottom = () => {
  const panel = document.getElementById('panel-history');
  if (panel) {
    panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
  }
};

// ===== 复习面板 =====

export function renderReviewWord(index, total) {
  const w = session.todayUnknown[index];
  if (!w) return;
  hideReviewAiOutput();
  document.getElementById('reviewWord').textContent = w.w;
  // 复习面板里 w.idx 是当前会话错词的原始索引；fallback 由 ui-common 处理。
  const storedIdx = Number.isInteger(w?.idx) ? w.idx : (Number.isInteger(w?.wordIndex) ? w.wordIndex - 1 : undefined);
  updateAudioButton(document.getElementById('reviewAudioBtn'), w, storedIdx);
  document.getElementById('reviewPronUk').textContent = w.uk ? `英 ${w.uk}` : '';
  document.getElementById('reviewPronUs').textContent = w.us ? `美 ${w.us}` : '';
  const defEl = document.getElementById('reviewDef');
  defEl.textContent = resolveDef(w);
  defEl.classList.add('show');
  const toggleBtn = document.getElementById('reviewToggleDefBtn');
  if (toggleBtn) { toggleBtn.textContent = '👁️'; toggleBtn.title = '遮挡释义'; }
  const jumpInput = document.getElementById('reviewJumpInput');
  if (jumpInput) {
    jumpInput.value = index + 1;
    jumpInput.max = total;
  }
  document.getElementById('reviewTotal').textContent = `/ ${total}`;
  // 根据来源更新返回按钮
  const backBtn = document.getElementById('reviewBackBtn');
  if (backBtn) {
    if (window._reviewFromNotebook) {
      backBtn.textContent = '← 返回错词本';
      backBtn.onclick = () => showPanel('notebook');
    } else {
      backBtn.textContent = '← 返回本次结果';
      backBtn.onclick = () => showPanel('result');
    }
  }
  preloadWordAudio(w, storedIdx, { priority: 'high', warmMemory: true, prefetchedOnly: true });
}

// ===== 设置面板：读取用户输入 =====

export function getMaxUnknownInput() {
  return parseInt(document.getElementById('maxUnknown').value) || 20;
}

export function setMaxUnknownInput(value) {
  document.getElementById('maxUnknown').value = value;
}

// ===== 首页恢复测试横幅 =====

export function renderResumeButton(saved) {
  const banner = document.getElementById('resumeBanner');
  const info = document.getElementById('resumeInfo');
  if (!banner || !info) return;

  if (saved) {
    banner.style.display = 'flex';
    info.textContent = `已测 ${saved.testedCount || 0} 词，收集错词 ${(saved.todayUnknown || []).length} / ${saved.maxUnknown} 个`;
  } else {
    banner.style.display = 'none';
  }
}
