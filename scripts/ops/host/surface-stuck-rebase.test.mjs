import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ops/host/tools/overnight/surface-stuck-rebase.sh');
const driver = resolve('scripts/ops/host/tools/overnight/driver.sh');

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function lane(t, { fails, botFails = false }) {
  const home = mkdtempSync(join(tmpdir(), 'stuck-rebase-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, 'lanes/cairn-2420');
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  write(repo, 'apps/web/src/i18n/en.ts', "export const EN = {\n  quota: '{count} tasks',\n};\n");
  write(repo, 'apps/web/test/i18n-coverage.test.ts', "describe('base', () => {});\n");
  write(repo, 'README.md', 'base\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('switch', '-q', '-c', 'lane/2420');
  write(
    repo,
    'apps/web/src/i18n/en.ts',
    "export const EN = {\n  quota: '{count## task|# tasks}',\n};\n",
  );
  write(
    repo,
    'apps/web/test/i18n-coverage.test.ts',
    "describe('English plural coverage', () => {});\n",
  );
  git('commit', '-q', '-am', 'web(2420): plurals');
  git('switch', '-q', 'main');
  write(
    repo,
    'apps/web/src/i18n/en.ts',
    "export const EN = {\n  quota: '{count#1 task|# tasks}',\n};\n",
  );
  write(
    repo,
    'apps/web/test/i18n-coverage.test.ts',
    "describe('translation call coverage', () => {});\n",
  );
  write(repo, 'README.md', 'main moved\n');
  git('commit', '-q', '-am', 'main moves');
  git('update-ref', 'refs/remotes/origin/main', 'main');
  git('switch', '-q', 'lane/2420');
  const calls = join(home, 'calls');
  writeFileSync(calls, '');
  write(
    home,
    '.cairn/tools/app-token/as-bot.sh',
    `#!/bin/sh\nprintf '%s\\036' "$*" >> "${calls}"\n${botFails ? 'exit 1' : 'exit 0'}\n`,
  );
  chmodSync(join(home, '.cairn/tools/app-token/as-bot.sh'), 0o755);
  const stamp = join(home, 'rebase-2420-head');
  writeFileSync(stamp, '');
  if (fails) writeFileSync(`${stamp}.fail`, 'x\n'.repeat(fails));
  const run = (...args) =>
    spawnSync('bash', [script, '2420', stamp, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
  const bot = () => readFileSync(calls, 'utf8').split('\x1e').filter(Boolean);
  return { run, bot, surfaced: () => existsSync(`${stamp}.surfaced`) };
}

test('an exhausted rebase worker labels the PR stale-pr and names the conflicting files (#2441)', (t) => {
  const f = lane(t, { fails: 3 });
  const result = f.run('2441');
  assert.equal(result.status, 0, result.stderr);
  const [label, comment] = f.bot();
  assert.equal(label, 'gh pr edit 2441 -R xiechimon/cairn --add-label stale-pr');
  assert.match(comment, /^gh pr comment 2441 -R xiechimon\/cairn --body /);
  assert.match(comment, /failed 3 times/);
  assert.match(comment, /`apps\/web\/src\/i18n\/en\.ts`/);
  assert.match(comment, /`apps\/web\/test\/i18n-coverage\.test\.ts`/);
  assert.doesNotMatch(comment, /README\.md/);
  assert.equal(f.surfaced(), true);
});

test('it surfaces once per stuck head', (t) => {
  const f = lane(t, { fails: 3 });
  f.run('2441');
  f.run('2441');
  assert.equal(f.bot().length, 2);
});

test('fewer than three worker failures stay silent', (t) => {
  const f = lane(t, { fails: 2 });
  assert.equal(f.run('2441').status, 0);
  assert.deepEqual(f.bot(), []);
  assert.equal(f.surfaced(), false);
});

test('without a PR the issue gets the comment', (t) => {
  const f = lane(t, { fails: 3 });
  f.run();
  const calls = f.bot();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^gh issue comment 2420 -R xiechimon\/cairn --body /);
});

test('a failed GitHub write is retried on the next pass', (t) => {
  const f = lane(t, { fails: 3, botFails: true });
  assert.equal(f.run('2441').status, 1);
  assert.equal(f.surfaced(), false);
});

test('the driver surfaces a stuck lane instead of skipping it silently', () => {
  const text = readFileSync(driver, 'utf8');
  assert.match(
    text,
    /\[ -e \$f \] && \{ ~\/\.cairn\/tools\/overnight\/surface-stuck-rebase\.sh \$n \$f \$pr 9>&-; continue; \}/,
  );
  const rebase = text.slice(
    text.indexOf('f=$ST/rebase-$n-'),
    text.indexOf('rebase conflict -> worker'),
  );
  assert.ok(rebase.length > 0);
  assert.doesNotMatch(rebase, /&& continue; touch/);
});
