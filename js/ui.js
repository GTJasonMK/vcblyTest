// ========== UI 渲染与交互 ==========

import { PANEL, TOAST_DURATION } from './constants.js';
import { allWords, session } from './state.js';

// ===== 面板切换 =====
export function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(PANEL[name.toUpperCase()]);
  if (panel) panel.classList.add('active');
}

// ===== Toast提示 =====
let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_DURATION);
}

// ===== 测试面板：显示单词 =====
export function renderTestWord() {
  const idx = session.order[session.cursor];
  if (idx === undefined || !allWords[idx]) return;

  // 立即清空选项区，避免新单词+旧高亮的闪烁
  document.getElementById('optionsGrid').innerHTML = '';

  const word = allWords[idx];
  const wordEl = document.getElementById('wordText');
  wordEl.classList.add('updating');
  wordEl.textContent = word.w;
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
      <span class="option-text">${opt.text}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.option-btn').forEach(b => b.disabled = false);
  // 隐藏下一题按钮
  document.getElementById('nextBtn').style.display = 'none';
}

/** 显示答题反馈 */
export function showAnswerFeedback(selectedIdx, correctIdx) {
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

/** 选中正确：短暂高亮后自动下一题 */
export function flashCorrectAndAdvance(callback) {
  const defEl = document.getElementById('defText');
  defEl.classList.add('show');
  setTimeout(() => {
    defEl.classList.remove('show');
    callback();
  }, 800);
}

/** 更新进度条 */
export function updateProgress() {
  const pct = Math.min((session.todayUnknown.length / session.maxUnknown) * 100, 100);
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    `已测 ${session.testedCount} 词 · 正确 ${session.correctCount} · 不会 ${session.todayUnknown.length} / ${session.maxUnknown}`;
}

// ===== 结果面板渲染 =====
export function renderResult() {
  const words = session.todayUnknown;
  document.getElementById('statTested').textContent = session.testedCount;
  document.getElementById('statCorrect').textContent = session.correctCount;
  document.getElementById('statUnknown').textContent = words.length;
  document.getElementById('resultDate').textContent = new Date().toLocaleString('zh-CN');

  const listEl = document.getElementById('todayWordList');
  if (words.length === 0) {
    listEl.innerHTML = '<p style="text-align:center;color:var(--text-light)">全部正确！</p>';
  } else {
    listEl.innerHTML = words.map((w, i) => `
      <div class="word-list-item" onclick="this.querySelector('.wl-def').classList.toggle('show');this.classList.toggle('expanded')">
        <span class="wl-word">${i + 1}. ${w.w}</span>
        <span class="wl-pron">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</span>
        <div class="wl-def">${w.d}</div>
      </div>
    `).join('');
  }
}

// ===== 首页统计 =====
export function renderOverallStats(historyList) {
  if (historyList.length === 0) {
    document.getElementById('scTotalTests').textContent = '0';
    document.getElementById('scTotalWords').textContent = '0';
    document.getElementById('scWrongWords').textContent = '0';
    return;
  }
  const uniqueWords = new Set();
  let totalTested = 0;
  historyList.forEach(h => {
    totalTested += (h.testedCount || 0);
    h.words.forEach(w => uniqueWords.add(w.w));
  });
  document.getElementById('scTotalTests').textContent = historyList.length;
  document.getElementById('scTotalWords').textContent = totalTested;
  document.getElementById('scWrongWords').textContent = uniqueWords.size;
}

// ===== 历史面板渲染 =====
export function renderHistory(historyList) {
  const listEl = document.getElementById('historyList');

  if (historyList.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-light);text-align:center">暂无记录</p>';
    return;
  }

  listEl.innerHTML = historyList.slice().reverse().map((h, i) => {
    const d = new Date(h.date);
    return `
      <div class="history-item" onclick="this.querySelector('.history-detail').classList.toggle('show')">
        <div class="h-date">${d.toLocaleString('zh-CN')}</div>
        <div class="h-count">测试 ${h.testedCount || h.words.length} 词 · 正确 ${h.correctCount || '?'} 词 · 不会 ${h.words.length} 词</div>
        <div class="history-detail">
          ${h.words.map((w, j) => `
            <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.9rem">
              <strong>${j + 1}. ${w.w}</strong>
              <span style="color:var(--text-light);font-size:0.8rem">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</span>
              <div style="color:var(--text-light);font-size:0.85rem;white-space:pre-line">${w.d}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ===== 复习面板渲染 =====
export function renderReviewWord(index, total) {
  const w = session.todayUnknown[index];
  if (!w) return;
  document.getElementById('reviewWord').textContent = w.w;
  document.getElementById('reviewPronUk').textContent = w.uk ? `英 ${w.uk}` : '';
  document.getElementById('reviewPronUs').textContent = w.us ? `美 ${w.us}` : '';
  document.getElementById('reviewDef').textContent = w.d;
  document.getElementById('reviewIndex').textContent = `${index + 1} / ${total}`;
}

// ===== 设置面板：读取用户输入 =====
export function getMaxUnknownInput() {
  return parseInt(document.getElementById('maxUnknown').value) || 20;
}

export function setMaxUnknownInput(value) {
  document.getElementById('maxUnknown').value = value;
}

// ===== 错词本 =====

// 日历状态
let calYear, calMonth, calSelected; // 选中日期 'YYYY-MM-DD' 或 null
let _nbHistory = []; // 缓存历史数据


/** 首页错词本卡片摘要 */
export function renderHomeNotebookSummary(historyList) {
  const el = document.getElementById('homeNotebookSummary');
  const preview = document.getElementById('nbMiniPreview');
  if (!el) return;
  if (historyList.length === 0) {
    el.textContent = '暂无测试记录';
    if (preview) preview.innerHTML = '';
    return;
  }
  const last = historyList[historyList.length - 1];
  const lastDate = new Date(last.date);
  const dateStr = `${lastDate.getMonth() + 1}月${lastDate.getDate()}日`;
  const totalWrong = historyList.reduce((sum, h) => sum + h.words.length, 0);
  el.textContent = `${historyList.length} 次测试 · ${totalWrong} 个错词 · 最近 ${dateStr}`;

  if (preview) {
    const recent = historyList.slice(-3).reverse();
    preview.innerHTML = recent.map(h => {
      const d = new Date(h.date);
      const ds = `${d.getMonth() + 1}/${d.getDate()}`;
      return `<span style="margin:0 2px">${ds} 错${h.words.length}词</span>`;
    }).join('<span style="color:var(--border);margin:0 2px">|</span>');
  }
}

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

let _reviewDaySessions = [];  // 当天所有测试会话
let _reviewSessionIdx = 0;   // 当前选中的会话索引

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
    return;
  }

  const totalWrong = _reviewDaySessions.reduce((s, h) => s + (h.words ? h.words.length : 0), 0);
  titleEl.textContent = `${dateFilter} — ${_reviewDaySessions.length}次测试 · ${totalWrong}个错词`;

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
    return;
  }

  leftEl.innerHTML = session.words.map((w, j) => `
    <div class="nb-review-word" onclick="showWordDetail(${sessionIdx}, ${j})">
      <span class="rw-word">${j + 1}. ${w.w}</span>
      <span class="rw-pron">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</span>
    </div>
  `).join('');

  rightEl.innerHTML = '<p class="nb-empty-hint">点击错词查看释义</p>';
}

