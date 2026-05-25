import { allWords } from './state.js';

export function resolveWordDef(word) {
  if (!word?.d || !word.d.includes('找不到解释')) return word?.d || '';
  const current = allWords.find(item => item.w === word.w);
  return current ? current.d : word.d;
}
