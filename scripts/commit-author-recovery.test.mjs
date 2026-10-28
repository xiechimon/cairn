import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('recovery regression is run by the trusted main workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/commit-author.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /if: github.event_name == 'push'\n {8}run: node --test[^\n]*scripts\/commit-author-recovery.test.mjs/,
  );
});

test('incident recovery preserves trailers and history while passing the actual push check', () => {
  const guidance =
    readFileSync(new URL('../docs/ops/agent-bot-identity.md', import.meta.url), 'utf8').split(
      '## Incident recovery commit preparation',
    )[1] ?? '';
  const recipe = guidance.match(/```sh\n([\s\S]*?)```/)?.[1];
  assert.ok(recipe, 'Operational guidance must contain the recovery recipe');
  const workflow = readFileSync(
    new URL('../.github/workflows/commit-author.yml', import.meta.url),
    'utf8',
  );
  const shell = workflow.split('        run: |\n')[1].replace(/^ {10}/gm, '');
  const cwd = mkdtempSync(join(tmpdir(), 'cairn-recovery-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  const botEnv = {
    ...env,
    GIT_AUTHOR_NAME: 'cairnwright[bot]',
    GIT_AUTHOR_EMAIL: '347615582+cairnwright[bot]@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'cairnwright[bot]',
    GIT_COMMITTER_EMAIL: '347615582+cairnwright[bot]@users.noreply.github.com',
  };
  try {
    for (const args of [
      ['init', '--quiet'],
      ['config', '--local', 'user.name', 'Fixture Reader'],
      ['config', '--local', 'user.email', 'fixture@example.invalid'],
      ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'historical violation'],
    ]) {
      const result = spawnSync('git', args, { cwd, env: botEnv, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    for (const key of ['user.name', 'user.email']) {
      const configured = spawnSync('git', ['config', '--local', '--get', key], {
        cwd,
        env,
        encoding: 'utf8',
      });
      assert.equal(configured.status, 0, `Missing fixture identity: ${key}`);
      assert.ok(configured.stdout.trim());
    }
    const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, env, encoding: 'utf8' });
    assert.equal(before.status, 0, before.stderr);
    const historical = spawnSync('git', ['cat-file', 'commit', 'HEAD'], {
      cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(historical.status, 0, historical.stderr);
    const message =
      'Recovery fixture\n\nCo-authored-by: Contributor <contributor@example.invalid>\n';
    writeFileSync(join(cwd, 'COMMIT_MSG.txt'), message);
    const staged = spawnSync('git', ['add', 'COMMIT_MSG.txt'], { cwd, env, encoding: 'utf8' });
    assert.equal(staged.status, 0, staged.stderr);
    const prepared = spawnSync('bash', ['-e', '-c', recipe], {
      cwd,
      env: botEnv,
      encoding: 'utf8',
    });
    assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
    const metadata = spawnSync('git', ['log', '-1', '--format=%an <%ae>|%cn <%ce>%n%B'], {
      cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(metadata.status, 0, metadata.stderr);
    const identity = 'Cairnwright <348051526+cairnwright@users.noreply.github.com>';
    assert.equal(metadata.stdout.trim(), `${identity}|${identity}\n${message.trim()}`);
    const preserved = spawnSync('git', ['cat-file', 'commit', 'HEAD^'], {
      cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(preserved.status, 0, preserved.stderr);
    assert.equal(preserved.stdout, historical.stdout);
    for (const [previous, expected] of [
      [before.stdout.trim(), 0],
      ['', 0],
    ]) {
      const check = spawnSync('bash', ['-e', '-c', shell], {
        cwd,
        env: { ...env, BASE_SHA: '', BEFORE_SHA: previous },
        encoding: 'utf8',
      });
      assert.equal(check.status, expected, check.stdout + check.stderr);
    }
    const rerun = spawnSync('bash', ['-e', '-c', shell.replaceAll('HEAD', before.stdout.trim())], {
      cwd,
      env: { ...env, BASE_SHA: '', BEFORE_SHA: '' },
      encoding: 'utf8',
    });
    assert.equal(rerun.status, 1, rerun.stdout + rerun.stderr);
    assert.match(rerun.stdout, /::error::/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
