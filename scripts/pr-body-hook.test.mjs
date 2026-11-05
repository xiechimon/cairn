import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, tokenize } from './pr-body-hook.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/pr-body-hook/', import.meta.url));
const PASS = readFileSync(join(FIXTURES, 'pass-2553.md'), 'utf8');
const SECTION_LIST = /^Same 6 section headers: .*$/m;
const FAIL = PASS.replace(SECTION_LIST, (line) => line.replaceAll('`', ''));
const dir = mkdtempSync(join(tmpdir(), 'pr-body-hook-test-'));
writeFileSync(join(dir, 'pass.md'), PASS);
writeFileSync(join(dir, 'fail.md'), FAIL);
writeFileSync(join(dir, 'fail.json'), JSON.stringify({ body: FAIL }));

const bash = (command) => decide({ tool_name: 'Bash', tool_input: { command }, cwd: dir });
const quoteSingle = (body) => `'${body.replaceAll("'", `'\\''`)}'`;
const heredoc = (body) => `"$(cat <<'EOF'\n${body}\nEOF\n)"`;

test('#2553: the original body with unquoted Chinese section names is blocked', () => {
  const result = bash('gh pr create --title t --body-file fail.md');
  assert.equal(result.block, true);
  assert.match(result.reason, /english-only-gate/);
});

test('#2553: the corrected body passes', () => {
  assert.equal(bash(`gh pr create --title t --body-file ${join(dir, 'pass.md')}`).block, false);
});

test('gh pr edit with -F, --body-file= and -b forms are all checked', () => {
  assert.equal(bash('gh pr edit 12 -F fail.md').block, true);
  assert.equal(bash('gh pr edit 12 --body-file=fail.md').block, true);
  assert.equal(bash(`gh pr edit 12 -b ${quoteSingle(FAIL)}`).block, true);
  assert.equal(bash(`gh pr edit 12 --body ${quoteSingle(PASS)}`).block, false);
});

test('a quoted heredoc command substitution body is checked as literal text', () => {
  assert.equal(bash(`gh pr create --title t --body ${heredoc(FAIL)}`).block, true);
  assert.equal(bash(`gh pr create --title t --body ${heredoc(PASS)}`).block, false);
});

test('a body from a variable, other substitution or stdin is blocked with a --body-file hint', () => {
  for (const command of [
    'gh pr create --body "$BODY"',
    'gh pr edit 3 --body "$(cat fail.md)"',
    'gh pr edit 3 --body-file=$HOME/b.md',
    'gh pr edit 3 --body-file -',
  ]) {
    const result = bash(command);
    assert.equal(result.block, true, command);
    assert.match(result.reason, /--body-file <path>/);
  }
});

test('a missing body file is blocked', () => {
  assert.match(bash('gh pr edit 3 --body-file nope.md').reason, /body file not found/);
});

test('gh api PATCH on a pull with a body field or input file is checked', () => {
  assert.equal(bash('gh api -X PATCH repos/o/r/pulls/7 -F body=@fail.md').block, true);
  assert.equal(
    bash(`gh api --method PATCH repos/o/r/pulls/7 -f body=${quoteSingle(FAIL)}`).block,
    true,
  );
  assert.equal(bash('gh api --method=PATCH repos/o/r/pulls/7 --input fail.json').block, true);
  assert.equal(bash('gh api -X PATCH repos/o/r/pulls/7 -F body=@pass.md').block, false);
  assert.equal(bash('gh api -X PATCH "repos/o/r/pulls/$N" -f body="$BODY"').block, true);
});

test('chained commands are checked per segment', () => {
  assert.equal(bash('cd /tmp && gh pr create --body-file fail.md && echo ok').block, true);
});

test('commands that do not set a PR body pass through', () => {
  for (const command of [
    'git commit -m "提交"',
    'gh pr view 3 --json body',
    'gh issue create --title t --body "中文"',
    'gh pr edit 3 --title "x"',
    'gh pr comment 3 --body "中文"',
    'gh api repos/o/r/pulls/7',
    'gh api -X PATCH repos/o/r/issues/7 -f body="中文"',
    'gh api repos/o/r/pulls/7/comments -f body="中文"',
  ]) {
    assert.equal(bash(command).block, false, command);
  }
  assert.equal(
    decide({ tool_name: 'Edit', tool_input: { command: 'gh pr edit 1 -b 中文' } }).block,
    false,
  );
});

test('bad --input JSON blocks instead of crashing open', () => {
  writeFileSync(join(dir, 'bad.json'), '{bad');
  writeFileSync(join(dir, 'null.json'), 'null');
  assert.match(bash('gh api -X PATCH repos/o/r/pulls/1 --input bad.json').reason, /not valid JSON/);
  assert.equal(bash('gh api -X PATCH repos/o/r/pulls/1 --input null.json').block, false);
});

test('a body file written earlier in the same command is blocked, even if an old copy passes', () => {
  const result = bash(`cat > pass.md <<'EOF'\nhello only\nEOF\ngh pr create --body-file pass.md`);
  assert.equal(result.block, true);
  assert.match(result.reason, /separate Bash call/);
});

test('cd earlier in the command moves where a relative body file resolves', () => {
  assert.equal(bash(`cd / && gh pr edit 1 --body-file ${dir.slice(1)}/fail.md`).block, true);
});

test('attached short flags, global repo flags and gh behind env or a path are checked', () => {
  for (const command of [
    `gh pr create -t x -b${quoteSingle(FAIL)}`,
    'gh pr create -t x -Ffail.md',
    `gh api -XPATCH repos/o/r/pulls/1 -f body=${quoteSingle(FAIL)}`,
    `gh -R o/r pr create --body ${quoteSingle(FAIL)}`,
    `gh --repo=o/r pr edit 1 --body ${quoteSingle(FAIL)}`,
    'GH_REPO=o/r gh pr create --body-file fail.md',
    'env GH_TOKEN=x gh pr edit 1 --body-file fail.md',
    '/opt/homebrew/bin/gh pr edit 1 --body-file fail.md',
  ]) {
    assert.equal(bash(command).block, true, command);
  }
});

test('--fill bodies and GraphQL PR body mutations are blocked', () => {
  for (const command of [
    'gh pr create --fill',
    'gh pr create --fill-first',
    'gh pr create --fill-verbose',
    'gh api graphql -f query="mutation{updatePullRequest(input:{pullRequestId:1,body:2}){clientMutationId}}"',
  ]) {
    assert.equal(bash(command).block, true, command);
  }
  assert.equal(bash('gh api graphql -f query="{viewer{login}}"').block, false);
});

test('an unquoted heredoc that expands variables is treated as dynamic', () => {
  const result = bash('gh pr create --body "$(cat <<EOF\n$X\nEOF\n)"');
  assert.match(result.reason, /--body-file <path>/);
});

test('tokenize keeps single-quoted text literal and marks unquoted expansions', () => {
  assert.deepEqual(tokenize(`a '$X' "b c" d\\ e`), ['a', '$X', 'b c', 'd e']);
  assert.deepEqual(tokenize('a $X'), ['a', { dynamic: '$X' }]);
  assert.deepEqual(tokenize('a&&b|c'), ['a', '&&', 'b', '|', 'c']);
});

test('the hook entry point exits 2 with the reason on stderr', () => {
  const run = spawnSync('node', [fileURLToPath(new URL('./pr-body-hook.mjs', import.meta.url))], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'gh pr edit 1 -F fail.md' },
      cwd: dir,
    }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /english-only-gate/);
  const ok = spawnSync('node', [fileURLToPath(new URL('./pr-body-hook.mjs', import.meta.url))], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0);
});
