// ========== 徽章馆 + 称号 + 首页成就面板 ==========
// 包含：基于 history + word_stats 的指标计算、徽章定义、徽章馆模态、
// 首页"当前称号"卡片渲染、achievePanel 的几何定位。

import { allWords } from './state.js';
import { escapeAttr, setText } from './ui-common.js';
import { loadWordStats } from './storage.js';
import { clamp01, formatMetric, getBadgeSystem } from './badge-system.js';

function getCurrentBadgeSystem(historyList = []) {
  return getBadgeSystem(historyList, loadWordStats(), allWords.length);
}

// ===== 渲染 =====

function updateProgressWidth(id, progress) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.round(clamp01(progress) * 100)}%`;
}

function renderAchievementTitleSummary(system) {
  setText('achCurrentTitle', system.title.current.name);
  setText('achScore', system.totalPoints);
  setText('achTitleNext', system.title.next
    ? `距「${system.title.next.name}」还差 ${system.title.remaining} 成就值`
    : '最高称号已解锁');
  updateProgressWidth('achTitleProgress', system.title.progress);
  setText('achMastered', system.metrics.words.mastered);
  setText('achPerfect', system.metrics.words.perfect);
  setText('achRevenge', system.metrics.words.revenge);
  setText('achExplored', system.metrics.words.total > 0
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
  const system = getCurrentBadgeSystem(historyList);
  const nextGain = system.nextBadge
    ? `${system.nextBadge.name}·${system.nextBadge.nextTier.name}`
    : '全部完成';

  setText('badgePageTitle', system.title.current.name);
  setText('badgePageScore', system.totalPoints);
  setText('badgeTitleCurrent', system.title.current.name);
  setText('badgeTitleNext', system.title.next
    ? `${system.title.next.name} 还差 ${system.title.remaining}`
    : '最高称号');
  updateProgressWidth('badgeTitleProgress', system.title.progress);
  setText('badgeCollectedCount', `${system.unlockedBadgeCount}/${system.badges.length}`);
  setText('badgeTierCount', system.unlockedTierCount);
  setText('badgeNextGain', nextGain);

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
export function renderAchievements(historyList = []) {
  const system = getCurrentBadgeSystem(historyList);
  renderAchievementTitleSummary(system);
  positionAchievePanel();
}

/** 定位成就面板：左边缘对齐地图左边缘，可见卡片底边与开始测试卡片齐平 */
export function positionAchievePanel() {
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
