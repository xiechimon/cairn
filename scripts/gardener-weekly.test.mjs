import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { PATTERNS, rankBaselines } from './gardener-weekly.mjs';

const script = resolve(import.meta.dirname, 'gardener-weekly.mjs');
const NOW = '2026-10-24T12:00:00Z';
const daysAgo = (days) => new Date(Date.parse(NOW) - days * 86400000).toISOString();

const allowlist = (n) =>
  Array.from({ length: n }, (_, i) => ({ path: 'a.ts', line: `// ${i}`, reason: 'external' }));
const baselineFiles = ({ warnings, controls, comments }) => ({
  'scripts/lint-warning-baseline.json': { maxWarnings: warnings },
  'scripts/ui-debt-baseline.json': {
    perFaceCss: { 'a.css': 10 },
    rawControls: { total: controls, files: {} },
    arbitraryValues: { textTotal: 5, spacingTotal: 1, files: {} },
  },
  'scripts/comment-discipline-allowlist.json': allowlist(comments),
});

const fixture = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gardener-'));
  const git = (date, ...args) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  git(daysAgo(30), 'init', '-b', 'main');
  git(daysAgo(30), 'config', 'user.email', 'test@example.com');
  git(daysAgo(30), 'config', 'user.name', 'Test');
  return {
    cwd,
    commit: (date, tree, message = 'change') => {
      for (const [path, content] of Object.entries(tree)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(
          join(cwd, path),
          typeof content === 'string' ? content : JSON.stringify(content),
        );
      }
      git(date, 'add', '.');
      git(date, 'commit', '-m', message);
    },
    run: (...args) =>
      spawnSync(process.execPath, [script, '--now', NOW, ...args], { cwd, encoding: 'utf8' }),
  };
};

test('ranks growth by the 7-day delta and stock by current count', () => {
  const ranked = rankBaselines([
    { id: 'a', label: 'A', count: 50, delta: 0 },
    { id: 'b', label: 'B', count: 10, delta: 4 },
    { id: 'c', label: 'C', count: 20, delta: 9 },
    { id: 'd', label: 'D', count: 2, delta: -3 },
  ]);
  assert.deepEqual(
    ranked.byGrowth.map((m) => m.id),
    ['c', 'b', 'a', 'd'],
  );
  assert.deepEqual(
    ranked.byStock.map((m) => m.id),
    ['a', 'c', 'b', 'd'],
  );
});

