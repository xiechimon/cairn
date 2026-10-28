import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const file of [
  'AGENTS.md',
  '.claude/skills/pr-cairn/SKILL.md',
  'docs/ops/agent-bot-identity.md',
]) {
  test(`${file} separates bot rebase from human squash`, () => {
    const guidance = readFileSync(file, 'utf8');
    assert.match(guidance, /Bot-opened PRs[^\n]*one commit authored by `Cairnwright`[^\n]*rebase/);
    assert.match(guidance, /Human-opened PRs[^\n]*`gh pr merge <n> --squash --auto`/);
    assert.doesNotMatch(guidance, /Arm auto-merge \(`gh pr merge <n> --squash --auto`\)/);
    assert.match(guidance, /~\/.cairn\/tools\/merge-pr\.sh/);
    if (file === 'AGENTS.md') {
      assert.doesNotMatch(guidance, /After removal, re-arm auto-merge with/);
      assert.match(guidance, /gh pr view <n> --json author,commits/);
      assert.match(guidance, /helper is unavailable[^\n]*dispatcher/);
      assert.match(guidance, /neither its author name nor email contains `cairnwright\[bot\]`/);
    }
  });
}

test('the workflow rejects bot authors and accepts Cairnwright and human authors', () => {
  const workflow = readFileSync('.github/workflows/commit-author.yml', 'utf8');
  const shell = workflow.split('        run: |\n')[1].replace(/^ {10}/gm, '');
  const directory = mkdtempSync(join(tmpdir(), 'cairn-author-policy-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try {
    const init = spawnSync('git', ['init', directory], { env, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const baseline = spawnSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'baseline'],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...env,
          GIT_AUTHOR_NAME: 'Baseline',
          GIT_AUTHOR_EMAIL: 'baseline@example.invalid',
          GIT_COMMITTER_NAME: 'Baseline',
          GIT_COMMITTER_EMAIL: 'baseline@example.invalid',
        },
      },
    );
    assert.equal(baseline.status, 0, baseline.stderr);
    const base = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
      env,
    });
    assert.equal(base.status, 0, base.stderr);
    for (const [name, email, expected] of [
      ['cairnwright[bot]', '347615582+cairnwright[bot]@users.noreply.github.com', 1],
      ['Cairnwright', 'cairnwright@example.invalid', 0],
      ['Human', 'human@example.invalid', 0],
    ]) {
      const reset = spawnSync('git', ['reset', '--quiet', '--hard', base.stdout.trim()], {
        cwd: directory,
        encoding: 'utf8',
        env,
      });
      assert.equal(reset.status, 0, reset.stderr);
      const commit = spawnSync(
        'git',
        ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'identity fixture'],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...env,
            GIT_AUTHOR_NAME: name,
            GIT_AUTHOR_EMAIL: email,
            GIT_COMMITTER_NAME: name,
            GIT_COMMITTER_EMAIL: email,
          },
        },
      );
      assert.equal(commit.status, 0, commit.stderr);
      const check = spawnSync('bash', ['-e', '-c', shell], {
        cwd: directory,
        env: { ...env, BASE_SHA: base.stdout.trim() },
        encoding: 'utf8',
      });
      assert.equal(check.status, expected, check.stdout + check.stderr);
      assert.ok(check.stdout.includes(`author: ${name} <${email}>`));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
