import { allWords } from './state.js';
import { escapeHtml } from './ui-common.js';

let initialized = false;
let matches = [];
let selectedIdx = -1;

function closeResults() {
  const results = document.getElementById('homeSearchResults');
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
  matches = [];
  selectedIdx = -1;
}

function doSearch(query) {
  const results = document.getElementById('homeSearchResults');
  if (!results || !allWords.length) return;
  const q = query.trim().toLowerCase();
  if (!q) {
    closeResults();
    return;
  }

  const isChinese = /[\u4e00-\u9fff]/.test(q);
  matches = [];
  for (const w of allWords) {
    if (isChinese) {
      if (w.d && w.d.includes(q)) matches.push(w);
    } else if (w.w.toLowerCase().includes(q)) {
      matches.push(w);
    }
    if (matches.length >= 30) break;
  }
  selectedIdx = -1;

  if (matches.length === 0) {
    results.innerHTML = '<div class="home-search-empty">未找到匹配的单词</div>';
  } else {
    results.innerHTML = matches.map((w, i) =>
      `<div class="home-search-item" data-idx="${i}" onmousedown="event.preventDefault();selectSearchResult(${i})">
        <div class="hsi-word">${escapeHtml(w.w)}</div>
        <div class="hsi-def">${escapeHtml(w.d)}</div>
      </div>`
    ).join('');
  }
  results.style.display = 'block';
}

function selectSearchResult(idx) {
  const w = matches[idx];
  if (!w) return;
  const input = document.getElementById('homeSearchInput');
  if (input) {
    input.value = `${w.w}  ${w.uk ? '英' + w.uk + ' ' : ''}${w.us ? '美' + w.us : ''}`;
  }
  const results = document.getElementById('homeSearchResults');
  if (results) {
    results.innerHTML = `<div class="home-search-item" style="cursor:default">
      <div class="hsi-word">${escapeHtml(w.w)}</div>
      <div style="font-size:0.78rem;color:var(--text-muted);margin:2px 0">
        ${w.uk ? '英' + escapeHtml(w.uk) + ' ' : ''}${w.us ? '美' + escapeHtml(w.us) : ''}
      </div>
      <div class="hsi-def" style="-webkit-line-clamp:unset">${escapeHtml(w.d)}</div>
    </div>`;
  }
  matches = [];
  selectedIdx = -1;
}

function handleSearchKeydown(e) {
  const results = document.getElementById('homeSearchResults');
  if (!results || results.style.display === 'none') return;
  const input = document.getElementById('homeSearchInput');
  if (!input || document.activeElement !== input) return;

  const items = results.querySelectorAll('.home-search-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx = Math.max(selectedIdx - 1, 0);
  } else if (e.key === 'Enter' && selectedIdx >= 0) {
    e.preventDefault();
    selectSearchResult(selectedIdx);
    return;
  } else if (e.key === 'Escape') {
    closeResults();
    input.blur();
    return;
  } else {
    return;
  }
  items.forEach((el, i) => el.classList.toggle('active', i === selectedIdx));
}

function handleDocumentClick(e) {
  const search = document.getElementById('homeSearch');
  if (search && !search.contains(e.target)) closeResults();
}

export function initHomeSearch() {
  if (initialized) return;
  initialized = true;
  window.handleSearchInput = value => doSearch(value);
  window.selectSearchResult = idx => selectSearchResult(idx);
  document.addEventListener('keydown', handleSearchKeydown);
  document.addEventListener('click', handleDocumentClick);
}