test('report lists every category with its 7-day change, sorted, and writes the summary file', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit(daysAgo(20), baselineFiles({ warnings: 0, controls: 3, comments: 2 }));
    commit(daysAgo(3), baselineFiles({ warnings: 0, controls: 3, comments: 7 }));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    for (const id of [
      'lint-warning/warnings',
      'ui-debt/per-face-css-lines',
      'ui-debt/bare-controls',
      'ui-debt/arbitrary-text',
      'ui-debt/arbitrary-spacing',
      'comment-discipline-allowlist/entries',
    ])
      assert.ok(result.stdout.includes(id), id);
    const growth = result.stdout.split('## By growth')[1].split('## By stock')[0];
    assert.match(growth, /1\. comment-discipline-allowlist\/entries\s*\|\s*7\s*\|\s*\+5/);
    const stock = result.stdout.split('## By stock')[1];
    assert.match(stock, /1\. ui-debt\/per-face-css-lines\s*\|\s*10\s*\|\s*0/);
    assert.match(stock, /2\. comment-discipline-allowlist\/entries/);
    assert.match(result.stdout, /Next target: comment-discipline-allowlist\/entries/);
    const summary = readFileSync(join(cwd, '.gardener/weekly-2026-10-24.md'), 'utf8');
    assert.equal(summary, result.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a baseline file born inside the window reports its whole count as growth', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit(daysAgo(20), { 'README.md': 'x' });
    commit(daysAgo(2), baselineFiles({ warnings: 0, controls: 3, comments: 2 }));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ui-debt\/bare-controls\s*\|\s*3\s*\|\s*\+3/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('refuses a shallow clone, whose history would fake every delta as growth', () => {
  const { cwd, commit } = fixture();
  const clone = join(cwd, 'shallow');
  try {
    commit(daysAgo(20), baselineFiles({ warnings: 0, controls: 3, comments: 2 }));
    commit(daysAgo(1), { 'README.md': 'x' });
    execFileSync('git', ['clone', '--depth', '1', `file://${cwd}`, clone], { stdio: 'pipe' });
    const result = spawnSync(process.execPath, [script, '--now', NOW], {
      cwd: clone,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /shallow/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const quiet = { warnings: 0, controls: 3, comments: 2 };
const sites = (name, count) =>
  Array.from({ length: count }, (_, i) => `const v${i} = load() as unknown as ${name};`).join('\n');

test('a write pattern added 3+ times in the window with no gate becomes a candidate ticket', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit(daysAgo(20), { ...baselineFiles(quiet), 'apps/server/src/old.ts': sites('Old', 5) });
    commit(daysAgo(2), { 'apps/server/src/new.ts': sites('Fresh', 3) });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const candidates = result.stdout.split('## Candidate tickets')[1];
    assert.match(candidates, /double-cast/);
    assert.match(candidates, /apps\/server\/src\/new\.ts:1/);
    assert.match(candidates, /apps\/server\/src\/new\.ts:3/);
    assert.ok(!candidates.includes('apps/server/src/old.ts'));
    assert.match(candidates, /not filed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('two new sites stay below the threshold and write no candidate', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit(daysAgo(20), baselineFiles(quiet));
    commit(daysAgo(2), { 'apps/server/src/new.ts': sites('Fresh', 2) });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.split('## Candidate tickets')[1], /none/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a pattern that a gate already covers never becomes a candidate', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit(daysAgo(20), baselineFiles(quiet));
    commit(daysAgo(2), {
      'apps/server/src/new.ts': Array.from({ length: 4 }, (_, i) => `let v${i}: any;`).join('\n'),
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.split('## Candidate tickets')[1], /none/);
    assert.ok(PATTERNS.some((p) => p.id === 'explicit-any' && p.gate));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the watchlist patterns compile and each has a suggested rule when ungated', () => {
  for (const pattern of PATTERNS) {
    assert.ok(new RegExp(pattern.regex).source);
    assert.ok(pattern.gate || pattern.suggestedRule, pattern.id);
  }
});

test('with --drift the report appends the spec/ADR drift section and writes the JSON', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit(daysAgo(20), baselineFiles(quiet));
    commit(
      daysAgo(2),
      {
        'docs/adr/0001-test.md': 'Line one\nSee `apps/server/src/services/gone.ts`.\n',
        'apps/server/src/services/gone.ts': 'export const gone = true;\n',
      },
      'add doc',
    );
    execFileSync('git', ['rm', '-q', 'apps/server/src/services/gone.ts'], { cwd });
    execFileSync('git', ['commit', '-m', 'delete gone'], {
      cwd,
      env: { ...process.env, GIT_AUTHOR_DATE: daysAgo(1), GIT_COMMITTER_DATE: daysAgo(1) },
    });
    const result = run('--drift', '--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /## Spec\/ADR drift at HEAD/);
    assert.match(
      result.stdout,
      /\| docs\/adr\/0001-test\.md \| `apps\/server\/src\/services\/gone\.ts` \| path \| 2 \|/,
    );
    const driftJson = readFileSync(join(cwd, '.gardener', 'drift-2026-10-24.json'), 'utf8');
    assert.deepEqual(JSON.parse(driftJson), [
      {
        doc: 'docs/adr/0001-test.md',
        name: 'apps/server/src/services/gone.ts',
        kind: 'path',
        line: 2,
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
