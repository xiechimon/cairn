import { stripCodeComments } from './ui-normalize.mjs';

const STATE_SHADOW = /(?<![\w-])(?:[\w/-]*hover|active):(?:[\w-]+:)*(?:drop-)?shadow-[^\s"'`]+/;
const SHADOW_TRANSITION =
  /transition-shadow\b|transition-\[[^\]]*box-shadow[^\]]*\]|\[transition:[^\]]*box-shadow[^\]]*\]|(?:transition(?:-property)?\s*:|transitionProperty\s*:)\s*["'`]?[^;}"'`]*(?:box-shadow|\ball\b)/;

export function shadowFindings(source) {
  const raw = source.split('\n');
  const clean = stripCodeComments(source);
  const hits = new Map();
  for (const pattern of [STATE_SHADOW, SHADOW_TRANSITION]) {
    for (const match of clean.matchAll(new RegExp(pattern.source, 'g'))) {
      const line = clean.slice(0, match.index).split('\n').length;
      const annotation = raw[line - 2] ?? '';
      if (/deliberate-shadow:\s*[\w][^\n]*\w/.test(annotation.replace(/\*\/.*$/, ''))) continue;
      hits.set(line, { line, text: match[0] });
    }
  }
  return [...hits.values()].sort((a, b) => a.line - b.line);
}
