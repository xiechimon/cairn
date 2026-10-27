import { readFileSync } from 'node:fs';

let message = readFileSync(process.argv[2], 'utf8');
let snapshot;
try {
  snapshot = JSON.parse(message);
} catch {}
if (snapshot !== null && typeof snapshot === 'object' && 'autoMergeRequest' in snapshot) {
  const request = snapshot.autoMergeRequest;
  if (request === null) {
    console.log('merge-message: auto-merge is disabled');
    process.exit(0);
  }
  if (
    typeof request !== 'object' ||
    request.mergeMethod !== 'SQUASH' ||
    typeof request.commitHeadline !== 'string' ||
    typeof request.commitBody !== 'string'
  ) {
    console.error('merge-message: auto-merge lost its explicit squash message');
    process.exit(1);
  }
  message = `${request.commitHeadline}\n\n${request.commitBody}`;
  const expected = readFileSync(new URL('./squash-message.txt', import.meta.url), 'utf8');
  if (message.trim() !== expected.trim()) {
    console.error('merge-message: auto-merge differs from the audited squash message');
    process.exit(1);
  }
}
const parentClosing =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(?:xiechimon\/cairn)?#1744|https:\/\/github\.com\/xiechimon\/cairn\/issues\/1744)\b/gi;
const matches = message.match(parentClosing) ?? [];
if (matches.length > 0) {
  console.error(`merge-message: ${matches.length} parent-closing keyword(s)`);
  process.exit(1);
}
console.log('merge-message: no closing keyword for unfinished parent #1744');