/** 右侧显示选中错词释义 */
window.showWordDetail = (sessionIdx, wordIdx) => {
  const session = _reviewDaySessions[sessionIdx];
  if (!session || !session.words) return;
  const w = session.words[wordIdx];
  if (!w) return;

  // 高亮选中项
  document.querySelectorAll('.nb-review-word').forEach((el, i) => {
    el.classList.toggle('selected', i === wordIdx);
  });

  const rightEl = document.getElementById('nbReviewRight');
  if (!rightEl) return;
  rightEl.innerHTML = `
    <div class="rw-detail-word">${w.w}</div>
    <div class="rw-detail-pron">${w.uk ? '英 ' + w.uk : ''}${w.us ? ' 美 ' + w.us : ''}</div>
    <div class="rw-detail-def">${w.d}</div>
  `;
};

/** 切换测试会话 */
window.selectReviewSession = (idx) => {
  renderReviewSessionWords(idx);
};

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
window.switchNbTab = (tab) => {
  const tabCal = document.getElementById('nbTabCal');
  const tabChart = document.getElementById('nbTabChart');
  const contentCal = document.getElementById('nbTabContentCal');
  const contentChart = document.getElementById('nbTabContentChart');
  if (!tabCal || !tabChart || !contentCal || !contentChart) return;

  if (tab === 'cal') {
    tabCal.classList.add('active');
    tabChart.classList.remove('active');
    contentCal.style.display = 'flex';
    contentChart.style.display = 'none';
  } else {
    tabCal.classList.remove('active');
    tabChart.classList.add('active');
    contentCal.style.display = 'none';
    contentChart.style.display = 'flex';
    // 切换时重新绘制图表以确保尺寸正确
    renderBarChart(_nbHistory);
  }
};

// ===== 内部刷新 =====
function refreshNotebook() {
  document.getElementById('nbCalRange').textContent = `${calYear}年${calMonth + 1}月`;
  renderCalendar(_nbHistory);
  renderReviewBody(_nbHistory, calSelected);
}

// ===== 恢复测试按钮 =====
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

