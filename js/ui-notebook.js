// ========== 错词本面板 ==========
// 包含：日历视图、Tab 切换、错词回顾分栏、移动手柄按钮。
// 键盘/触屏导航通过 window.* 暴露给全局快捷键与 HTML inline onclick 使用。

import { allWords, session } from './state.js';
import { getAudioPath, playWordAudio } from './audio.js';
import {
  escapeHtml,
  getStoredWordIndex,
  preloadWordWindow,
  renderAudioButton,
  renderNotebookGamepadControls,
  toast,
} from './ui-common.js';
import { openReaderWithWords, viewReaderArticle } from './ui-reader.js';
import { getReaderArticle } from './storage.js';
import { renderNotebookTrendChart } from './ui-notebook-chart.js';
import { resolveWordDef } from './ui-word-utils.js';

// ===== 模块状态 =====

let calYear, calMonth, calSelected; // 选中日期 'YYYY-MM-DD' 或 null
let _nbHistory = [];                // 缓存历史数据
let _reviewDaySessions = [];        // 当天所有测试会话
let _reviewSessionIdx = 0;          // 当前选中的会话索引
let _reviewWordIdx = -1;            // 当前选中的错词索引

// ===== 错词本入口 =====

/** 渲染完整错词本：顶部Tab卡片 + 下方错词回顾 */
export function renderNotebook(historyList) {
  _nbHistory = historyList;

  if (calYear === undefined) {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    calSelected = null;
  }

  document.getElementById('nbCalRange').textContent = `${calYear}年${calMonth + 1}月`;

  renderCalendar(historyList);
  renderNotebookTrendChart(historyList);
  renderReviewBody(historyList, calSelected);

  // 默认显示日历tab
  switchNbTab('cal');
}

// ===== 日历 =====

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 按日期统计：每个日期下，当天测试次数、总测词数、总错词数 */
function buildDateStats(historyList) {
  const map = new Map(); // dateKey → { count, totalTested, totalWrong }
  historyList.forEach(h => {
    const d = new Date(h.date);
    const key = getDateKey(d);
    if (map.has(key)) {
      const s = map.get(key);
      s.count++;
      s.totalTested += (h.testedCount || 0);
      s.totalWrong += (h.words ? h.words.length : 0);
    } else {
      map.set(key, {
        count: 1,
        totalTested: (h.testedCount || 0),
        totalWrong: (h.words ? h.words.length : 0),
      });
    }
  });
  return map;
}

