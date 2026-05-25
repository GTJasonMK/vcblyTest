// ========== 成就系统规则与计算 ==========

export const TITLE_LEVELS = [
  { name: '词海新兵', points: 0 },
  { name: '记忆学徒', points: 50 },
  { name: '词汇行者', points: 150 },
  { name: '生词猎手', points: 320 },
  { name: '词库专家', points: 600 },
  { name: '红宝书征服者', points: 950 },
  { name: '词汇宗师', points: 1400 },
];

export const BADGE_DEFINITIONS = [
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

export function clamp01(value) {
  return Math.max(0, Math.min(value, 1));
}

export function formatMetric(value, unit) {
  const normalized = unit === '%' ? Math.round(value) : Math.floor(value);
  return `${normalized}${unit}`;
}

function resolveTarget(target, metrics) {
  return Math.max(1, typeof target === 'function' ? target(metrics) : target);
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

function getWordAchievementMetrics(historyList, wordStats, totalWords) {
  let mastered = 0, perfect = 0, revenge = 0;

  const entries = Object.values(wordStats || {}).filter(s => s && s.tested > 0);
  let explored = entries.length;

  for (const s of entries) {
    if (s.tested >= 3) {
      const rate = s.wrong / s.tested;
      if (rate <= 0.2) mastered++;
      if (s.wrong === 0) perfect++;
      if (s.wrong > 0 && rate <= 0.5) revenge++;
    }
  }

  if (explored === 0 && historyList.length > 0) {
    const histWords = new Set();
    historyList.forEach(h => (h.words || []).forEach(w => histWords.add(w.w || w.idx)));
    explored = histWords.size;
  }

  return {
    total: totalWords,
    explored,
    exploredPct: totalWords > 0 ? explored / totalWords * 100 : 0,
    mastered,
    perfect,
    revenge,
  };
}

function getAchievementMetrics(historyList, wordStats, totalWords) {
  return {
    history: getHistoryAchievementMetrics(historyList),
    words: getWordAchievementMetrics(historyList, wordStats, totalWords),
  };
}

function evaluateBadges(metrics) {
  return BADGE_DEFINITIONS.map(def => {
    const value = Math.max(0, def.value(metrics) || 0);
    const tiers = def.tiers.map(tier => {
      const target = resolveTarget(tier.target, metrics);
      return {
        ...tier,
        target,
        unlocked: value >= target,
      };
    });
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

export function getBadgeSystem(historyList = [], wordStats = {}, totalWords = 0) {
  const safeHistory = Array.isArray(historyList) ? historyList : [];
  const metrics = getAchievementMetrics(safeHistory, wordStats, totalWords);
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
