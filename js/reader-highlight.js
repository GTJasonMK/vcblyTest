function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightReaderWords(container, words) {
  if (!container || words.length === 0) return;

  const targets = words.map(word => {
    const stem = escapeRegex(word.w);
    const suffixes = '(?:s|es|ed|ing|ly|er|est|\'s|s\')?';
    return {
      word: word.w,
      uk: word.uk || '',
      us: word.us || '',
      d: word.d || '',
      regex: new RegExp(`\\b(${stem})${suffixes}\\b`, 'gi'),
    };
  });

  const used = new Set();
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

  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const target of targets) {
      if (used.has(target.word.toLowerCase())) continue;
      target.regex.lastIndex = 0;
      const match = target.regex.exec(node.textContent);
      if (!match) continue;

      const matchedText = match[0];
      const afterNode = node.splitText(match.index);
      afterNode.splitText(matchedText.length);

      const span = document.createElement('span');
      span.className = 'rw-target';
      span.dataset.word = target.word;
      span.dataset.def = target.d;
      span.dataset.uk = target.uk;
      span.dataset.us = target.us;
      span.textContent = matchedText;
      afterNode.replaceWith(span);

      used.add(target.word.toLowerCase());
      break;
    }
  }
}
