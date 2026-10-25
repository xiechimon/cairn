#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HEADER = [
  'Category',
  'First seen',
  'Level',
  'Protection',
  'Intercepted',
  'Recurred',
  'Notes',
];

export function checkLedger(markdown) {
  const violations = [];
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('| Category |'));
  if (start === -1) return ['ledger table header missing'];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i]
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== HEADER.length) {
      violations.push(`line ${i + 1} has ${cells.length} columns, expected ${HEADER.length}`);
      continue;
    }
    const [name, , level, , , , note] = cells;
    const label = name.slice(0, 24);
    if (!/^[1-5]$/.test(level)) violations.push(`${label}: level must be 1 to 5`);
    if (Number(level) >= 4 && note === '')
      violations.push(
        `${label}: level ${level} must explain in Notes why a higher level is not feasible`,
      );
    if (note.includes('upgrade pending') && !/#\d+/.test(note))
      violations.push(`${label}: "upgrade pending" must carry a ticket number`);
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
