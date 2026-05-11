// ========== 词汇正确率地图 + KDE 分布图 ==========
// 每个方块代表一个单词，颜色反映该单词的**绝对正确率**（而非相对概率）。
// 正确率 = 1 - wrong/tested（测试过的词），未测过的词显示为中性色。
// 全部掌握后所有方块变为深绿色。

import { allWords } from './state.js';
import { playWordAudio, preloadWordAudio } from './audio.js';
import { escapeHtml, toast } from './ui-common.js';
import { startFilteredSession } from './session.js';
import { positionAchievePanel } from './ui-badges.js';

const MAP_CELL = 8;
const MAP_GAP = 1;

let _correctRates = null;   // 每词正确率 [0~1]，未测过为 -1
let _mapLayout = null;
let _mapRangeMin = 0;
let _mapRangeMax = 1;

/** 计算每词绝对正确率（未测过为 -1） */
function computeCorrectRates() {
  const stats = (() => {
    try { return JSON.parse(localStorage.getItem('vocab_word_stats') || '{}'); } catch { return {}; }
  })();
  return allWords.map((_, i) => {
    const s = stats[i];
    if (!s || !s.tested || s.tested <= 0) return -1;
    const wrong = Math.min(s.wrong || 0, s.tested);
    return 1 - wrong / s.tested;
  });
}

/** 按A-Z分组，蛇形排布 */
function buildMapLayout(rates, canvasWidth) {
  const groups = {};
  allWords.forEach((w, i) => {
    const letter = /^[a-zA-Z]/.test(w.w) ? w.w[0].toUpperCase() : '#';
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push({ idx: i, rate: rates[i] });
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
      if (x + cell > canvasWidth - 2) { x = 2; y += cell; }
      items.push({ idx: item.idx, x, y });
      x += cell;
    }

    if (li < letters.length - 1) {
      if (x + cell > canvasWidth - 2) { x = 2; y += cell; }
      items.push({ idx: -1, x, y, gap: true });
      x += cell;
    }
  }
  return items;
}

/** 正确率 → 颜色：高正确率（掌握好）→ 深绿，低正确率（未掌握）→ 红/透明 */
function rateToColor(rate) {
  if (rate < 0) return 'rgba(200,200,200,0.15)'; // 未测过：浅灰
  // rate: 0~1, 0=全错(红), 1=全对(绿)
  const r = Math.round(200 * (1 - rate) + 33 * rate);
  const g = Math.round(60 * (1 - rate) + 110 * rate);
  const b = Math.round(50 * (1 - rate) + 57 * rate);
  const alpha = 0.25 + rate * 0.7;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** 渲染词汇正确率地图 Canvas */
export function renderWordMap() {
  const canvas = document.getElementById('nbWordMap');
  if (!canvas) return;

  _correctRates = computeCorrectRates();

  const containerWidth = canvas.parentElement.clientWidth - 4;
  _mapLayout = buildMapLayout(_correctRates, containerWidth);
  const maxY = _mapLayout.reduce((m, it) => Math.max(m, it.y), 0);
  const mapHeight = Math.max(maxY + MAP_CELL + 4, 120);

  const dpr = window.devicePixelRatio || 1;
  canvas.width = containerWidth * dpr;
  canvas.height = mapHeight * dpr;
  canvas.style.width = containerWidth + 'px';
  canvas.style.height = mapHeight + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, containerWidth, mapHeight);

  const cell = MAP_CELL;
  for (const item of _mapLayout) {
    if (item.gap) {
      ctx.fillStyle = '#1a1a1a';
      ctx.globalAlpha = 1;
      ctx.fillRect(item.x, item.y, cell - MAP_GAP, cell - MAP_GAP);
      continue;
    }
    const rate = _correctRates[item.idx];
    const inRange = rate >= _mapRangeMin && rate <= _mapRangeMax;
    ctx.fillStyle = rateToColor(rate);
    ctx.globalAlpha = inRange ? 1 : 0.12;
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
  if (!info || !_correctRates) return;
  const inRange = _correctRates.filter(r => r >= _mapRangeMin && r <= _mapRangeMax).length;
  const testedCount = _correctRates.filter(r => r >= 0).length;
  const mastered = _correctRates.filter(r => r >= 0.8).length;
  info.textContent = `${inRange} 个词在范围内 · 已测 ${testedCount} 词 · 掌握率 ≥80% 共 ${mastered} 词`;
}

function getKdeSamples() {
  if (!_correctRates || _correctRates.length === 0) return [];
  const filtered = _correctRates.filter(r => r >= _mapRangeMin && r <= _mapRangeMax);
  const source = filtered.length > 0 ? filtered : _correctRates.filter(r => r >= 0);
  return source;
}

/** 核密度估计 + 渲染当前正确率分布曲线 */
function renderDistChart() {
  const canvas = document.getElementById('probDistChart');
  const samples = getKdeSamples();
  if (!canvas || samples.length === 0) return;

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
      displayW = mr.right - cr.right - gap;
      displayH = cr.height;
      canvas.style.left = (cr.right - pr.left + gap) + 'px';
      canvas.style.top = (cr.top - pr.top) + 'px';
      canvas.style.width = displayW + 'px';
      canvas.style.height = displayH + 'px';
    }

    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    if (displayW) {
      canvas.style.width = displayW + 'px';
      canvas.style.height = displayH + 'px';
    }

    canvas.title = `正确率样本：${samples.length} 个词`;
    drawDistCurve(canvas, w, h, dpr, samples);
  });
}

