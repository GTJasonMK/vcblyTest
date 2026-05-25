import { session } from './state.js';
import { escapeHtml, renderAudioButton, toAudioItem } from './ui-common.js';
import { preloadWordAudioList } from './audio.js';
import { resolveWordDef } from './ui-word-utils.js';

export function renderResult() {
  const words = session.todayUnknown;
  const isQuick = session.isQuickTest;
  document.getElementById('statTested').textContent = session.testedCount;
  document.getElementById('statCorrect').textContent = session.correctCount;
  document.getElementById('statUnknown').textContent = words.length;
  document.getElementById('resultDate').textContent = isQuick ? '' : new Date().toLocaleString('zh-CN');

  const titleEl = document.querySelector('#panel-result h2');
  if (titleEl) titleEl.textContent = isQuick ? '📝 快速测试完成（不记入记录）' : '此次测试完成';
  document.getElementById('resultDate').style.display = isQuick ? 'none' : '';

  const historyLink = document.querySelector('#panel-result .nav-links .nav-link[onclick*="history"]');
  if (historyLink) historyLink.style.display = isQuick ? 'none' : '';

  const listEl = document.getElementById('todayWordList');
  if (words.length === 0) {
    listEl.innerHTML = '<p style="text-align:center;color:var(--text-light)">全部正确！</p>';
    return;
  }

  listEl.innerHTML = words.map((word, index) => `
    <div class="word-list-item" onclick="this.querySelector('.wl-def').classList.toggle('show');this.classList.toggle('expanded')">
      <div class="wl-head">
        <div class="wl-main">
          <span class="wl-word">${index + 1}. ${escapeHtml(word.w)}</span>
          <span class="wl-pron">${word.uk ? '英' + escapeHtml(word.uk) : ''}${word.us ? ' 美' + escapeHtml(word.us) : ''}</span>
        </div>
        ${renderAudioButton(word)}
      </div>
      <div class="wl-def">${escapeHtml(resolveWordDef(word))}</div>
    </div>
  `).join('');
  preloadWordAudioList(
    words.slice(0, 20).map(toAudioItem),
    { priority: 'normal', warmMemory: true, prefetchedOnly: true }
  );
}
