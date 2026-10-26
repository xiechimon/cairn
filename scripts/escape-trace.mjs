#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

export const WINDOW_DAYS = 14;

export function isRevertCommit(subject) {
  return /^revert\b/i.test(subject) || /revert(s|ed)?\b/i.test(subject);
}

export function isFixCommit(subject) {
  return /^(fix|hotfix|bugfix)\b/i.test(subject);
}

export function extractPrNumber(text) {
  const match = /\(#(\d+)\)/.exec(text || '');
  return match ? Number(match[1]) : null;
}

export function classifyReviewPath(markers) {
  const text = (markers || '').toLowerCase();
  if (/ai[- ]?reviewer|review-gate:\s*ai|ai-reviewed/i.test(text)) return 'ai';
  if (/human[- ]?reviewer|review-gate:\s*human|human-reviewed/i.test(text)) return 'human';
  return 'unknown';
}

export function scanCommits(logText) {
  const lines = (logText || '').split('\n');
  const commits = [];
  let current = null;
  for (const line of lines) {
    if (/^[0-9a-f]{7,40} /.test(line)) {
      if (current) commits.push(current);
      const space = line.indexOf(' ');
      current = {
        sha: line.slice(0, space),
        subject: line.slice(space + 1),
        pr: extractPrNumber(line.slice(space + 1)),
      };
    }
  }
  if (current) commits.push(current);
  return commits.filter((c) => isRevertCommit(c.subject) || isFixCommit(c.subject));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const out = execFileSync('git', ['log', '--format=%H %s', '-n', '200'], { encoding: 'utf8' });
  const found = scanCommits(out);
  console.log(JSON.stringify(found, null, 2));
}