function renderCalendar(historyList) {
  const container = document.getElementById('nbCalendar');
  if (!container) return;

  const dateStats = buildDateStats(historyList);
  const today = getDateKey(new Date());

  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=周日
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];

  let html = `<div class="cal-header">
    <button class="cal-nav" onclick="calPrevMonth()">◀</button>
    <span class="cal-title">${calYear}年${calMonth + 1}月</span>
    <button class="cal-nav" onclick="calNextMonth()">▶</button></div>`;

  html += '<div class="cal-grid">';
  dayLabels.forEach(l => { html += `<div class="cal-day-label">${l}</div>`; });

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-cell other-month"><span class="cal-day"></span></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(calYear, calMonth, day);
    const key = getDateKey(date);
    const stats = dateStats.get(key);
    let cls = 'cal-cell';
    let statsHtml = '';
    if (stats) {
      cls += ' has-sessions';
      const avgTested = stats.totalTested / stats.count;
      if (avgTested >= 60) cls += ' lvl-3';
      else if (avgTested >= 35) cls += ' lvl-2';
      else cls += ' lvl-1';
      statsHtml = `<span class="cal-stats">${stats.count}次·测${stats.totalTested}·错${stats.totalWrong}</span>`;
    }
    if (key === today) cls += ' today';
    if (key === calSelected) cls += ' selected';
    html += `<div class="${cls}" onclick="calSelectDate('${key}')"><span class="cal-day">${day}</span>${statsHtml}</div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

window.calPrevMonth = () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  refreshNotebook();
};

window.calNextMonth = () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  refreshNotebook();
};

window.calSelectDate = (key) => {
  calSelected = (calSelected === key) ? null : key;
  _reviewSessionIdx = 0;  // 切换日期时重置到第1次测试
  refreshNotebook();
};

// ===== 卡片2：错词回顾（顶栏选次数 + 左右分栏） =====

function setNotebookTouchDisabled(id, disabled) {
  const el = document.getElementById(id);
  if (el) el.disabled = disabled;
}

function updateNotebookMobileControls() {
  const hasSessions = _reviewDaySessions.length > 0;
  const session = hasSessions ? _reviewDaySessions[_reviewSessionIdx] : null;
  const words = session?.words || [];
  const hasWords = words.length > 0;
  const wordIdx = _reviewWordIdx >= 0 ? _reviewWordIdx : 0;
  const currentWord = hasWords ? words[wordIdx] : null;
  const hasAudio = !!getAudioPath(currentWord, getStoredWordIndex(currentWord));

  setNotebookTouchDisabled('nbMobilePrevSessionBtn', !hasSessions || _reviewSessionIdx <= 0);
  setNotebookTouchDisabled('nbMobileNextSessionBtn', !hasSessions || _reviewSessionIdx >= _reviewDaySessions.length - 1);
  setNotebookTouchDisabled('nbMobilePrevWordBtn', !hasWords || wordIdx <= 0);
  setNotebookTouchDisabled('nbMobileNextWordBtn', !hasWords || wordIdx >= words.length - 1);
  setNotebookTouchDisabled('nbMobilePlayBtn', !hasAudio);
}

function renderReviewBody(historyList, dateFilter) {
  const titleEl = document.getElementById('nbReviewTitle');
  const tabsEl = document.getElementById('nbSessionTabs');
  const leftEl = document.getElementById('nbReviewLeft');
  const rightEl = document.getElementById('nbReviewRight');
  if (!titleEl || !tabsEl || !leftEl || !rightEl) return;

  if (!dateFilter) {
    titleEl.textContent = '📋 选择日期查看错词';
    tabsEl.innerHTML = '';
    leftEl.innerHTML = '<p class="nb-empty-hint">点击日历中的日期查看详情</p>';
    rightEl.innerHTML = '<p class="nb-empty-hint">点击错词查看释义</p>';
    const actionsEl = document.getElementById('nbReviewActions');
    if (actionsEl) actionsEl.style.display = 'none';
    _reviewDaySessions = [];
    _reviewWordIdx = -1;
    updateNotebookMobileControls();
    return;
  }

  _reviewDaySessions = historyList.filter(h => {
    return getDateKey(new Date(h.date)) === dateFilter;
  });

  if (_reviewDaySessions.length === 0) {
    titleEl.textContent = `${dateFilter} — 无测试记录`;
    tabsEl.innerHTML = '';
    leftEl.innerHTML = '<p class="nb-empty-hint">该日期暂无测试记录</p>';
    rightEl.innerHTML = '<p class="nb-empty-hint">点击错词查看释义</p>';
    const actionsEl = document.getElementById('nbReviewActions');
    if (actionsEl) actionsEl.style.display = 'none';
    _reviewWordIdx = -1;
    updateNotebookMobileControls();
    return;
  }

  const totalWrong = _reviewDaySessions.reduce((s, h) => s + (h.words ? h.words.length : 0), 0);
  titleEl.textContent = `${dateFilter} — ${_reviewDaySessions.length}次测试 · ${totalWrong}个错词`;

  // 操作按钮行：复习 / 测试 / 本场阅读 / 今日阅读
  const actionsEl = document.getElementById('nbReviewActions');
  if (actionsEl) {
    actionsEl.style.display = 'flex';
    actionsEl.style.flexDirection = 'column';
    actionsEl.style.gap = '8px';
    const daySaved = calSelected ? getReaderArticle(calSelected, '_day') : null;
    actionsEl.innerHTML = `
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" onclick="reviewDayWrongWords()">📖 复习当日错词</button>
        <button class="btn btn-accent btn-sm" onclick="testDayWrongWords()">📝 测试当日错词</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" id="nbSessionReaderBtn" onclick="openSessionReader()">📄 生成本场文章</button>
        <button class="btn btn-outline btn-sm" id="nbDayReaderBtn" onclick="openDayReader()">${daySaved ? '📚 查看今日文章' : '📚 生成今日文章'}</button>
      </div>
    `;
    _updateSessionReaderButton();
  }

  // 渲染顶栏：测试次数选择tab
  tabsEl.innerHTML = _reviewDaySessions.map((h, i) => {
    const d = new Date(h.date);
    const timeStr = d.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const wrongCount = h.words ? h.words.length : 0;
    const cls = i === _reviewSessionIdx ? 'active' : '';
    return `<button class="nb-session-tab ${cls}" onclick="selectReviewSession(${i})">
      第${i + 1}次 ${timeStr}<br><small>${wrongCount}个错词</small>
    </button>`;
  }).join('');

  // 渲染默认选中的会话
  if (_reviewSessionIdx >= _reviewDaySessions.length) _reviewSessionIdx = 0;
  renderReviewSessionWords(_reviewSessionIdx);
}

/** 渲染左侧错词列表 */
function renderReviewSessionWords(sessionIdx) {
  _reviewSessionIdx = sessionIdx;
  _reviewWordIdx = -1;
  const leftEl = document.getElementById('nbReviewLeft');
  const rightEl = document.getElementById('nbReviewRight');
  if (!leftEl || !rightEl) return;

  // 更新tab高亮
  document.querySelectorAll('.nb-session-tab').forEach((t, i) => {
    t.classList.toggle('active', i === sessionIdx);
  });

  const session = _reviewDaySessions[sessionIdx];
  if (!session || !session.words || session.words.length === 0) {
    leftEl.innerHTML = '<p class="nb-empty-hint">该次测试全部正确 ✓</p>';
    rightEl.innerHTML = '<p class="nb-empty-hint">点击错词查看释义</p>';
    updateNotebookMobileControls();
    return;
  }

  leftEl.innerHTML = session.words.map((w, j) => `
    <div class="nb-review-word" data-word-idx="${j}" onclick="showWordDetail(${sessionIdx}, ${j})">
      <span class="rw-word">${j + 1}. ${escapeHtml(w.w)}</span>
      <span class="rw-pron">${w.uk ? '英' + escapeHtml(w.uk) : ''}${w.us ? ' 美' + escapeHtml(w.us) : ''}</span>
      ${renderAudioButton(w, 'audio-btn-compact')}
    </div>
  `).join('');

  showNotebookWordDetail(sessionIdx, 0);
}

/** 右侧显示选中错词释义 */
function showNotebookWordDetail(sessionIdx, wordIdx, options = {}) {
  const session = _reviewDaySessions[sessionIdx];
  if (!session || !session.words) return;
  const w = session.words[wordIdx];
  if (!w) return;

  _reviewSessionIdx = sessionIdx;
  _reviewWordIdx = wordIdx;

  // 高亮选中项
  document.querySelectorAll('.nb-review-word').forEach((el, i) => {
    el.classList.toggle('selected', i === wordIdx);
  });
  if (options.scroll) {
    document.querySelector(`.nb-review-word[data-word-idx="${wordIdx}"]`)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }

  const rightEl = document.getElementById('nbReviewRight');
  if (!rightEl) return;
  const pronText = [
    w.uk ? `英 ${w.uk}` : '',
    w.us ? `美 ${w.us}` : '',
  ].filter(Boolean).join(' ');
  rightEl.innerHTML = `
    <div class="rw-detail-top">
      <div class="rw-detail-main">
        <div class="rw-detail-head">
          <div class="rw-detail-word">${escapeHtml(w.w)}</div>
          ${renderAudioButton(w, 'rw-detail-audio')}
        </div>
        <div class="rw-detail-pron">${escapeHtml(pronText)}</div>
      </div>
      ${renderNotebookGamepadControls()}
    </div>
    <div class="rw-detail-def">${escapeHtml(resolveWordDef(w))}</div>
  `;
  updateNotebookMobileControls();
  preloadWordWindow(session.words, wordIdx, 3);
}

window.showWordDetail = (sessionIdx, wordIdx) => {
  showNotebookWordDetail(sessionIdx, wordIdx);
};

/** 更新"本场文章"按钮文案 */
function _updateSessionReaderButton() {
  const btn = document.getElementById('nbSessionReaderBtn');
  if (!btn || !calSelected) return;
  const key = String(_reviewSessionIdx);
  const saved = getReaderArticle(calSelected, key);
  btn.textContent = saved ? '📄 查看本场文章' : '📄 生成本场文章';
}

/** 切换测试会话 */
window.selectReviewSession = (idx) => {
  renderReviewSessionWords(idx);
  _updateSessionReaderButton();
};

export function moveNotebookWord(delta) {
  const session = _reviewDaySessions[_reviewSessionIdx];
  if (!session || !session.words || session.words.length === 0) return false;

  const current = _reviewWordIdx >= 0 ? _reviewWordIdx : 0;
  const next = Math.min(Math.max(current + delta, 0), session.words.length - 1);
  showNotebookWordDetail(_reviewSessionIdx, next, { scroll: true });
  return true;
}

export function moveNotebookSession(delta) {
  if (!_reviewDaySessions.length) return false;

  const next = Math.min(Math.max(_reviewSessionIdx + delta, 0), _reviewDaySessions.length - 1);
  if (next === _reviewSessionIdx) return true;
  renderReviewSessionWords(next);
  document.querySelector(`.nb-session-tab:nth-child(${next + 1})`)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });
  return true;
}

export function selectNotebookCurrentWord() {
  const session = _reviewDaySessions[_reviewSessionIdx];
  if (!session || !session.words || session.words.length === 0) return false;
  const idx = _reviewWordIdx >= 0 ? _reviewWordIdx : 0;
  showNotebookWordDetail(_reviewSessionIdx, idx, { scroll: true });
  return true;
}

export function playNotebookSelectedAudio(triggerButton = null) {
  const session = _reviewDaySessions[_reviewSessionIdx];
  if (!session || !session.words || session.words.length === 0) return false;
  const wordIdx = _reviewWordIdx >= 0 ? _reviewWordIdx : 0;
  const word = session.words[wordIdx];
  if (!word) return false;

  const gamepadButton = document.getElementById('nbMobilePlayBtn');
  const detailButton = document.querySelector('#nbReviewRight .rw-detail-audio');
  const listButton = document.querySelector(`.nb-review-word[data-word-idx="${wordIdx}"] .audio-btn`);
  const button = triggerButton
    || (gamepadButton?.offsetParent ? gamepadButton : null)
    || detailButton
    || listButton
    || gamepadButton;
  if (!playWordAudio(word, getStoredWordIndex(word), button)) {
    toast('当前单词暂无音频');
  }
  return true;
}

window.notebookPrevWord = () => moveNotebookWord(-1);
window.notebookNextWord = () => moveNotebookWord(1);
window.notebookPrevSession = () => moveNotebookSession(-1);
window.notebookNextSession = () => moveNotebookSession(1);
window.notebookPlaySelectedAudio = (button) => playNotebookSelectedAudio(button);

// ===== Tab 切换 =====
function switchNbTab(tab) {
  const tabs = ['nbTabCal', 'nbTabChart'];
  const contents = ['nbTabContentCal', 'nbTabContentChart'];

  tabs.forEach(id => document.getElementById(id)?.classList.remove('active'));
  contents.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (tab === 'cal') {
    document.getElementById('nbTabCal').classList.add('active');
    document.getElementById('nbTabContentCal').style.display = 'flex';
  } else if (tab === 'chart') {
    document.getElementById('nbTabChart').classList.add('active');
    document.getElementById('nbTabContentChart').style.display = 'flex';
    renderNotebookTrendChart(_nbHistory);
  }
}
window.switchNbTab = switchNbTab;

// ===== 内部刷新 =====
function refreshNotebook() {
  document.getElementById('nbCalRange').textContent = `${calYear}年${calMonth + 1}月`;
  renderCalendar(_nbHistory);
  renderReviewBody(_nbHistory, calSelected);
}

// ===== 复习/测试当日全部错词 =====

/** 收集选定日期下所有会话的全部错词 */
function collectDayWrongWords() {
  if (!calSelected) return [];
  const words = [];
  for (const h of _nbHistory) {
    if (getDateKey(new Date(h.date)) !== calSelected) continue;
    if (Array.isArray(h.words)) {
      for (const w of h.words) {
        // 去重（同一单词在同一天不同会话中可能出现）
        if (!words.find(existing => existing.w === w.w)) {
          words.push({ ...w });
        }
      }
    }
  }
  return words;
}

/** 复习当日错词（在复习面板中逐词查看） */
window.reviewDayWrongWords = () => {
  const words = collectDayWrongWords();
  if (words.length === 0) { toast('该日没有错词'); return; }
  session.todayUnknown = words;
  // 标记复习来源为错词本，渲染返回按钮时使用
  window._reviewFromNotebook = true;
  import('./session.js').then(({ startReview }) => startReview());
};

/** 测试当日错词（以随机顺序出题） */
window.testDayWrongWords = () => {
  const words = collectDayWrongWords();
  if (words.length === 0) { toast('该日没有错词'); return; }
  // startFilteredSession 会 clearSession()，若存在未完成测试需先确认
  if (session.active && !confirm('当前有未完成的测试，开始测试当日错词会丢弃该进度。确定继续吗？')) {
    return;
  }
  const indices = [];
  for (const w of words) {
    // w.idx 是原始词库索引；即使 w 没有 idx，从 allWords 反查
    if (Number.isInteger(w.idx)) {
      indices.push(w.idx);
    } else {
      const found = allWords.findIndex(aW => aW.w === w.w);
      if (found >= 0) indices.push(found);
    }
  }
  import('./session.js').then(({ startFilteredSession }) => startFilteredSession(indices));
};

/** 生成本场文章：用当前选中场次的全部错词 */
window.openSessionReader = () => {
  if (_reviewSessionIdx < 0 || _reviewSessionIdx >= _reviewDaySessions.length) {
    toast('请先选择测试场次');
    return;
  }
  const words = _reviewDaySessions[_reviewSessionIdx].words || [];
  if (words.length === 0) { toast('当前场次没有错词'); return; }

  // 检查是否已有保存的文章
  const dateKey = calSelected;
  const sessionKey = String(_reviewSessionIdx);
  const existing = getReaderArticle(dateKey, sessionKey);
  if (existing) {
    viewReaderArticle(dateKey, sessionKey);
  } else {
    openReaderWithWords(words, { dateKey, sessionKey });
  }
};

/** 生成今日文章：用当日所有场次的错词（去重） */
window.openDayReader = () => {
  const words = collectDayWrongWords();
  if (words.length === 0) { toast('当天没有错词'); return; }

  const dateKey = calSelected;
  const sessionKey = '_day';
  const existing = getReaderArticle(dateKey, sessionKey);
  if (existing) {
    viewReaderArticle(dateKey, sessionKey);
  } else {
    openReaderWithWords(words, { dateKey, sessionKey });
  }
};
