import { session } from './state.js';
import { preloadWordAudio, updateAudioButton } from './audio.js';
import { showPanel } from './ui-common.js';
import { resolveWordDef } from './ui-word-utils.js';

function hideReviewAiOutput() {
  const section = document.getElementById('reviewExampleSection');
  const output = document.getElementById('reviewExampleOutput');
  const btn = document.getElementById('reviewExampleBtn');
  if (section) section.style.display = 'none';
  if (output) {
    output.textContent = '';
    output.style.display = 'none';
  }
  if (btn) btn.classList.remove('active');
}

export function renderReviewWord(index, total) {
  const word = session.todayUnknown[index];
  if (!word) return;
  hideReviewAiOutput();
  document.getElementById('reviewWord').textContent = word.w;

  const storedIdx = Number.isInteger(word?.idx)
    ? word.idx
    : (Number.isInteger(word?.wordIndex) ? word.wordIndex - 1 : undefined);
  updateAudioButton(document.getElementById('reviewAudioBtn'), word, storedIdx);
  document.getElementById('reviewPronUk').textContent = word.uk ? `英 ${word.uk}` : '';
  document.getElementById('reviewPronUs').textContent = word.us ? `美 ${word.us}` : '';

  const defEl = document.getElementById('reviewDef');
  defEl.textContent = resolveWordDef(word);
  const toggleBtn = document.getElementById('reviewToggleDefBtn');
  const keepBlurred = toggleBtn && toggleBtn.dataset.blurred === 'true';
  defEl.classList.toggle('show', !keepBlurred);

  const jumpInput = document.getElementById('reviewJumpInput');
  if (jumpInput) {
    jumpInput.value = index + 1;
    jumpInput.max = total;
  }
  document.getElementById('reviewTotal').textContent = `/ ${total}`;

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
  preloadWordAudio(word, storedIdx, { priority: 'high', warmMemory: true, prefetchedOnly: true });
}
