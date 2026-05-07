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

  const word = allWords[idx];
  document.getElementById('wordText').textContent = word.w;
  document.getElementById('pronUk').textContent = word.uk ? `英 ${word.uk}` : '';
  document.getElementById('pronUs').textContent = word.us ? `美 ${word.us}` : '';

  // 隐藏上一题的释义和反馈
  const defEl = document.getElementById('defText');
  defEl.classList.remove('show');
  document.getElementById('nextBtn').style.display = 'none';

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
  // 启用所有选项
  grid.querySelectorAll('.option-btn').forEach(b => b.disabled = false);
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
  const el = document.getElementById('overallStats');
  if (!el) return;

  if (historyList.length === 0) {
    el.textContent = '';
    return;
  }
  const uniqueWords = new Set();
  let totalTested = 0;
  historyList.forEach(h => {
    totalTested += (h.testedCount || 0);
    h.words.forEach(w => uniqueWords.add(w.w));
  });
  el.innerHTML = `已进行 <strong>${historyList.length}</strong> 次测试 · `
    + `累计测试 <strong>${totalTested}</strong> 词 · `
    + `累计收录生词 <strong>${uniqueWords.size}</strong> 个（去重）`;
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

/** 首页错词本卡片摘要 */
export function renderHomeNotebookSummary(historyList) {
  const el = document.getElementById('homeNotebookSummary');
  if (!el) return;
  if (historyList.length === 0) {
    el.textContent = '暂无测试记录';
    return;
  }
  const last = historyList[historyList.length - 1];
  const lastDate = new Date(last.date);
  const dateStr = `${lastDate.getMonth() + 1}月${lastDate.getDate()}日`;
  const totalWrong = historyList.reduce((sum, h) => sum + h.words.length, 0);
  el.textContent = `共 ${historyList.length} 次测试 · ${totalWrong} 个错词 · 最近 ${dateStr}`;
}

/** 渲染完整错词本：日历 + 图表 + 会话列表 */
export function renderNotebook(historyList) {
  _nbHistory = historyList;

  // 初始化日历状态（仅在初次进入时）
  if (calYear === undefined) {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    calSelected = null;
  }

  renderCalendar(historyList);
  renderChart(historyList);
  renderNotebookSessions(historyList, calSelected);
}

// ===== 日历 =====

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 按日期统计会话数与平均测试词数 */
function buildDateStats(historyList) {
  const map = new Map(); // dateKey → {count, totalTested}
  historyList.forEach(h => {
    const d = new Date(h.date);
    const key = getDateKey(d);
    if (map.has(key)) {
      const s = map.get(key);
      s.count++;
      s.totalTested += (h.testedCount || 0);
    } else {
      map.set(key, { count: 1, totalTested: (h.testedCount || 0) });
    }
  });
  return map;
}