/** 绘制正确率分布 KDE 曲线 */
function drawDistCurve(canvas, w, h, dpr, samples) {
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const values = samples;
  const n = values.length;
  const padX = 4, padY = 4;

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const hBand = Math.max(0.9 * std * Math.pow(n, -0.2), Math.max(0.05, mean * 0.08));

  const xMin = 0;
  const xMax = Math.max(1, mean + hBand * 4);

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
  const canHoverPrefetch = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  let hoverAudioTimer = null;
  let lastHoverAudioIdx = -1;

  function getMapHit(e) {
    if (!_mapLayout || !_correctRates) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cell = MAP_CELL;
    return _mapLayout.find(item =>
      mx >= item.x && mx < item.x + cell - MAP_GAP &&
      my >= item.y && my < item.y + cell - MAP_GAP
    );
  }

  let _lastTooltipIdx = -1;
  let _rafPending = false;
  canvas.addEventListener('mousemove', (e) => {
    if (document.hidden) { clearTimeout(hoverAudioTimer); return; }
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      const hit = getMapHit(e);
      const idx = hit?.idx ?? -1;

      if (idx >= 0 && allWords[idx]) {
        // 单词未变 → 只更新位置，不重绘 DOM
        if (idx !== _lastTooltipIdx) {
          _lastTooltipIdx = idx;
          const w = allWords[idx];
          const rate = _correctRates[idx];
          const pct = rate >= 0 ? (rate * 100).toFixed(1) + '%' : '未测试';
          tooltip.innerHTML = `
            <div class="tip-word">${escapeHtml(w.w)}</div>
            <div class="tip-pron">${w.uk ? '英' + escapeHtml(w.uk) : ''}${w.us ? ' 美' + escapeHtml(w.us) : ''}</div>
            <div class="tip-def">${escapeHtml(w.d)}</div>
            <div class="tip-prob">正确率: ${pct}</div>
          `;
        }
        tooltip.style.display = 'block';
        tooltip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 10}px)`;
        canvas.style.cursor = 'pointer';
        if (canHoverPrefetch && lastHoverAudioIdx !== idx) {
          clearTimeout(hoverAudioTimer);
          hoverAudioTimer = setTimeout(() => {
            lastHoverAudioIdx = idx;
            preloadWordAudio(allWords[idx], idx, { priority: 'normal', warmMemory: true, prefetchedOnly: true });
          }, 150);
        }
      } else {
        _lastTooltipIdx = -1;
        tooltip.style.display = 'none';
        canvas.style.cursor = 'crosshair';
      clearTimeout(hoverAudioTimer);
    }
  });
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
    clearTimeout(hoverAudioTimer);
  });
});

/** 正确率范围筛选 */
function applyMapRange() {
  const minEl = document.getElementById('mapProbMin');
  const maxEl = document.getElementById('mapProbMax');
  if (!minEl || !maxEl) return;
  _mapRangeMin = (parseFloat(minEl.value) || 0) / 100;
  const maxVal = parseFloat(maxEl.value);
  _mapRangeMax = maxVal > 0 ? maxVal / 100 : 1;
  renderWordMap();
}

let _rangeTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const minEl = document.getElementById('mapProbMin');
  const maxEl = document.getElementById('mapProbMax');
  if (minEl) minEl.addEventListener('input', () => {
    clearTimeout(_rangeTimer);
    _rangeTimer = setTimeout(applyMapRange, 80);
  });
  if (maxEl) maxEl.addEventListener('input', () => {
    clearTimeout(_rangeTimer);
    _rangeTimer = setTimeout(applyMapRange, 80);
  });
});

/** 对范围内（低正确率）的词开始测试 */
window.testMapRange = () => {
  applyMapRange();
  if (!_correctRates) return;

  const indices = [];
  _correctRates.forEach((r, i) => {
    if (r >= _mapRangeMin && r <= _mapRangeMax) indices.push(i);
  });

  if (indices.length === 0) {
    toast('范围内没有单词');
    return;
  }

  startFilteredSession(indices);
};
