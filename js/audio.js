// ========== 单词音频播放 ==========

const player = new Audio();
let activeButton = null;

function setButtonPlaying(button, isPlaying) {
  if (!button) return;
  button.classList.toggle('playing', isPlaying);
}

player.addEventListener('ended', () => {
  setButtonPlaying(activeButton, false);
  activeButton = null;
});

player.addEventListener('pause', () => {
  setButtonPlaying(activeButton, false);
});

export function getAudioPath(word, zeroBasedIndex) {
  const byIndex = window.AUDIO_MANIFEST_BY_WORD_INDEX || {};
  const byWord = window.AUDIO_MANIFEST || {};
  const spelling = typeof word === 'string' ? word : word?.w;

  if (Number.isInteger(zeroBasedIndex)) {
    const path = byIndex[String(zeroBasedIndex + 1)];
    if (path) return path;
  }

  if (spelling && byWord[spelling]) {
    return byWord[spelling];
  }

  return '';
}

export function updateAudioButton(button, word, zeroBasedIndex) {
  if (!button) return;
  const path = getAudioPath(word, zeroBasedIndex);
  button.hidden = !path;
  button.disabled = !path;
  button.dataset.audioWord = typeof word === 'string' ? word : word?.w || '';
  if (Number.isInteger(zeroBasedIndex)) {
    button.dataset.audioIndex = String(zeroBasedIndex);
  } else {
    delete button.dataset.audioIndex;
  }
  setButtonPlaying(button, false);
}

export function playWordAudio(word, zeroBasedIndex, button = null) {
  const path = getAudioPath(word, zeroBasedIndex);
  if (!path) return false;

  if (activeButton && activeButton !== button) {
    setButtonPlaying(activeButton, false);
  }

  activeButton = button;
  setButtonPlaying(activeButton, true);
  player.pause();
  player.currentTime = 0;
  player.src = path;

  const playResult = player.play();
  if (playResult && typeof playResult.catch === 'function') {
    playResult.catch(() => {
      setButtonPlaying(activeButton, false);
      activeButton = null;
    });
  }

  return true;
}

export function playWordAudioFromButton(button) {
  const word = { w: button.dataset.audioWord || '' };
  const rawIndex = button.dataset.audioIndex;
  const index = rawIndex === undefined ? undefined : Number(rawIndex);
  return playWordAudio(word, Number.isInteger(index) ? index : undefined, button);
}
