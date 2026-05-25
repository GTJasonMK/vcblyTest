export function buildReaderSystemPrompt() {
  return '你是一个英语教学专家，擅长根据词汇表编写适合英语学习者的阅读文章。\n'
    + '严格要求：\n'
    + '1. 用给出的全部单词写一篇约 250-400 词的英语短文。\n'
    + '2. 必须使用列表中的每一个单词（允许屈折变化，如复数、过去式、进行时、形容词形式等）。\n'
    + '3. **绝对禁止**把目标词在段首罗列、加粗、用反引号包裹、加方括号、或以任何方式特殊标注；让目标词像普通词汇一样自然地融入句子里。\n'
    + '4. **绝对禁止**在文中或末尾附加单词表、词性提示、注释、或任何形式的元说明。\n'
    + '5. 选择能自然容纳所有词的主题，使文章读起来流畅、有连贯叙事或论述，不牵强堆砌。\n'
    + '6. 只输出文章正文（markdown 格式：一级标题 + 多个自然段），不要在前后附加任何解释。';
}

export function buildReaderQuestion(words) {
  const list = words.map((word, index) => {
    let line = `${index + 1}. **${word.w}**`;
    if (word.d) line += ` — ${word.d}`;
    if (word.uk) line += ` 英/${word.uk}/`;
    if (word.us) line += ` 美/${word.us}/`;
    return line;
  }).join('\n');
  return `请根据以上系统指令，用以下全部${words.length}个单词写一篇文章：\n\n${list}`;
}

export function buildTranslationSystemPrompt() {
  return '你是一名英译中翻译专家。请将用户提供的英文文章逐段翻译为自然流畅的简体中文，'
    + '保留原文的 markdown 结构（标题、段落、列表、强调等）。'
    + '直译优先，必要时调整语序以符合中文表达习惯。'
    + '只输出译文，不要附加解释或英文原文。';
}

export function buildTranslationQuestion(articleMarkdown) {
  return `请将以下文章翻译为中文（保持 markdown 格式）：\n\n${articleMarkdown}`;
}
