import { loadWordStats } from './storage.js';
import { renderAchievements } from './ui-badges.js';

function updateTodayBadge(id, count) {
  const el = document.getElementById(id);
  if (count > 0) {
    el.textContent = '+' + count;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

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
  try {
    const stats = loadWordStats();
    totalTested = Object.values(stats).filter(s => s && s.tested > 0).length;
  } catch {}

  let todayTests = 0, todayTested = 0;
  const todayWords = new Set();
  historyList.forEach(item => {
    (item.words || []).forEach(word => uniqueWords.add(word.w));
    const itemDate = new Date(item.date).toLocaleDateString('zh-CN');
    if (itemDate === today) {
      todayTests++;
      todayTested += (item.testedCount || 0);
      (item.words || []).forEach(word => todayWords.add(word.w));
    }
  });

  document.getElementById('scTotalTests').textContent = historyList.length;
  document.getElementById('scTotalWords').textContent = totalTested;
  document.getElementById('scWrongWords').textContent = uniqueWords.size;
  updateTodayBadge('scTodayTests', todayTests);
  updateTodayBadge('scTodayWords', todayTested);
  updateTodayBadge('scTodayWrong', todayWords.size);
  renderAchievements(historyList);
}

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
