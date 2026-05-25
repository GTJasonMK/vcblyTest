// ========== 测试抽词与选项生成 ==========

/** 计算每词基础权重（基于历史统计）
 *  公式：2.5 + (wrong / tested) * 1.5
 *  → 全对最低 2.5，全错最高 4.0，未测过的新词为 5.0（最优先抽中）；
 *  权重越高越容易被抽到。 */
export function computeBaseWeight(stats, idx) {
  const s = stats[idx];
  const tested = Number(s?.tested);
  if (!Number.isFinite(tested) || tested <= 0) return 5.0;
  const wrongRaw = Number(s?.wrong);
  const wrong = Number.isFinite(wrongRaw) ? Math.max(0, Math.min(wrongRaw, tested)) : 0;
  return 2.5 + (wrong / tested) * 1.5;
}

/** 获取所有单词的归一化概率（和为1），供可视化使用 */
export function getWordProbabilities(words, stats) {
  const weights = words.map((_, i) => computeBaseWeight(stats, i));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / total);
}

/** 按权重比例无放回抽样（轮盘赌算法 + softmax 放大差距） */
export function buildWeightedOrder(words, stats) {
  const pool = words.map((_, i) => ({
    idx: i,
    weight: computeBaseWeight(stats, i),
  }));

  const order = [];
  const expArr = new Array(pool.length);
  let len = pool.length;

  while (len > 0) {
    let maxW = -Infinity;
    let expSum = 0;
    for (let i = 0; i < len; i++) {
      const w = pool[i].weight;
      if (w > maxW) maxW = w;
    }
    for (let i = 0; i < len; i++) {
      const e = Math.exp((pool[i].weight - maxW) / 0.5);
      expArr[i] = e;
      expSum += e;
    }

    const rand = Math.random();
    let acc = 0;
    let picked = false;
    for (let i = 0; i < len; i++) {
      acc += expArr[i] / expSum;
      if (rand < acc) {
        order.push(pool[i].idx);
        const last = len - 1;
        if (i !== last) {
          const tmp = pool[i]; pool[i] = pool[last]; pool[last] = tmp;
          const etmp = expArr[i]; expArr[i] = expArr[last]; expArr[last] = etmp;
        }
        len--;
        picked = true;
        break;
      }
    }
    if (!picked && len > 0) {
      order.push(pool[len - 1].idx);
      len--;
    }
  }
  return order;
}

/** Fisher-Yates 洗牌 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 为当前单词生成4个选项（1个正确释义+3个随机错误释义） */
export function generateOptions(words, correctIdx) {
  const correctDef = words[correctIdx].d;
  const total = words.length;

  const wrongIndices = [];
  const pickedIdx = new Set();
  const seenDef = new Set([correctDef]);
  let safety = total * 4;
  while (wrongIndices.length < 3 && safety-- > 0) {
    const r = Math.floor(Math.random() * total);
    if (r === correctIdx || pickedIdx.has(r)) continue;
    const def = words[r].d;
    if (seenDef.has(def)) continue;
    pickedIdx.add(r);
    seenDef.add(def);
    wrongIndices.push(r);
  }
  while (wrongIndices.length < 3) {
    const r = Math.floor(Math.random() * total);
    if (r !== correctIdx && !pickedIdx.has(r)) {
      pickedIdx.add(r);
      wrongIndices.push(r);
    }
  }

  const options = [
    { text: correctDef, isCorrect: true },
    ...wrongIndices.map(i => ({ text: words[i].d, isCorrect: false })),
  ];

  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return {
    options,
    correctOptIdx: options.findIndex(o => o.isCorrect),
  };
}
