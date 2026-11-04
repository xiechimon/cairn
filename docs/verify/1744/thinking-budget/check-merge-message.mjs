import { readFileSync } from 'node:fs';

const message = readFileSync(process.argv[2], 'utf8');
const parentClosing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?:xiechimon\/cairn)?#1744|https:\/\/github\.com\/xiechimon\/cairn\/issues\/1744)\b/gi;
const matches = message.match(parentClosing) ?? [];
if (matches.length > 0) {
  console.error(`merge-message: ${matches.length} parent-closing keyword(s)`);
  process.exit(1);
}
console.log('merge-message: no closing keyword for unfinished parent #1744');
