import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('AGENTS.md and pr-cairn agree that agents never add needs-decision', () => {
  for (const file of ['AGENTS.md', '.claude/skills/pr-cairn/SKILL.md']) {
    const guidance = readFileSync(file, 'utf8');
    assert.ok(!guidance.includes('--add-label needs-decision'), file);
    assert.match(guidance, /[Nn]ever add the `needs-decision` label/, file);
    assert.match(guidance, /already on[^\n]*keeps pr-evidence red and disarms auto-merge/, file);
    assert.match(
      guidance,
      /only payments, the owner's own credentials and the steps [^\n]*routes to a person go to the owner/,
      file,
    );
    assert.ok(guidance.includes('gh pr merge <n> --disable-auto'), file);
    if (file === 'AGENTS.md') {
      assert.ok(guidance.includes('CAIRN_DECIDED=1'), file);
    }
  }
});

test('active docs never tell agents to add needs-decision', () => {
  for (const file of [
    'AGENTS.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/pr-review.md',
    'docs/spec/28-bootstrap-closed-loop-self-authored-self-merged.md',
  ]) {
    const guidance = readFileSync(file, 'utf8');
    assert.ok(!guidance.includes('--add-label needs-decision'), file);
    assert.doesNotMatch(guidance, /(?<![Nn]ever )\badd(?:s|ing)? (?:the )?`needs-decision`/, file);
  }
});

test('documented preparation overrides inherited bot author and committer identities', () => {
  const guidance = readFileSync('docs/ops/agent-bot-identity.md', 'utf8');
  const preparation = guidance.split('## Commit preparation\n')[1].split('## Recovery')[0];
  const recipe = preparation.match(/```sh\n([\s\S]*?)```/)[1];
  const directory = mkdtempSync(join(tmpdir(), 'cairn-preparation-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try {
    assert.equal(spawnSync('git', ['init', directory], { env }).status, 0);
    assert.equal(
      spawnSync(
        'git',
        [
          '-c',
          'user.name=Baseline',
          '-c',
          'user.email=baseline@example.invalid',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '--allow-empty',
          '-m',
          'baseline',
        ],
        { cwd: directory, env },
      ).status,
      0,
    );
    assert.equal(
      spawnSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: directory, env })
        .status,
      0,
    );
    writeFileSync(join(directory, 'COMMIT_MSG.txt'), 'Preparation fixture\n');
    for (const inherited of ['AUTHOR', 'COMMITTER', 'BOTH']) {
      const botEnv = { ...env };
      for (const role of ['AUTHOR', 'COMMITTER']) {
        if (inherited === role || inherited === 'BOTH') {
          botEnv[`GIT_${role}_NAME`] = 'cairnwright[bot]';
          botEnv[`GIT_${role}_EMAIL`] = '347615582+cairnwright[bot]@users.noreply.github.com';
        }
      }
      writeFileSync(join(directory, 'COMMIT_MSG.txt'), `Preparation fixture ${inherited}\n`);
      const restaged = spawnSync('git', ['add', 'COMMIT_MSG.txt'], { cwd: directory, env });
      assert.equal(restaged.status, 0);
      const result = spawnSync('bash', ['-e', '-c', recipe], {
        cwd: directory,
        env: botEnv,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const identity = spawnSync('git', ['log', '-1', '--format=%an <%ae>|%cn <%ce>'], {
        cwd: directory,
        env,
        encoding: 'utf8',
      });
      const expected = 'Cairnwright <348051526+cairnwright@users.noreply.github.com>';
      assert.equal(identity.stdout.trim(), `${expected}|${expected}`, inherited);
      assert.ok(result.stdout.includes(`author: ${expected}`), result.stdout);
      assert.ok(result.stdout.includes(`committer: ${expected}`), result.stdout);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('identity wrappers are explicitly excluded from commit preparation', () => {
  const guidance = readFileSync('docs/ops/agent-bot-identity.md', 'utf8');
  assert.match(guidance, /Do not prepare commits with `as-bot\.sh` or `as-bot-author\.sh`/);
  assert.doesNotMatch(guidance, /as-bot(?:-author)?\.sh\s+git\s+commit\b/);
});

for (const file of ['.claude/skills/pr-cairn/SKILL.md', 'docs/ops/agent-bot-identity.md']) {
  test(`${file} recovers through a compliant push without rewriting main`, () => {
    const guidance = readFileSync(file, 'utf8');
    assert.match(guidance, /subsequent compliant push[^\n]*BEFORE_SHA\.\.HEAD/);
    assert.match(guidance, /Preserve main history/);
    assert.match(guidance, /neither[^\n]*author name nor email[^\n]*cairnwright\[bot\]/);
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
