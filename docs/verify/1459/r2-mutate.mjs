// #1459 round 2 mutation driver: each mutation applies one or more exact
// string edits to one source file (each `find` must occur exactly once, or
// with all: true at least once), runs the webhook / intake / github-issues
// tests, records the summary, the failing tests and the watched tests, then
// writes the saved file content back. Ends with `git status --short`.
// Usage: node docs/verify/1459/r2-mutate.mjs <worktree> <mutations.json> <out.txt>
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [worktree, specPath, outPath] = process.argv.slice(2);
const mutations = JSON.parse(readFileSync(specPath, 'utf8'));
const testFiles = [
  'apps/server/test/webhook.test.ts',
  'apps/server/test/issue-intake.test.ts',
  'apps/server/test/github-issues.test.ts',
];

function out(line) {
  appendFileSync(outPath, `${line}\n`);
}

for (const m of mutations) {
  const file = join(worktree, m.file);
  const saved = readFileSync(file, 'utf8');
  out(`## ${m.id}: ${m.desc}`);
  out(`file: ${m.file}`);
  let text = saved;
  let ok = true;
  for (const e of m.edits) {
    const count = text.split(e.find).length - 1;
    out(`  replace${e.all ? ' (all)' : ''}: ${JSON.stringify(e.find)}`);
    out(`     with: ${JSON.stringify(e.replace)}`);
    if (e.all ? count < 1 : count !== 1) {
      out(`result: SKIPPED, find string occurs ${count} times`);
      ok = false;
      break;
    }
    text = e.all ? text.split(e.find).join(e.replace) : text.replace(e.find, e.replace);
  }
  if (!ok) continue;
  writeFileSync(file, text);
  let res;
  try {
    res = spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', ...testFiles], {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
    });
  } finally {
    writeFileSync(file, saved);
  }
  const all = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const files = /Test Files\s+([^\n]+)/.exec(all)?.[1]?.trim() ?? '?';
  const tests = /\n\s+Tests\s+([^\n]+)/.exec(all)?.[1]?.trim() ?? '?';
  out(
    `result: exit ${res.status}, Test Files  ${files} ; Tests  ${tests}  -> ${res.status !== 0 ? 'RED' : 'GREEN (mutation survived)'}`,
  );
  const failed = new Set();
  for (const line of all.split('\n')) {
    const hit = /^\s*×\s+\|[^|]+\|\s+(.*?)(?:\s+\d+ms)?$/.exec(line);
    if (hit) failed.add(hit[1]);
  }
  for (const name of failed) out(`  FAIL  ${name}`);
  for (const name of m.watch ?? []) {
    const fail = [...failed].some((f) => f.includes(name));
    const pass = all.split('\n').some((l) => /^\s*✓/.test(l) && l.includes(name));
    out(`  watched: ${fail ? 'FAIL' : pass ? 'pass' : 'not run'}  ${name}`);
  }
}
const status = execFileSync('git', ['-C', worktree, 'status', '--short'], { encoding: 'utf8' });
out('git status --short after the last mutation (source files restored):');
out(status.trim() === '' ? '  (clean)' : status.replace(/^/gm, '  ').trimEnd());