function renderCalendar(historyList) {
  const container = document.getElementById('nbCalendar');
  if (!container) return;

  const dateStats = buildDateStats(historyList);
  const today = getDateKey(new Date());

  const title = `${calYear}年${calMonth + 1}月`;
  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=周日
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];

  let html = `<div class="cal-header">
    <button class="cal-nav" onclick="calPrevMonth()">◀</button>
    <span class="cal-title">${title}</span>
    <button class="cal-nav" onclick="calNextMonth()">▶</button></div>`;

  html += '<div class="cal-grid">';
  dayLabels.forEach(l => { html += `<div class="cal-day-label">${l}</div>`; });

  // 填充上月末的空白
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-cell other-month"></div>';
  }

  // 本月日期
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(calYear, calMonth, day);
    const key = getDateKey(date);
    const stats = dateStats.get(key);
    let cls = 'cal-cell';
    if (stats) {
      cls += ' has-sessions';
      if (stats.totalTested / stats.count >= 60) cls += ' lvl-3';
      else if (stats.totalTested / stats.count >= 35) cls += ' lvl-2';
      else cls += ' lvl-1';
    }
    if (key === today) cls += ' today';
    if (key === calSelected) cls += ' selected';
    html += `<div class="${cls}" onclick="calSelectDate('${key}')">${day}</div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

// 日历操作（挂 window 供 onclick 调用）
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
  refreshNotebook();
};

function refreshNotebook() {
  renderCalendar(_nbHistory);
  renderNotebookSessions(_nbHistory, calSelected);
}

// 缓存当前错词本所用的历史数据
let _nbHistory = [];

// ===== 折线图 =====
function renderChart(historyList) {
  const section = document.getElementById('nbChartSection');
  const canvas = document.getElementById('nbChart');
  const summary = document.getElementById('nbChartSummary');
  if (!section || !canvas || !summary) return;

  if (historyList.length < 2) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const data = historyList.map((h, i) => ({
    x: i + 1,
    y: h.testedCount || 0,
  }));

  const avg = Math.round(data.reduce((s, d) => s + d.y, 0) / data.length);
  summary.textContent = `平均每轮测试 ${avg} 词才能集满错词上限（越高说明认识的词越多）`;

  // 画布尺寸
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 560;
  const h = 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 16, right: 20, bottom: 28, left: 44 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  const maxY = Math.max(...data.map(d => d.y), 10);
  const yRange = Math.ceil(maxY / 20) * 20;

  const xScale = i => pad.left + (i / (data.length - 1)) * pw;
  const yScale = v => pad.top + ph - (v / yRange) * ph;

  // 坐标轴
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e0d5c1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + ph);
  ctx.lineTo(pad.left + pw, pad.top + ph);
  ctx.stroke();

  // Y轴刻度
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-light').trim() || '#8b7d6b';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let v = 0; v <= yRange; v += Math.ceil(yRange / 4)) {
    const y = yScale(v);
    ctx.fillText(v, pad.left - 6, y + 3);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + pw, y);
    ctx.strokeStyle = 'rgba(128,128,128,0.1)';
    ctx.stroke();
  }

  // X轴刻度
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(data.length / 8));
  data.forEach((d, i) => {
    if (i % step === 0 || i === data.length - 1) {
      ctx.fillText(d.x, xScale(i), pad.top + ph + 16);
    }
  });

  // 折线
  const lineColor = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#c0392b';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const px = xScale(i);
    const py = yScale(d.y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // 数据点
  ctx.fillStyle = lineColor;
  data.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(xScale(i), yScale(d.y), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // 平均线
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--green').trim() || '#27ae60';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, yScale(avg));
  ctx.lineTo(pad.left + pw, yScale(avg));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = ctx.strokeStyle;
  ctx.textAlign = 'left';
  ctx.fillText(`平均 ${avg}`, pad.left + pw - 50, yScale(avg) - 6);
}

// ===== 按日期筛选的错词会话列表 =====
function renderNotebookSessions(historyList, dateFilter) {
  const container = document.getElementById('nbSessions');
  if (!container) return;

  let filtered = [...historyList].reverse();
  if (dateFilter) {
    filtered = filtered.filter(h => {
      const d = new Date(h.date);
      return getDateKey(d) === dateFilter;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:var(--text-light);text-align:center">该日期暂无测试记录</p>';
    return;
  }

  const title = dateFilter
    ? `${dateFilter} 测试记录（${filtered.length} 次）`
    : `全部测试记录（${filtered.length} 次）`;

  let html = `<h4 style="text-align:left;margin:0 0 10px">${title}</h4>`;

  html += filtered.map(h => {
    const d = new Date(h.date);
    const dateStr = d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];

    if (!h.words || h.words.length === 0) {
      return `<div class="nb-session">
        <div class="nb-session-header">
          <span class="nb-session-date">${dateStr} 周${dayOfWeek}</span>
          <span class="nb-session-stat">测试 ${h.testedCount || 0} 词 · 全部正确 ✓</span>
        </div></div>`;
    }

    return `<div class="nb-session">
      <div class="nb-session-header">
        <span class="nb-session-date">${dateStr} 周${dayOfWeek}</span>
        <span class="nb-session-stat">测试 ${h.testedCount || '?'} 词 · 错 ${h.words.length} 词</span>
      </div>
      <div class="nb-word-list">
        ${h.words.map((w, j) => `
          <div class="nb-word-item" onclick="this.classList.toggle('expanded')">
            <span class="nb-word-idx">${j + 1}.</span>
            <span class="nb-word-text">${w.w}</span>
            <span class="nb-word-pron">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</span>
            <div class="nb-word-def">${w.d}</div>
          </div>`).join('')}
      </div></div>`;
  }).join('');

  container.innerHTML = html;
}

// ===== 恢复测试按钮 =====
export function renderResumeButton(saved) {
  const area = document.getElementById('resumeArea');
  const info = document.getElementById('resumeInfo');
  if (!area || !info) return;

  if (saved) {
    area.style.display = 'block';
    info.textContent = `已测 ${saved.testedCount || 0} 词，收集错词 ${(saved.todayUnknown || []).length} / ${saved.maxUnknown} 个`;
  } else {
    area.style.display = 'none';
  }
}
