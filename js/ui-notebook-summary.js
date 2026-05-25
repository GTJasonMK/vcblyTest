import { wrongCountOf } from './ui-common.js';

export function renderHomeNotebookSummary(historyList) {
  const el = document.getElementById('homeNotebookSummary');
  const preview = document.getElementById('nbMiniPreview');
  if (!el) return;

  if (!Array.isArray(historyList) || historyList.length === 0) {
    el.textContent = '暂无测试记录';
    if (preview) preview.innerHTML = '';
    return;
  }

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

  if (!preview) return;
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
