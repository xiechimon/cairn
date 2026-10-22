// Round 5 mutation driver: for each mutation, replace one exact string in one
// source file (must occur exactly once), run the intake tests, record the
// summary and the failing test names, then write the saved content back.
// Usage: node docs/verify/1406/p5a1-r5-mutate.mjs <worktree> <mutations.json> <out.txt>
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [worktree, specPath, outPath] = process.argv.slice(2);
const mutations = JSON.parse(readFileSync(specPath, 'utf8'));
const testFiles = ['apps/server/test/issue-intake.test.ts'];

function out(line) {
  appendFileSync(outPath, `${line}\n`);
}

for (const m of mutations) {
  const file = join(worktree, m.file);
  const saved = readFileSync(file, 'utf8');
  const count = saved.split(m.find).length - 1;
  out(`## ${m.id}: ${m.desc}`);
  out(`file: ${m.file}`);
  out(`replace: ${JSON.stringify(m.find)}`);
  out(`   with: ${JSON.stringify(m.replace)}`);
  if (count !== 1) {
    out(`result: SKIPPED, find string occurs ${count} times`);
    continue;
  }
  writeFileSync(file, saved.replace(m.find, m.replace));
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
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const files = /Test Files\s+([^\n]+)/.exec(text)?.[1]?.trim() ?? '?';
  const tests = /\n\s+Tests\s+([^\n]+)/.exec(text)?.[1]?.trim() ?? '?';
  const red = res.status !== 0;
  out(`result: exit ${res.status}, Test Files  ${files} ; Tests  ${tests}  -> ${red ? 'RED' : 'GREEN (mutation survived)'}`);
  const failed = new Set();
  for (const line of text.split('\n')) {
    const hit = /^\s*×\s+\|[^|]+\|\s+(.*?)(?:\s+\d+ms)?$/.exec(line);
    if (hit) failed.add(hit[1]);
  }
  for (const name of failed) out(`  FAIL  ${name}`);
  if (Array.isArray(m.watch)) {
    for (const name of m.watch) {
      const passed = text.split('\n').some((l) => /^\s*✓/.test(l) && l.includes(name));
      const fail = [...failed].some((f) => f.includes(name));
      out(`  watched: ${fail ? 'FAIL' : passed ? 'pass' : 'not run'}  ${name}`);
    }
  }
}
const status = execFileSync('git', ['-C', worktree, 'status', '--short'], { encoding: 'utf8' });
out('git status --short after the last mutation (source files restored):');
out(status.trim() === '' ? '  (clean)' : status.replace(/^/gm, '  ').trimEnd());
