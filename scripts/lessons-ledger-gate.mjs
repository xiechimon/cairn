#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HEADER = ['类别', '首次来源', '级别', '防护', '拦截', '复发', '备注'];

export function checkLedger(markdown) {
  const violations = [];
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('| 类别 |'));
  if (start === -1) return ['台账表头缺失'];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i]
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== HEADER.length) {
      violations.push(`第 ${i + 1} 行列数不是 ${HEADER.length}`);
      continue;
    }
    const [name, , level, , , , note] = cells;
    const label = name.slice(0, 24);
    if (!/^[1-5]$/.test(level)) violations.push(`${label}: 级别必须是 1 到 5`);
    if (Number(level) >= 4 && note === '')
      violations.push(`${label}: 级别 ${level} 必须在备注写明为什么做不成更高级`);
    if (note.includes('待升') && !/#\d+/.test(note))
      violations.push(`${label}: 「待升」必须带票号`);
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = checkLedger(
    readFileSync(new URL('../docs/lessons.md', import.meta.url), 'utf8'),
  );
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log('lessons ledger ok');
}
