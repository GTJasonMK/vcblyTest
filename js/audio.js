// ========== 单词音频播放 ==========

import {
  cacheAudioAfterPlay,
  clearAudioCache as clearCachedAudio,
  getAudioCacheStats as readAudioCacheStats,
  getCachedAudioUrl,
  preloadAudioPath,
  registerAudioServiceWorker as registerAudioSW,
} from './audio-cache.js';

const player = new Audio();
let activeButton = null;
let activePath = '';
// 单调递增的播放 id：用于 play() Promise 的 catch 区分"我这次"与"我已被后续覆盖"，
// 修复连点同一按钮时第一个 Promise 因 pause 被 reject 而误清正在播放的按钮 UI。
let playSeq = 0;

function setButtonPlaying(button, isPlaying) {
  if (!button) return;
  button.classList.toggle('playing', isPlaying);
}

function clearActiveButton() {
  setButtonPlaying(activeButton, false);
  activeButton = null;
  activePath = '';
}

player.addEventListener('ended', clearActiveButton);
player.addEventListener('error', clearActiveButton);

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

  player.pause();
  player.src = getCachedAudioUrl(path);
  try {
    player.currentTime = 0;
  } catch {
    // New source metadata may not be ready yet; assigning src already starts at 0.
  }
  activeButton = button;
  activePath = path;
  const myPlayId = ++playSeq;
  setButtonPlaying(activeButton, true);
  cacheAudioAfterPlay(path);

  const playResult = player.play();
  if (playResult && typeof playResult.catch === 'function') {
    playResult.catch(() => {
      // 仅当这次 play 仍是"最新一次"时才清按钮；
      // 否则说明已被后续 playWordAudio 覆盖，让后续控制 UI。
      if (myPlayId === playSeq) {
        clearActiveButton();
      }
    });
  }

  return true;
}

export function playWordAudioFromButton(button) {
  if (!button) return false;
  const word = { w: button.dataset.audioWord || '' };
  const rawIndex = button.dataset.audioIndex;
  const index = rawIndex === undefined ? undefined : Number(rawIndex);
  return playWordAudio(word, Number.isInteger(index) ? index : undefined, button);
}

export function preloadWordAudio(word, zeroBasedIndex, options = {}) {
  const path = getAudioPath(word, zeroBasedIndex);
  if (!path) return Promise.resolve(false);
  return preloadAudioPath(path, options);
}

export function preloadWordAudioList(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return;
  items.forEach(item => {
    if (!item) return;
    preloadWordAudio(item.word, item.index, options);
  });
}

export function clearAudioCache() {
  return clearCachedAudio();
}

export function getAudioCacheStats() {
  return readAudioCacheStats();
}

export function registerAudioServiceWorker() {
  return registerAudioSW();
}
