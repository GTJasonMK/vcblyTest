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

export function buildContextReaderSystemPrompt() {
  return '你是一个英语词汇语境训练设计师，擅长把英语目标词自然嵌入中文故事或说明文。\n'
    + '严格要求：\n'
    + '1. 写一篇以简体中文为主的短文，长度约 500-900 个汉字。\n'
    + '2. 必须使用列表中的每一个目标词，并且目标词必须以英文原词自然出现在中文句子中。\n'
    + '3. 除目标词外，正文尽量使用中文；不要把普通中文内容翻成英文。\n'
    + '4. **绝对禁止**在段首或文末罗列单词、加粗目标词、用反引号包裹、加方括号、或添加词性/释义/注释。\n'
    + '5. 让每个目标词都处在能体现语义和用法的上下文里，整体要像一篇连贯文章，不要机械造句。\n'
    + '6. 只输出文章正文（markdown 格式：一级标题 + 多个自然段），不要附加任何解释。';
}

export function buildContextReaderQuestion(words) {
  const list = words.map((word, index) => {
    let line = `${index + 1}. **${word.w}**`;
    if (word.d) line += ` — ${word.d}`;
    if (word.uk) line += ` 英/${word.uk}/`;
    if (word.us) line += ` 美/${word.us}/`;
    return line;
  }).join('\n');
  return `请根据以上系统指令，把以下全部${words.length}个目标词自然嵌入一篇中文语境短文：\n\n${list}`;
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
