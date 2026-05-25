import {
  escapeHtml,
  renderAudioButton,
  toAudioItem,
  wrongCountOf,
} from './ui-common.js';
import { preloadWordAudioList } from './audio.js';
import { resolveWordDef } from './ui-word-utils.js';

let historyModalList = [];

export function renderHistory(historyList) {
  const listEl = document.getElementById('historyList');
  if (!listEl) return;
  historyModalList = Array.isArray(historyList) ? historyList : [];

  if (historyModalList.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-light);text-align:center">暂无记录</p>';
    return;
  }

  listEl.innerHTML = historyModalList.map((h, index) => ({ h, index })).reverse().map(({ h, index }) => {
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
  const h = historyModalList[index];
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
    ? words.map((word, index) => `
      <div class="history-word-item">
        <div class="history-word-row">
          <div class="history-word-main">
            <strong>${index + 1}. ${escapeHtml(word.w)}</strong>
            <span>${word.uk ? '英' + escapeHtml(word.uk) : ''}${word.us ? ' 美' + escapeHtml(word.us) : ''}</span>
          </div>
          ${renderAudioButton(word)}
        </div>
        <div class="history-word-def">${escapeHtml(resolveWordDef(word))}</div>
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
