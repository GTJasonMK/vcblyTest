import { allWords, session } from './state.js';
import { escapeHtml } from './ui-common.js';
import { updateAudioButton } from './audio.js';

export function renderTestWord() {
  const idx = session.order[session.cursor];
  if (idx === undefined || !allWords[idx]) return;

  document.getElementById('optionsGrid').innerHTML = '';

  const word = allWords[idx];
  const wordEl = document.getElementById('wordText');
  wordEl.classList.add('updating');
  wordEl.textContent = word.w;
  updateAudioButton(document.getElementById('wordAudioBtn'), word, idx);
  requestAnimationFrame(() => wordEl.classList.remove('updating'));
  document.getElementById('pronUk').textContent = word.uk ? `英 ${word.uk}` : '';
  document.getElementById('pronUs').textContent = word.us ? `美 ${word.us}` : '';

  const defEl = document.getElementById('defText');
  defEl.textContent = word.d;
  defEl.classList.remove('show');
  document.getElementById('nextBtn').style.display = 'none';
  document.getElementById('testCounter').textContent = `第 ${session.cursor + 1} 题`;

  updateProgress();
}

export function renderOptions(options) {
  const grid = document.getElementById('optionsGrid');
  const labels = ['A', 'B', 'C', 'D'];
  grid.innerHTML = options.map((opt, i) => `
    <button class="option-btn" data-index="${i}" onclick="selectAnswer(${i})">
      <span class="option-label">${labels[i]}</span>
      <span class="option-text">${escapeHtml(opt.text)}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.option-btn').forEach(button => button.disabled = false);
  document.getElementById('nextBtn').style.display = 'none';

  const dontKnow = document.getElementById('dontKnowWrap');
  dontKnow.style.display = 'block';
  dontKnow.querySelector('.btn-dont-know').disabled = false;
}

export function showAnswerFeedback(selectedIdx, correctIdx) {
  document.getElementById('dontKnowWrap').style.display = 'none';

  const buttons = document.querySelectorAll('#optionsGrid .option-btn');
  buttons.forEach(button => {
    button.disabled = true;
    const idx = parseInt(button.dataset.index, 10);
    if (idx === correctIdx) {
      button.classList.add('correct');
    } else if (idx === selectedIdx && idx !== correctIdx) {
      button.classList.add('wrong');
    }
  });
}

export function updateProgress() {
  const denom = Math.max(session.maxUnknown, 1);
  const pct = Math.min((session.todayUnknown.length / denom) * 100, 100);
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    `已测 ${session.testedCount} 词 · 正确 ${session.correctCount} · 不会 ${session.todayUnknown.length} / ${session.maxUnknown}`;
}
