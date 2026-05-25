export function renderNotebookTrendChart(historyList) {
  const canvas = document.getElementById('nbChart');
  const summary = document.getElementById('nbChartSummary');
  if (!canvas || !summary) return;

  if (historyList.length < 2) {
    summary.textContent = '至少需要 2 次测试才能显示趋势图';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const data = historyList.map((h, i) => ({
    x: i + 1,
    ratio: (h.testedCount || 0) > 0 ? (h.words ? h.words.length : 0) / (h.testedCount || 1) : 0,
    wrong: h.words ? h.words.length : 0,
    tested: h.testedCount || 0,
  }));

  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid).reduce((s, d) => s + d.ratio, 0) / mid;
  const secondHalf = data.slice(mid).reduce((s, d) => s + d.ratio, 0) / (data.length - mid);
  const trendDown = secondHalf < firstHalf;
  summary.textContent = trendDown
    ? `错词率从 ${(firstHalf * 100).toFixed(0)}% 降至 ${(secondHalf * 100).toFixed(0)}%，学习效果显著！`
    : '错词率保持平稳，继续加油！';

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

  const borderColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#e0d5c1';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + ph);
  ctx.lineTo(pad.left + pw, pad.top + ph);
  ctx.stroke();

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

  const barColor = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#c0392b';
  const greenColor = getComputedStyle(document.body).getPropertyValue('--green').trim() || '#27ae60';
  data.forEach((d, i) => {
    const x = pad.left + i * gap + (gap - barWidth) / 2;
    const barH = Math.max(2, (d.ratio / yMax) * ph);
    const y = pad.top + ph - barH;
    if (d.ratio < 0.3) ctx.fillStyle = greenColor;
    else if (d.ratio < 0.6) ctx.fillStyle = '#e67e22';
    else ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barWidth, barH);

    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-light').trim() || '#8b7d6b';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((d.ratio * 100).toFixed(0) + '%', x + barWidth / 2, y - 4);
  });

  if (data.length < 3) return;
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
