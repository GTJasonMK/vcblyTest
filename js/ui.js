// ========== UI 渲染与交互 ==========

import { PANEL, TOAST_DURATION } from './constants.js';
import { allWords, session } from './state.js';
import { getAudioPath, playWordAudio, updateAudioButton } from './audio.js';
import { loadWordStats } from './storage.js';

const AUDIO_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
    <path d="M16 9.5a4 4 0 0 1 0 5"></path>
    <path d="M18.5 7a7 7 0 0 1 0 10"></path>
  </svg>
`;

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function escapeHtml(value) {
  return escapeAttr(value);
}

function getStoredWordIndex(word) {
  if (Number.isInteger(word?.idx)) return word.idx;
  if (Number.isInteger(word?.wordIndex)) return word.wordIndex - 1;
  return undefined;
}

function renderAudioButton(word, extraClass = '') {
  const idx = getStoredWordIndex(word);
  if (!getAudioPath(word, idx)) return '';

  const indexAttr = Number.isInteger(idx) ? ` data-audio-index="${idx}"` : '';
  const spelling = word?.w || '';
  return `
    <button class="audio-btn audio-btn-inline ${extraClass}" onclick="event.stopPropagation();playWordAudioFromButton(this)" data-audio-word="${escapeAttr(spelling)}"${indexAttr} title="播放发音" aria-label="播放 ${escapeAttr(spelling)} 发音">
      ${AUDIO_ICON}
    </button>
  `;
}

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
  updateAudioButton(document.getElementById('wordAudioBtn'), word, idx);
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
  document.getElementById('nextBtn').style.display = 'none';
  // 显示不认识按钮
  const dk = document.getElementById('dontKnowWrap');
  dk.style.display = 'block';
  dk.querySelector('.btn-dont-know').disabled = false;
}

/** 显示答题反馈 */
export function showAnswerFeedback(selectedIdx, correctIdx) {
  // 隐藏不认识按钮
  const dk = document.getElementById('dontKnowWrap');
  dk.style.display = 'none';

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
        <div class="wl-head">
          <div class="wl-main">
            <span class="wl-word">${i + 1}. ${w.w}</span>
            <span class="wl-pron">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</span>
          </div>
          ${renderAudioButton(w)}
        </div>
        <div class="wl-def">${w.d}</div>
      </div>
    `).join('');
  }
}

// ===== 首页统计 =====
export function renderOverallStats(historyList) {
  historyList = Array.isArray(historyList) ? historyList : [];
  const today = new Date().toLocaleDateString('zh-CN');

  if (historyList.length === 0) {
    document.getElementById('scTotalTests').textContent = '0';
    document.getElementById('scTotalWords').textContent = '0';
    document.getElementById('scWrongWords').textContent = '0';
    document.getElementById('scTodayTests').style.display = 'none';
    document.getElementById('scTodayWords').style.display = 'none';
    document.getElementById('scTodayWrong').style.display = 'none';
    renderAchievements(historyList);
    return;
  }

  const uniqueWords = new Set();
  let totalTested = 0;
  // 今日统计
  let todayTests = 0, todayTested = 0;
  const todayWords = new Set();

  historyList.forEach(h => {
    totalTested += (h.testedCount || 0);
    (h.words || []).forEach(w => uniqueWords.add(w.w));

    const hDate = new Date(h.date).toLocaleDateString('zh-CN');
    if (hDate === today) {
      todayTests++;
      todayTested += (h.testedCount || 0);
      (h.words || []).forEach(w => todayWords.add(w.w));
    }
  });

  document.getElementById('scTotalTests').textContent = historyList.length;
  document.getElementById('scTotalWords').textContent = totalTested;
  document.getElementById('scWrongWords').textContent = uniqueWords.size;

  // 今日增量标签
  updateTodayBadge('scTodayTests', todayTests);
  updateTodayBadge('scTodayWords', todayTested);
  updateTodayBadge('scTodayWrong', todayWords.size);

  renderAchievements(historyList);
}

