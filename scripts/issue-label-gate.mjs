#!/usr/bin/env node
import { execSync } from 'node:child_process';

const CATEGORY = ['bug', 'enhancement'];
const STATE = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
const EXEMPT_PREFIX = 'wayfinder:';
const repo = process.env.GITHUB_REPO || 'xiechimon/cairn';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

let issues;
try {
  issues = JSON.parse(
    run(`gh issue list --repo ${repo} --state open --limit 200 --json number,title,labels`),
  );
} catch (e) {
  console.error('gh issue list failed:', e.message.slice(0, 200));
  process.exit(1);
}

const violations = [];
for (const it of issues) {
  const names = it.labels.map((l) => l.name);
  if (names.some((n) => n.startsWith(EXEMPT_PREFIX))) continue;
  const cats = names.filter((n) => CATEGORY.includes(n));
  const states = names.filter((n) => STATE.includes(n));
  if (cats.length !== 1 || states.length !== 1) {
    violations.push(
      `#${it.number} "${it.title}" — labels=[${names.join(',') || 'none'}] ` +
        `(category ${cats.length}/1, state ${states.length}/1)`,
    );
  }
}

if (violations.length === 0) {
  console.log(`issue-label-gate: OK (${issues.length} open issues, all dual-labeled)`);
  process.exit(0);
}
console.log(
  `issue-label-gate: ${violations.length}/${issues.length} open issues missing dual labels:`,
);
for (const v of violations) console.log(`  - ${v}`);
process.exit(0);
