// ========== 错词本面板 + 首页错词卡片摘要 ==========
// 包含：日历视图、Tab 切换（日历/趋势）、错词回顾分栏、移动手柄按钮、
// 柱状图（错词率趋势）。键盘/触屏导航通过 window.* 暴露给 main.js 的 keydown
// 与 HTML inline onclick 使用。

import { allWords, session } from './state.js';
import { getAudioPath, playWordAudio } from './audio.js';
import {
  escapeHtml,
  getStoredWordIndex,
  preloadWordWindow,
  renderAudioButton,
  renderNotebookGamepadControls,
  toast,
  wrongCountOf,
} from './ui-common.js';

// ===== 模块状态 =====

let calYear, calMonth, calSelected; // 选中日期 'YYYY-MM-DD' 或 null
let _nbHistory = [];                // 缓存历史数据
let _reviewDaySessions = [];        // 当天所有测试会话
let _reviewSessionIdx = 0;          // 当前选中的会话索引
let _reviewWordIdx = -1;            // 当前选中的错词索引

// ===== 首页错词本卡片摘要 =====

export function renderHomeNotebookSummary(historyList) {
  const el = document.getElementById('homeNotebookSummary');
  const preview = document.getElementById('nbMiniPreview');
  if (!el) return;
  if (!Array.isArray(historyList) || historyList.length === 0) {
    el.textContent = '暂无测试记录';
    if (preview) preview.innerHTML = '';
    return;
  }
  // 找到 date 最大的条目作为"最近"，避免 importAll 后 date 字段非法导致末位顺序失真
  const last = historyList.reduce((acc, h) => {
    const ts = new Date(h?.date).getTime();
    if (!Number.isFinite(ts)) return acc;
    if (!acc || ts > acc.ts) return { entry: h, ts };
    return acc;
  }, null);
  const totalWrong = historyList.reduce((sum, h) => sum + wrongCountOf(h), 0);
  if (last) {
    const lastDate = new Date(last.entry.date);
    const dateStr = `${lastDate.getMonth() + 1}月${lastDate.getDate()}日`;
    el.textContent = `${historyList.length} 次测试 · ${totalWrong} 个错词 · 最近 ${dateStr}`;
  } else {
    el.textContent = `${historyList.length} 次测试 · ${totalWrong} 个错词`;
  }

  if (preview) {
    // 按 date 排序后取最近 3 条，避免 importAll 后顺序乱掉时 preview 显示错日期
    const sorted = [...historyList]
      .map(h => ({ h, ts: new Date(h?.date).getTime() }))
      .filter(x => Number.isFinite(x.ts))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 3)
      .map(x => x.h);
    preview.innerHTML = sorted.map(h => {
      const d = new Date(h.date);
      const ds = Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}/${d.getDate()}` : '?';
      return `<span style="margin:0 2px">${ds} 错${wrongCountOf(h)}词</span>`;
    }).join('<span style="color:var(--border);margin:0 2px">|</span>');
  }
}

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
  renderBarChart(historyList);
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

  // 操作按钮行：复习 / 测试 当日全部错词
  const actionsEl = document.getElementById('nbReviewActions');
  if (actionsEl) {
    actionsEl.style.display = 'flex';
    actionsEl.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="reviewDayWrongWords()">📖 复习当日错词</button>
      <button class="btn btn-accent btn-sm" onclick="testDayWrongWords()">📝 测试当日错词</button>
    `;
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
  // 旧记录释义缺失时，从当前词库回补
  if (w.d && w.d.includes('找不到解释')) {
    const cur = allWords.find(aW => aW.w === w.w);
    if (cur) w.d = cur.d;
  }

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
    <div class="rw-detail-def">${escapeHtml(w.d)}</div>
  `;
  updateNotebookMobileControls();
  preloadWordWindow(session.words, wordIdx, 3);
}

window.showWordDetail = (sessionIdx, wordIdx) => {
  showNotebookWordDetail(sessionIdx, wordIdx);
};

/** 切换测试会话 */
window.selectReviewSession = (idx) => {
  renderReviewSessionWords(idx);
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

// ===== 底部卡片：柱状图（错词率趋势） =====

function renderBarChart(historyList) {
  const canvas = document.getElementById('nbChart');
  const summary = document.getElementById('nbChartSummary');
  if (!canvas || !summary) return;

  if (historyList.length < 2) {
    summary.textContent = '至少需要 2 次测试才能显示趋势图';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // 数据：每次测试的 错词数/测词数 比值
  const data = historyList.map((h, i) => ({
    x: i + 1,
    ratio: (h.testedCount || 0) > 0 ? (h.words ? h.words.length : 0) / (h.testedCount || 1) : 0,
    wrong: h.words ? h.words.length : 0,
    tested: h.testedCount || 0,
  }));

  // 计算趋势：比较前一半和后一半的平均值
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid).reduce((s, d) => s + d.ratio, 0) / mid;
  const secondHalf = data.slice(mid).reduce((s, d) => s + d.ratio, 0) / (data.length - mid);
  const trendDown = secondHalf < firstHalf;
  const trendText = trendDown
    ? `错词率从 ${(firstHalf * 100).toFixed(0)}% 降至 ${(secondHalf * 100).toFixed(0)}%，学习效果显著！`
    : `错词率保持平稳，继续加油！`;
  summary.textContent = trendText;

  // 画布尺寸
  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const w = rect.width - 32 || 600;
  const h = 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 20, right: 16, bottom: 36, left: 44 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  const maxRatio = Math.max(...data.map(d => d.ratio), 0.1);
  const yMax = Math.min(1, Math.ceil(maxRatio * 10) / 10 + 0.1);

  const barWidth = Math.max(4, Math.min(24, pw / data.length * 0.6));
  const gap = pw / data.length;

  const yScale = v => pad.top + ph - (v / yMax) * ph;

  // 坐标轴
  const borderColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e0d5c1';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + ph);
  ctx.lineTo(pad.left + pw, pad.top + ph);
  ctx.stroke();

  // Y轴刻度 (%)
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-light').trim() || '#8b7d6b';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const v = (yMax / ySteps) * i;
    const y = yScale(v);
    ctx.fillText((v * 100).toFixed(0) + '%', pad.left - 6, y + 3);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + pw, y);
    ctx.strokeStyle = 'rgba(128,128,128,0.08)';
    ctx.stroke();
  }

  // X轴刻度（每5次标一个）
  ctx.textAlign = 'center';
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-light').trim() || '#8b7d6b';
  ctx.font = '9px sans-serif';
  const xStep = Math.max(1, Math.floor(data.length / 10));
  data.forEach((d, i) => {
    if (i % xStep === 0 || i === data.length - 1) {
      const x = pad.left + i * gap + gap / 2;
      ctx.fillText(d.x, x, pad.top + ph + 16);
    }
  });

  // 柱状图
  const barColor = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#c0392b';
  const greenColor = getComputedStyle(document.body).getPropertyValue('--green').trim() || '#27ae60';

  data.forEach((d, i) => {
    const x = pad.left + i * gap + (gap - barWidth) / 2;
    const barH = Math.max(2, (d.ratio / yMax) * ph);
    const y = pad.top + ph - barH;

    // 渐变色：根据比值从绿到红
    const ratio = d.ratio;
    if (ratio < 0.3) ctx.fillStyle = greenColor;
    else if (ratio < 0.6) ctx.fillStyle = '#e67e22';
    else ctx.fillStyle = barColor;

    ctx.fillRect(x, y, barWidth, barH);

    // 柱顶标注比值
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-light').trim() || '#8b7d6b';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((d.ratio * 100).toFixed(0) + '%', x + barWidth / 2, y - 4);
  });

  // 趋势线
  if (data.length >= 3) {
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#c0392b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const px = pad.left + i * gap + gap / 2;
      const py = yScale(d.ratio);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

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
    renderBarChart(_nbHistory);
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