function updateTodayBadge(id, count) {
  const el = document.getElementById(id);
  if (count > 0) {
    el.textContent = '+' + count;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function getHistoryAchievementMetrics(historyList) {
  const wrongWords = new Set();
  let totalTested = 0;
  let perfectSessions = 0;
  let bestAccuracy = 0;

  historyList.forEach(h => {
    const tested = h.testedCount || 0;
    const wrong = (h.words || []).length;
    const correct = Number.isFinite(h.correctCount) ? h.correctCount : Math.max(0, tested - wrong);
    totalTested += tested;
    (h.words || []).forEach(w => wrongWords.add(w.w));

    if (tested > 0) {
      const accuracy = correct / tested;
      bestAccuracy = Math.max(bestAccuracy, accuracy);
      if (wrong === 0) perfectSessions++;
    }
  });

  return {
    totalTests: historyList.length,
    totalTested,
    wrongWords: wrongWords.size,
    perfectSessions,
    bestAccuracy,
  };
}

function getWordAchievementMetrics(historyList = []) {
  // 直接从 localStorage 读取词级统计
  let stats;
  try {
    const raw = localStorage.getItem('vocab_word_stats');
    stats = raw ? JSON.parse(raw) : {};
  } catch { stats = {}; }
  const total = allWords.length;
  let mastered = 0, perfect = 0, revenge = 0;

  // 用 Object.values 遍历所有已记录的词级统计
  const entries = Object.values(stats).filter(s => s && s.tested > 0);
  let explored = entries.length;

  for (const s of entries) {
    if (s.tested >= 3) {
      const rate = s.wrong / s.tested;
      if (rate <= 0.2) mastered++;
      if (s.wrong === 0) perfect++;
      if (s.wrong > 0 && rate <= 0.5) revenge++;
    }
  }

  // 回退：wordStats 为空时，从 history 估算 explored（至少测过的错词数）
  if (explored === 0 && historyList.length > 0) {
    const histWords = new Set();
    historyList.forEach(h => (h.words || []).forEach(w => histWords.add(w.w || w.idx)));
    explored = histWords.size;
  }

  return {
    total,
    explored,
    exploredPct: total > 0 ? explored / total * 100 : 0,
    mastered,
    perfect,
    revenge,
  };
}

const TITLE_LEVELS = [
  { name: '词海新兵', points: 0 },
  { name: '记忆学徒', points: 50 },
  { name: '词汇行者', points: 150 },
  { name: '生词猎手', points: 320 },
  { name: '词库专家', points: 600 },
  { name: '红宝书征服者', points: 950 },
  { name: '词汇宗师', points: 1400 },
];

const BADGE_DEFINITIONS = [
  {
    id: 'practice',
    mark: '练',
    name: '练习之路',
    desc: '完成测试次数',
    unit: '次',
    value: metrics => metrics.history.totalTests,
    tiers: [
      { name: '青铜', className: 'bronze', target: 1, points: 10 },
      { name: '白银', className: 'silver', target: 10, points: 25 },
      { name: '黄金', className: 'gold', target: 30, points: 50 },
      { name: '钻石', className: 'diamond', target: 60, points: 90 },
    ],
  },
  {
    id: 'volume',
    mark: '量',
    name: '词量积累',
    desc: '累计完成测词',
    unit: '词',
    value: metrics => metrics.history.totalTested,
    tiers: [
      { name: '青铜', className: 'bronze', target: 100, points: 10 },
      { name: '白银', className: 'silver', target: 500, points: 30 },
      { name: '黄金', className: 'gold', target: 1500, points: 70 },
      { name: '钻石', className: 'diamond', target: 3000, points: 120 },
    ],
  },
  {
    id: 'explore',
    mark: '探',
    name: '词库探索',
    desc: '至少测试过的不同单词',
    unit: '词',
    value: metrics => metrics.words.explored,
    tiers: [
      { name: '青铜', className: 'bronze', target: 100, points: 10 },
      { name: '白银', className: 'silver', target: 500, points: 35 },
      { name: '黄金', className: 'gold', target: 1500, points: 80 },
      { name: '钻石', className: 'diamond', target: metrics => Math.max(metrics.words.total, 1), points: 150 },
    ],
  },
  {
    id: 'master',
    mark: '熟',
    name: '稳定掌握',
    desc: '测试至少 3 次且错误率不超过 20%',
    unit: '词',
    value: metrics => metrics.words.mastered,
    tiers: [
      { name: '青铜', className: 'bronze', target: 50, points: 15 },
      { name: '白银', className: 'silver', target: 200, points: 45 },
      { name: '黄金', className: 'gold', target: 500, points: 90 },
      { name: '钻石', className: 'diamond', target: 1000, points: 160 },
    ],
  },
  {
    id: 'perfect',
    mark: '准',
    name: '完美记忆',
    desc: '测试至少 3 次且从未答错',
    unit: '词',
    value: metrics => metrics.words.perfect,
    tiers: [
      { name: '青铜', className: 'bronze', target: 20, points: 15 },
      { name: '白银', className: 'silver', target: 80, points: 45 },
      { name: '黄金', className: 'gold', target: 200, points: 90 },
      { name: '钻石', className: 'diamond', target: 500, points: 160 },
    ],
  },
  {
    id: 'revenge',
    mark: '复',
    name: '错词复仇',
    desc: '曾经答错但错误率已压到 50% 以下',
    unit: '词',
    value: metrics => metrics.words.revenge,
    tiers: [
      { name: '青铜', className: 'bronze', target: 20, points: 15 },
      { name: '白银', className: 'silver', target: 80, points: 45 },
      { name: '黄金', className: 'gold', target: 200, points: 90 },
      { name: '钻石', className: 'diamond', target: 500, points: 160 },
    ],
  },
  {
    id: 'accuracy',
    mark: '高',
    name: '高分场次',
    desc: '单次测试最高正确率',
    unit: '%',
    value: metrics => metrics.history.bestAccuracy * 100,
    tiers: [
      { name: '青铜', className: 'bronze', target: 70, points: 10 },
      { name: '白银', className: 'silver', target: 80, points: 25 },
      { name: '黄金', className: 'gold', target: 90, points: 50 },
      { name: '钻石', className: 'diamond', target: 100, points: 100 },
    ],
  },
  {
    id: 'clean',
    mark: '全',
    name: '全对场次',
    desc: '没有错词的测试次数',
    unit: '次',
    value: metrics => metrics.history.perfectSessions,
    tiers: [
      { name: '青铜', className: 'bronze', target: 1, points: 10 },
      { name: '白银', className: 'silver', target: 5, points: 25 },
      { name: '黄金', className: 'gold', target: 15, points: 50 },
      { name: '钻石', className: 'diamond', target: 30, points: 100 },
    ],
  },
  {
    id: 'archive',
    mark: '档',
    name: '生词档案',
    desc: '收录过的不同生词',
    unit: '词',
    value: metrics => metrics.history.wrongWords,
    tiers: [
      { name: '青铜', className: 'bronze', target: 30, points: 10 },
      { name: '白银', className: 'silver', target: 100, points: 25 },
      { name: '黄金', className: 'gold', target: 300, points: 50 },
      { name: '钻石', className: 'diamond', target: 600, points: 90 },
    ],
  },
];

function clamp01(value) {
  return Math.max(0, Math.min(value, 1));
}

function resolveTarget(target, metrics) {
  return Math.max(1, typeof target === 'function' ? target(metrics) : target);
}

function formatMetric(value, unit) {
  const normalized = unit === '%' ? Math.round(value) : Math.floor(value);
  return `${normalized}${unit}`;
}

function getAchievementMetrics(historyList) {
  return {
    history: getHistoryAchievementMetrics(historyList),
    words: getWordAchievementMetrics(historyList),
  };
}

function evaluateBadges(metrics) {
  return BADGE_DEFINITIONS.map(def => {
    const value = Math.max(0, def.value(metrics) || 0);
    const tiers = def.tiers.map(tier => ({
      ...tier,
      target: resolveTarget(tier.target, metrics),
      unlocked: value >= resolveTarget(tier.target, metrics),
    }));
    const unlockedTiers = tiers.filter(tier => tier.unlocked);
    const currentTier = unlockedTiers.length > 0 ? unlockedTiers[unlockedTiers.length - 1] : null;
    const nextTier = tiers.find(tier => !tier.unlocked) || null;
    const points = unlockedTiers.reduce((sum, tier) => sum + tier.points, 0);
    const progressTarget = nextTier ? nextTier.target : tiers[tiers.length - 1].target;

    return {
      ...def,
      value,
      tiers,
      unlockedTiers,
      currentTier,
      nextTier,
      points,
      progress: nextTier ? clamp01(value / progressTarget) : 1,
      valueText: formatMetric(value, def.unit),
    };
  });
}

function getTitleState(points) {
  let current = TITLE_LEVELS[0];
  for (const level of TITLE_LEVELS) {
    if (points >= level.points) current = level;
  }
  const next = TITLE_LEVELS.find(level => level.points > points) || null;
  const progress = next
    ? clamp01((points - current.points) / (next.points - current.points))
    : 1;

  return {
    current,
    next,
    progress,
    remaining: next ? next.points - points : 0,
  };
}

function getBadgeSystem(historyList = []) {
  const metrics = getAchievementMetrics(Array.isArray(historyList) ? historyList : []);
  const badges = evaluateBadges(metrics);
  const totalPoints = badges.reduce((sum, badge) => sum + badge.points, 0);
  const unlockedBadgeCount = badges.filter(badge => badge.currentTier).length;
  const unlockedTierCount = badges.reduce((sum, badge) => sum + badge.unlockedTiers.length, 0);
  const nextBadge = badges
    .filter(badge => badge.nextTier)
    .sort((a, b) => b.progress - a.progress)[0] || null;

  return {
    metrics,
    badges,
    totalPoints,
    title: getTitleState(totalPoints),
    unlockedBadgeCount,
    unlockedTierCount,
    nextBadge,
  };
}

function updateText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateProgressWidth(id, progress) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.round(clamp01(progress) * 100)}%`;
}

function renderAchievementTitleSummary(system) {
  updateText('achCurrentTitle', system.title.current.name);
  updateText('achScore', system.totalPoints);
  updateText('achTitleNext', system.title.next
    ? `距「${system.title.next.name}」还差 ${system.title.remaining} 成就值`
    : '最高称号已解锁');
  updateProgressWidth('achTitleProgress', system.title.progress);
  updateText('achMastered', system.metrics.words.mastered);
  updateText('achPerfect', system.metrics.words.perfect);
  updateText('achRevenge', system.metrics.words.revenge);
  updateText('achExplored', system.metrics.words.total > 0
    ? `${Math.round(system.metrics.words.exploredPct)}%`
    : '0%');
}

function renderTierChips(badge) {
  return badge.tiers.map(tier => {
    const state = tier.unlocked ? 'unlocked' : 'locked';
    const current = badge.currentTier && badge.currentTier.name === tier.name ? 'current' : '';
    return `<span class="tier-chip ${tier.className} ${state} ${current}">
      ${escapeAttr(tier.name)}<small>+${tier.points}</small>
    </span>`;
  }).join('');
}

function renderBadgeCard(badge) {
  const collected = Boolean(badge.currentTier);
  const nextText = badge.nextTier
    ? `下一等级：${badge.nextTier.name} · ${badge.valueText} / ${formatMetric(badge.nextTier.target, badge.unit)}`
    : '全部等级已完成';

  return `
    <div class="badge-card ${collected ? 'collected' : 'locked'}">
      <div class="badge-card-head">
        <div class="badge-mark">${escapeAttr(badge.mark)}</div>
        <div class="badge-main">
          <div class="badge-name">${escapeAttr(badge.name)}</div>
          <div class="badge-desc">${escapeAttr(badge.desc)}</div>
        </div>
        <div class="badge-points">+${badge.points}</div>
      </div>
      <div class="badge-current">
        <span>${collected ? `当前：${badge.currentTier.name}` : '当前：未获得'}</span>
        <span>${escapeAttr(badge.valueText)}</span>
      </div>
      <div class="badge-tier-row">${renderTierChips(badge)}</div>
      <div class="badge-progress-row">
        <span>${escapeAttr(nextText)}</span>
      </div>
      <div class="badge-progress" aria-hidden="true">
        <span style="width:${Math.round(badge.progress * 100)}%"></span>
      </div>
    </div>
  `;
}

export function renderBadgePage(historyList = []) {
  const system = getBadgeSystem(historyList);
  const nextGain = system.nextBadge
    ? `${system.nextBadge.name}·${system.nextBadge.nextTier.name}`
    : '全部完成';

  updateText('badgePageTitle', system.title.current.name);
  updateText('badgePageScore', system.totalPoints);
  updateText('badgeTitleCurrent', system.title.current.name);
  updateText('badgeTitleNext', system.title.next
    ? `${system.title.next.name} 还差 ${system.title.remaining}`
    : '最高称号');
  updateProgressWidth('badgeTitleProgress', system.title.progress);
  updateText('badgeCollectedCount', `${system.unlockedBadgeCount}/${system.badges.length}`);
  updateText('badgeTierCount', system.unlockedTierCount);
  updateText('badgeNextGain', nextGain);

  const grid = document.getElementById('badgeGrid');
  if (grid) grid.innerHTML = system.badges.map(renderBadgeCard).join('');
}

export function openBadgeModal(historyList = []) {
  renderBadgePage(historyList);
  const modal = document.getElementById('badgeModal');
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

export function closeBadgeModal() {
  const modal = document.getElementById('badgeModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

/** 渲染首页称号卡片（徽章细节在徽章馆中展示） */
function renderAchievements(historyList = []) {
  const system = getBadgeSystem(historyList);
  renderAchievementTitleSummary(system);
  positionAchievePanel();
}

/** 定位成就面板：左边缘对齐地图左边缘，可见卡片底边与开始测试卡片齐平 */
function positionAchievePanel() {
  const panel = document.getElementById('achievePanel');
  if (!panel) return;

  if (window.matchMedia('(max-width: 600px)').matches) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
    panel.style.height = '';
    return;
  }

  const testCard = document.getElementById('homeTestCard');
  const map = document.getElementById('homeMap');
  const container = document.getElementById('panel-home');
  if (!testCard || !map || !container) return;

  // 确保在浏览器完成布局后读取坐标
  requestAnimationFrame(() => {
    const tr = testCard.getBoundingClientRect();
    const mr = map.getBoundingClientRect();
    const pr = container.getBoundingClientRect();
    const metricCard = panel.querySelector('.metric-badge-card');
    const panelRect = panel.getBoundingClientRect();
    const contentRect = metricCard ? metricCard.getBoundingClientRect() : panelRect;
    const gap = 12;
    const left = mr.left - pr.left;
    const width = tr.left - mr.left - gap;
    panel.style.left = left + 'px';
    panel.style.width = width + 'px';
    panel.style.height = 'auto';
    const visibleHeight = contentRect.bottom - panelRect.top;
    panel.style.top = (tr.bottom - pr.top - visibleHeight) + 'px';
  });
}

// ===== 历史面板渲染 =====
let _historyModalList = [];

export function renderHistory(historyList) {
  const listEl = document.getElementById('historyList');
  _historyModalList = Array.isArray(historyList) ? historyList : [];

  if (_historyModalList.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-light);text-align:center">暂无记录</p>';
    return;
  }

  listEl.innerHTML = _historyModalList.map((h, index) => ({ h, index })).reverse().map(({ h, index }) => {
    const d = new Date(h.date);
    const tested = h.testedCount ?? h.words?.length ?? 0;
    const correct = h.correctCount ?? Math.max(tested - (h.words?.length || 0), 0);
    const wrong = h.words?.length || 0;
    return `
      <button class="history-item" type="button" onclick="openHistoryDetail(${index})">
        <span class="h-date">${escapeHtml(d.toLocaleString('zh-CN'))}</span>
        <span class="h-count">测试 ${tested} 词 · 正确 ${correct} 词 · 不会 ${wrong} 词</span>
        <span class="h-open">查看错词</span>
      </button>
    `;
  }).join('');
}

export function openHistoryModal(index) {
  const h = _historyModalList[index];
  if (!h) return;

  const titleEl = document.getElementById('historyModalTitle');
  const summaryEl = document.getElementById('historyModalSummary');
  const wordsEl = document.getElementById('historyModalWords');
  const modal = document.getElementById('historyModal');
  if (!titleEl || !summaryEl || !wordsEl || !modal) return;

  const d = new Date(h.date);
  const words = h.words || [];
  const tested = h.testedCount ?? words.length;
  const correct = h.correctCount ?? Math.max(tested - words.length, 0);
  const wrong = words.length;
  const accuracy = tested > 0 ? Math.round((correct / tested) * 100) : 0;

  titleEl.textContent = '历史详情';
  summaryEl.innerHTML = `
    <div class="history-modal-date">${escapeHtml(d.toLocaleString('zh-CN'))}</div>
    <div class="history-modal-stats">
      <span>测试 ${tested}</span>
      <span>正确 ${correct}</span>
      <span>不会 ${wrong}</span>
      <span>正确率 ${accuracy}%</span>
    </div>
  `;

  wordsEl.innerHTML = words.length > 0
    ? words.map((w, j) => `
      <div class="history-word-item">
        <div class="history-word-row">
          <div class="history-word-main">
            <strong>${j + 1}. ${escapeHtml(w.w)}</strong>
            <span>${w.uk ? '英' + escapeHtml(w.uk) : ''}${w.us ? ' 美' + escapeHtml(w.us) : ''}</span>
          </div>
          ${renderAudioButton(w)}
        </div>
        <div class="history-word-def">${escapeHtml(w.d)}</div>
      </div>
    `).join('')
    : '<p class="history-modal-empty">本次没有错词</p>';

  modal.hidden = false;
  modal.scrollTop = 0;
  wordsEl.scrollTop = 0;
  document.body.classList.add('modal-open');
}

export function closeHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

window.openHistoryDetail = index => openHistoryModal(index);
window.closeHistoryModal = () => closeHistoryModal();

// ===== 复习面板渲染 =====
export function renderReviewWord(index, total) {
  const w = session.todayUnknown[index];
  if (!w) return;
  document.getElementById('reviewWord').textContent = w.w;
  updateAudioButton(document.getElementById('reviewAudioBtn'), w, getStoredWordIndex(w));
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
let _reviewWordIdx = -1;     // 当前选中的错词索引

function setNotebookTouchDisabled(id, disabled) {
  const el = document.getElementById(id);
  if (el) el.disabled = disabled;
}

function updateNotebookMobileControls() {
  const sessionState = document.getElementById('nbMobileSessionState');
  const wordState = document.getElementById('nbMobileWordState');
  const hasSessions = _reviewDaySessions.length > 0;
  const session = hasSessions ? _reviewDaySessions[_reviewSessionIdx] : null;
  const words = session?.words || [];
  const hasWords = words.length > 0;
  const wordIdx = _reviewWordIdx >= 0 ? _reviewWordIdx : 0;

  setNotebookTouchDisabled('nbMobilePrevSessionBtn', !hasSessions || _reviewSessionIdx <= 0);
  setNotebookTouchDisabled('nbMobileNextSessionBtn', !hasSessions || _reviewSessionIdx >= _reviewDaySessions.length - 1);
  setNotebookTouchDisabled('nbMobilePrevWordBtn', !hasWords || wordIdx <= 0);
  setNotebookTouchDisabled('nbMobileNextWordBtn', !hasWords || wordIdx >= words.length - 1);
  setNotebookTouchDisabled('nbMobilePlayBtn', !hasWords);

  if (sessionState) {
    sessionState.textContent = hasSessions
      ? `第${_reviewSessionIdx + 1}/${_reviewDaySessions.length}次`
      : '未选择测试';
  }
  if (wordState) {
    if (hasWords) {
      wordState.textContent = `${wordIdx + 1}/${words.length} · ${words[wordIdx]?.w || ''}`;
    } else {
      wordState.textContent = hasSessions ? '本次全部正确' : '选择日期后查看错词';
    }
  }
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
    _reviewWordIdx = -1;
    updateNotebookMobileControls();
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
      <span class="rw-word">${j + 1}. ${w.w}</span>
      <span class="rw-pron">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</span>
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
  rightEl.innerHTML = `
    <div class="rw-detail-head">
      <div class="rw-detail-word">${w.w}</div>
      ${renderAudioButton(w)}
    </div>
    <div class="rw-detail-pron">${w.uk ? '英 ' + w.uk : ''}${w.us ? ' 美 ' + w.us : ''}</div>
    <div class="rw-detail-def">${w.d}</div>
  `;
  updateNotebookMobileControls();
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

export function playNotebookSelectedAudio() {
  const session = _reviewDaySessions[_reviewSessionIdx];
  if (!session || !session.words || session.words.length === 0) return false;
  const wordIdx = _reviewWordIdx >= 0 ? _reviewWordIdx : 0;
  const word = session.words[wordIdx];
  if (!word) return false;

  const button = document.querySelector(`.nb-review-word[data-word-idx="${wordIdx}"] .audio-btn`);
  if (!playWordAudio(word, getStoredWordIndex(word), button)) {
    toast('当前单词暂无音频');
  }
  return true;
}

window.notebookPrevWord = () => moveNotebookWord(-1);
window.notebookNextWord = () => moveNotebookWord(1);
window.notebookPrevSession = () => moveNotebookSession(-1);
window.notebookNextSession = () => moveNotebookSession(1);
window.notebookPlaySelectedAudio = () => playNotebookSelectedAudio();

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

// ===== 词汇地图 =====

const MAP_CELL = 8;       // 方块尺寸(含间距)
const MAP_GAP = 1;        // 方块间距
const MAP_GROUP_GAP = MAP_CELL; // 组间间距等于单词方块宽度

let _mapProbs = null;       // 归一化概率数组
let _mapLayout = null;      // [{ idx, x, y }] 布局缓存
let _mapRangeMin = 0;
let _mapRangeMax = Infinity;

/** 计算归一化概率（softmax + 温度参数拉大分布差距） */
function computeMapProbs() {
  const T = 0.5; // 温度越低差异越大（<1 放大差距）
  const stats = loadWordStats();
  const scores = allWords.map((_, i) => {
    const s = stats[i];
    if (!s || s.tested === 0) return 5.0;
    return 1.5 + (s.wrong / s.tested) * 2.5;
  });
  // softmax: p_i = exp(s_i/T) / sum(exp(s_j/T))
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp((s - maxScore) / T));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/** 按A-Z分组，蛇形排布，返回 [{idx, x, y, gap}]（gap项为组间分隔占位） */
function buildMapLayout(probs, canvasWidth) {
  // 按首字母分组
  const groups = {};
  allWords.forEach((w, i) => {
    const letter = /^[a-zA-Z]/.test(w.w) ? w.w[0].toUpperCase() : '#';
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push({ idx: i, prob: probs[i] });
  });

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').filter(l => groups[l]);
  const items = [];
  let x = 2, y = 2;
  const cell = MAP_CELL;

  for (let li = 0; li < letters.length; li++) {
    const letter = letters[li];
    const group = groups[letter];
    const forward = li % 2 === 0;
    const sorted = forward ? group : [...group].reverse();

    for (const item of sorted) {
      if (x + cell > canvasWidth - 2) {
        x = 2;
        y += cell;
      }
      items.push({ idx: item.idx, x, y });
      x += cell;
    }

    // 组间间距：插入一个占位方块作为分隔线
    if (li < letters.length - 1) {
      if (x + cell > canvasWidth - 2) {
        x = 2;
        y += cell;
      }
      items.push({ idx: -1, x, y, gap: true });
      x += cell;
    }
  }

  return items;
}

/** 概率映射到颜色：低概率=深绿/已掌握，高概率=透明/需复习 */
function probToColor(prob) {
  if (!_mapProbs || _mapProbs.length === 0) return 'rgba(33,110,57,0.28)';
  const minProb = Math.min(..._mapProbs);
  const maxProb = Math.max(..._mapProbs);
  if (maxProb <= minProb) return 'rgba(33,110,57,0.28)';

  const t = Math.min(Math.max((prob - minProb) / (maxProb - minProb), 0), 1);
  // GitHub 绿色系反向映射：概率越低越接近深绿，概率越高越透明。
  const r = Math.round(33 * (1 - t) + 155 * t);
  const g = Math.round(110 * (1 - t) + 233 * t);
  const b = Math.round(57 * (1 - t) + 168 * t);
  const alpha = 0.95 - t * 0.89;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** 渲染词汇地图 Canvas */
export function renderWordMap() {
  const canvas = document.getElementById('nbWordMap');
  if (!canvas) return;

  _mapProbs = computeMapProbs();

  // 先算布局以确定所需高度
  const containerWidth = canvas.parentElement.clientWidth - 4;
  _mapLayout = buildMapLayout(_mapProbs, containerWidth);
  const maxY = _mapLayout.reduce((m, it) => Math.max(m, it.y), 0);
  const mapHeight = Math.max(maxY + MAP_CELL + 4, 120);

  // 设置canvas尺寸
  const dpr = window.devicePixelRatio || 1;
  canvas.width = containerWidth * dpr;
  canvas.height = mapHeight * dpr;
  canvas.style.width = containerWidth + 'px';
  canvas.style.height = mapHeight + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 绘制单词方块（含分组占位）
  const cell = MAP_CELL;
  for (const item of _mapLayout) {
    if (item.gap) {
      // 分组分隔占位：黑色，与绿红渐变完全无关
      ctx.fillStyle = '#1a1a1a';
      ctx.globalAlpha = 1;
      ctx.fillRect(item.x, item.y, cell - MAP_GAP, cell - MAP_GAP);
      continue;
    }
    const prob = _mapProbs[item.idx];
    const inRange = prob >= _mapRangeMin && prob <= _mapRangeMax;
    ctx.fillStyle = probToColor(prob);
    ctx.globalAlpha = inRange ? 1 : 0.15;
    ctx.fillRect(item.x, item.y, cell - MAP_GAP, cell - MAP_GAP);
  }
  ctx.globalAlpha = 1;

  updateMapRangeInfo();
  renderDistChart();
  positionAchievePanel();
}

/** 更新范围筛选信息 */
function updateMapRangeInfo() {
  const info = document.getElementById('mapRangeInfo');
  if (!info || !_mapProbs) return;
  const inRange = _mapProbs.filter(p => p >= _mapRangeMin && p <= _mapRangeMax).length;
  const minDisp = (_mapRangeMin * 10000).toFixed(1);
  const maxDisp = _mapRangeMax === Infinity ? '∞' : (_mapRangeMax * 10000).toFixed(1);
  info.textContent = `${inRange} 个词在 ${minDisp}‱ – ${maxDisp}‱ 范围内`;
}

function getKdeSamples() {
  if (!_mapProbs || _mapProbs.length === 0) return [];

  const filtered = _mapProbs.filter(p => p >= _mapRangeMin && p <= _mapRangeMax);
  const source = filtered.length > 0 ? filtered : _mapProbs;

  // 用“相对平均概率”的尺度来画图，避免归一化到 0 附近后曲线挤成一根针。
  return source.map(p => p * allWords.length);
}

/** 核密度估计 + 渲染当前概率地图分布曲线 */
function renderDistChart() {
  const canvas = document.getElementById('probDistChart');
  const samples = getKdeSamples();
  if (!canvas || samples.length === 0) return;

  // 延迟到浏览器完成布局后读取坐标和渲染
  requestAnimationFrame(() => {
    const card = document.getElementById('homeNotebookCard');
    const map = document.getElementById('homeMap');
    const panel = document.getElementById('panel-home');
    let displayW, displayH;
    if (card && map && panel) {
      const cr = card.getBoundingClientRect();
      const mr = map.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const gap = 12;
      const left = cr.right - pr.left + gap;
      displayW = mr.right - cr.right - gap;
      displayH = cr.height;
      canvas.style.left = left + 'px';
      canvas.style.top = (cr.top - pr.top) + 'px';
      canvas.style.width = displayW + 'px';
      canvas.style.height = displayH + 'px';
    }

    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    // 用保存的显示尺寸恢复，避免 clientWidth（不含边框）覆盖导致右边缘偏移
    if (displayW) {
      canvas.style.width = displayW + 'px';
      canvas.style.height = displayH + 'px';
    }

    canvas.title = `当前 KDE 样本：${samples.length} 个词`;
    drawDistCurve(canvas, w, h, dpr, samples);
  });
}

/** 绘制KDE概率密度曲线 */
function drawDistCurve(canvas, w, h, dpr, samples) {

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const values = samples;
  const n = values.length;
  const padX = 4, padY = 4;

  // 自动带宽（Silverman规则，对偏态数据做下限保护）
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const hBand = Math.max(0.9 * std * Math.pow(n, -0.2), Math.max(0.12, mean * 0.08));

  // 评估范围：覆盖0到P99
  const sorted = [...values].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(n * 0.99)];
  const xMin = 0;
  const xMax = Math.max(p99 * 1.15, mean + hBand * 4, 1e-6);

  const steps = 100;
  const points = [];
  let maxDensity = 0;

  for (let i = 0; i <= steps; i++) {
    const x = xMin + (xMax - xMin) * (i / steps);
    let density = 0;
    for (let j = 0; j < n; j++) {
      const z = (x - values[j]) / hBand;
      density += Math.exp(-0.5 * z * z);
    }
    density /= n * hBand * Math.sqrt(2 * Math.PI);
    points.push({ x, density });
    if (density > maxDensity) maxDensity = density;
  }

  if (maxDensity === 0) return;

  // 绘制曲线
  const toX = (x) => padX + ((x - xMin) / (xMax - xMin)) * (w - padX * 2);
  const toY = (d) => h - padY - (d / maxDensity) * (h - padY * 2);

  ctx.beginPath();
  ctx.moveTo(toX(points[0].x), toY(points[0].density));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(toX(points[i].x), toY(points[i].density));
  }
  ctx.strokeStyle = '#40c463';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 填充区域
  ctx.lineTo(toX(points[points.length - 1].x), h - padY);
  ctx.lineTo(toX(points[0].x), h - padY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(64,196,99,0.12)';
  ctx.fill();
}

/** Canvas悬停显示单词详情 */
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('nbWordMap');
  if (!canvas) return;
  const tooltip = document.getElementById('mapTooltip');

  function getMapHit(e) {
    if (!_mapLayout || !_mapProbs) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const cell = MAP_CELL;
    return _mapLayout.find(item =>
      mx >= item.x && mx < item.x + cell - MAP_GAP &&
      my >= item.y && my < item.y + cell - MAP_GAP
    );
  }

  canvas.addEventListener('mousemove', (e) => {
    const hit = getMapHit(e);

    if (hit && allWords[hit.idx]) {
      const w = allWords[hit.idx];
      const prob = _mapProbs[hit.idx];
      const permille = (prob * 10000).toFixed(2);
      tooltip.innerHTML = `
        <div class="tip-word">${w.w}</div>
        <div class="tip-pron">${w.uk ? '英' + w.uk : ''}${w.us ? ' 美' + w.us : ''}</div>
        <div class="tip-def">${w.d}</div>
        <div class="tip-prob">概率: ${permille}‱</div>
      `;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'crosshair';
    }
  });

  canvas.addEventListener('click', (e) => {
    const hit = getMapHit(e);
    if (!hit || !allWords[hit.idx]) return;
    const word = allWords[hit.idx];
    if (!playWordAudio(word, hit.idx)) {
      toast('当前单词暂无音频');
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
});

/** 概率范围筛选 */
function applyMapRange() {
  const minEl = document.getElementById('mapProbMin');
  const maxEl = document.getElementById('mapProbMax');
  _mapRangeMin = (parseFloat(minEl.value) || 0) / 10000;
  const maxVal = parseFloat(maxEl.value);
  _mapRangeMax = maxVal > 0 ? maxVal / 10000 : Infinity;
  renderWordMap();
}

// 监听范围输入变化
document.addEventListener('DOMContentLoaded', () => {
  const minEl = document.getElementById('mapProbMin');
  const maxEl = document.getElementById('mapProbMax');
  if (minEl) minEl.addEventListener('input', applyMapRange);
  if (maxEl) maxEl.addEventListener('input', applyMapRange);
});

/** 对概率范围内的词开始测试 */
window.testMapRange = () => {
  applyMapRange();
  if (!_mapProbs) return;

  const indices = [];
  _mapProbs.forEach((p, i) => {
    if (p >= _mapRangeMin && p <= _mapRangeMax) indices.push(i);
  });

  if (indices.length === 0) {
    toast('范围内没有单词');
    return;
  }

  // 推迟导入以避免循环依赖
  import('./session.js').then(({ startFilteredSession }) => {
    startFilteredSession(indices);
  });
};
