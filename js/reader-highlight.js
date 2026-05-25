function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildReaderWordRegex(word) {
  const value = String(word || '').trim();
  const variants = new Set([
    value,
    `${value}s`,
    `${value}es`,
    `${value}ed`,
    `${value}ing`,
    `${value}ly`,
    `${value}er`,
    `${value}est`,
    `${value}'s`,
    `${value}s'`,
  ]);

  if (value.endsWith('e') && value.length > 1) {
    const stem = value.slice(0, -1);
    variants.add(`${value}d`);
    variants.add(`${stem}ing`);
  }

  if (value.endsWith('y') && value.length > 1) {
    const stem = value.slice(0, -1);
    variants.add(`${stem}ies`);
    variants.add(`${stem}ied`);
    variants.add(`${stem}ier`);
    variants.add(`${stem}iest`);
  }

  const pattern = [...variants]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  return new RegExp(`\\b(${pattern})\\b`, 'gi');
}

export function findMissingReaderWords(text, words) {
  const source = text || '';
  if (!source || !Array.isArray(words) || words.length === 0) return words || [];
  return words.filter(word => {
    const target = typeof word === 'string' ? word : word.w;
    if (!target) return false;
    const regex = buildReaderWordRegex(target);
    return !regex.test(source);
  });
}

export function highlightReaderWords(container, words) {
  if (!container || words.length === 0) return;

  const targets = words.map(word => {
    return {
      key: word.w.toLowerCase(),
      word: word.w,
      uk: word.uk || '',
      us: word.us || '',
      d: word.d || '',
      regex: buildReaderWordRegex(word.w),
    };
  });

  const used = new Set();
  const textNodes = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'CODE' || tag === 'PRE' || tag === 'A' || tag === 'SCRIPT' || tag === 'STYLE') {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.classList.contains('rw-target')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }}
  );

  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    let current = node;

    while (current && current.parentNode) {
      const text = current.textContent || '';
      let best = null;

      for (const target of targets) {
        if (used.has(target.key)) continue;
        target.regex.lastIndex = 0;
        const match = target.regex.exec(text);
        if (!match) continue;

        if (!best || match.index < best.index || (match.index === best.index && match[0].length > best.text.length)) {
          best = { target, index: match.index, text: match[0] };
        }
      }

      if (!best) break;

      const afterNode = current.splitText(best.index);
      const restNode = afterNode.splitText(best.text.length);

      const span = document.createElement('span');
      span.className = 'rw-target';
      span.dataset.word = best.target.word;
      span.dataset.def = best.target.d;
      span.dataset.uk = best.target.uk;
      span.dataset.us = best.target.us;
      span.textContent = best.text;
      afterNode.replaceWith(span);

      used.add(best.target.key);
      current = restNode;
    }
  }
}
