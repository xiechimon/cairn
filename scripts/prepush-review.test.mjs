import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { prepushPlan } from './prepush.mjs';
import {
  ANSWER_TRAILER,
  carriedLine,
  keyValueSecret,
  MODELS,
  parseHunks,
  parseReply,
  runReview,
} from './prepush-review.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const FAKE_PI = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const input = readFileSync(0, 'utf8');
appendFileSync(join(__dirname, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2), input }) + '\\n');
const reply = readFileSync(join(__dirname, 'reply.txt'), 'utf8');
if (reply === 'hang') setInterval(() => {}, 1000);
else if (reply.startsWith('exit ')) process.exit(Number(reply.slice(5)));
else
  console.log(
    JSON.stringify({ type: 'session' }) +
      '\\n' +
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: reply }] },
      }),
  );
`;

function fixture(run) {
  const directory = makeTestTempDir('cairn-prepush-review-');
  const repo = join(directory, 'repo');
  const tool = join(directory, 'tool');
  mkdirSync(repo);
  mkdirSync(tool);
  const pi = join(tool, 'pi');
  writeFileSync(pi, FAKE_PI);
  chmodSync(pi, 0o755);
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=review-test', '-c', 'user.email=review@example.invalid', ...args],
      { cwd: repo, encoding: 'utf8', stdio: 'pipe' },
    );
  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  const commit = (files, message = 'change') => {
    for (const [path, content] of Object.entries(files)) write(path, content);
    git('add', ...Object.keys(files));
    git('commit', '-m', message);
  };
  git('init', '-b', 'work');
  commit({ 'README.md': 'base\n' }, 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const calls = () =>
    existsSync(join(tool, 'calls.jsonl'))
      ? readFileSync(join(tool, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
      : [];
  const review = (options = {}) => {
    const output = [];
    const status = runReview({
      cwd: repo,
      env: { PREPUSH_REVIEW_PI: pi },
      log: (line) => output.push(line),
      redactionHits: () => [],
      ...options,
    });
    return { status, output: output.join('\n') };
  };
  try {
    run({
      repo,
      git,
      write,
      commit,
      calls,
      review,
      reply: (text) => writeFileSync(join(tool, 'reply.txt'), text),
    });
  } finally {
    releaseTestTempDir(directory);
  }
}

const CLEAN = 'no issues\ncount: 0\n';
const lines = (count, text = 'export const value = 1;') =>
  `${Array.from({ length: count }, (_, index) => `${text} // ${index}`).join('\n')}\n`;

test('a small diff outside guarded paths is not reviewed', () => {
  fixture(({ commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({ 'apps/web/src/small.ts': lines(20) });
    assert.deepEqual(review(), { status: 0, output: '' });
    assert.equal(calls().length, 0);
  });
});

test('a guarded path sends the committed diff once, with no tools and no session', () => {
  fixture(({ commit, write, review, reply, calls }) => {
    reply(CLEAN);
    commit({ 'scripts/tool.mjs': 'export const committed = 1;\n' });
    write('scripts/tool.mjs', 'export const committed = 1;\nexport const unstaged = 2;\n');
    write('scripts/untracked.mjs', 'export const untracked = 3;\n');
    const result = review();
    assert.equal(result.status, 0);
    assert.match(result.output, /prepush-review: count: 0 \(path scripts\/tool\.mjs\)/);
    const [call, ...rest] = calls();
    assert.equal(rest.length, 0);
    for (const flag of ['--no-session', '--no-tools', '--no-context-files', '-p'])
      assert.ok(call.args.includes(flag), flag);
    assert.equal(call.args[call.args.indexOf('--model') + 1], MODELS[0]);
    assert.match(call.input, /=== scripts\/tool\.mjs\n\+1\texport const committed = 1;/);
    assert.doesNotMatch(call.input, /unstaged|untracked/);
  });
});

test('more than 300 counted lines trigger a review and test lines do not count', () => {
  fixture(({ commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({ 'apps/web/src/big.test.ts': lines(400) });
    assert.equal(review().output, '');
    commit({ 'apps/web/src/big.ts': lines(301) });
    assert.match(review().output, /count: 0 \(301 counted lines\)/);
    assert.equal(calls().length, 1);
    assert.doesNotMatch(calls()[0].input, /big\.test\.ts/);
  });
});

test('a model failure prints skipped, exits 0 and keeps the head unreviewed', () => {
  fixture(({ repo, commit, review, reply, calls }) => {
    commit({ 'scripts/tool.mjs': 'export const value = 1;\n' });
    const missing = review({ env: { PREPUSH_REVIEW_PI: join(repo, 'no-such-pi') } });
    assert.deepEqual(missing, {
      status: 0,
      output: 'prepush-review: skipped (pi missing)',
    });
    reply('exit 3');
    assert.match(review().output, new RegExp(`skipped \\(${MODELS.at(-1)}: exit 3\\)`));
    assert.deepEqual(
      calls().map((call) => call.args[call.args.indexOf('--model') + 1]),
      MODELS,
    );
    reply('looks fine to me');
    assert.match(review().output, /skipped \(.*: no count line\)/);
    reply('count: 0');
    assert.match(review().output, /skipped \(.*: no count line\)/);
    reply('hang');
    const started = Date.now();
    const hung = review({ timeCapMs: 500 });
    assert.deepEqual([hung.status, /skipped \(timeout\)/.test(hung.output)], [0, true]);
    assert.ok(Date.now() - started < 20_000);
    assert.equal(existsSync(join(repo, '.git/prepush-review.json')), false);
  });
});

test('a finding outside the sent diff is dropped and does not block', () => {
  fixture(({ commit, review, reply }) => {
    commit({ 'scripts/tool.mjs': 'export const value = 1;\n' });
    reply(
      'scripts/tool.mjs:40: null-deref: value can be null.\nscripts/other.mjs:1: race: x.\ncount: 2\n',
    );
    assert.deepEqual(review(), {
      status: 0,
      output: 'prepush-review: count: 0 (path scripts/tool.mjs)',
    });
  });
});

test('a finding blocks until its line changes or a trailer answers it', () => {
  fixture(({ git, commit, review, reply, calls }) => {
    const body = `${lines(30)}export const two = one.missing.value;\n`;
    commit({ 'scripts/tool.mjs': body });
    reply('scripts/tool.mjs:31: null-deref: one.missing is undefined.\ncount: 1\n');
    const blocked = review();
    assert.equal(blocked.status, 1);
    assert.match(blocked.output, /scripts\/tool\.mjs:31: null-deref: one\.missing is undefined\./);
    assert.match(blocked.output, new RegExp(`${ANSWER_TRAILER}: <path>: <bug-class>: <reason>`));

    reply(CLEAN);
    assert.equal(review().status, 1);
    assert.equal(calls().length, 1);

    commit({ 'scripts/tool.mjs': `export const zero = 0;\n${body}` });
    const shifted = review();
    assert.equal(shifted.status, 1);
    assert.match(shifted.output, /scripts\/tool\.mjs:32: null-deref/);
    assert.match(
      calls().at(-1).input,
      /Already reported, do not report again:\nscripts\/tool\.mjs:32: null-deref/,
    );

    git(
      'commit',
      '--allow-empty',
      '-m',
      'answer',
      '--trailer',
      `${ANSWER_TRAILER}: scripts/tool.mjs: Null Deref: one is a fixture`,
    );
    assert.deepEqual(review(), {
      status: 0,
      output: 'prepush-review: count: 0 (path scripts/tool.mjs)',
    });
  });
});

test('changing the reported line clears the finding and sends only the delta', () => {
  fixture(({ commit, review, reply, calls }) => {
    commit({ 'scripts/tool.mjs': `${lines(30)}export const two = one.missing.value;\n` });
    reply('scripts/tool.mjs:31: null-deref: one.missing is undefined.\ncount: 1\n');
    assert.equal(review().status, 1);
    reply(CLEAN);
    commit({ 'scripts/tool.mjs': `${lines(30)}export const two = one.missing?.value;\n` });
    assert.equal(review().status, 0);
    const delta = calls().at(-1).input;
    assert.match(delta, /\+31\texport const two = one\.missing\?\.value;/);
    assert.doesNotMatch(delta, /\/\/ 3\n/);
    assert.doesNotMatch(delta, /scripts\/tool\.mjs:31: null-deref/);
  });
});

test('an oversized diff sends guarded hunks first, prints truncated and does not block', () => {
  fixture(({ commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({
      'apps/web/src/big.ts': lines(400, `export const value = '${'x'.repeat(300)}';`),
      'scripts/tool.mjs': 'export const guarded = 1;\n',
    });
    const result = review();
    assert.equal(result.status, 0);
    assert.match(result.output, /prepush-review: truncated/);
    assert.match(calls()[0].input, /=== scripts\/tool\.mjs/);
    assert.doesNotMatch(calls()[0].input, /big\.ts/);
  });
});

test('a suspected secret withholds its file, is never sent or printed, and does not block', () => {
  fixture(({ commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({
      'scripts/config.yaml': 'password: hunter2\n',
      'scripts/key.mjs': "export const pem = '-----BEGIN RSA PRIVATE KEY-----';\n",
      'scripts/hit.mjs': "export const key = 'shared-pattern-value';\n",
      'scripts/types.ts': 'export interface Session { token: string }\nconst token = bearer(c);\n',
      'scripts/label-cli.mts': 'export interface Options { apiKey: string }\n',
      'scripts/Client.swift': 'let token: String\n',
    });
    const result = review({
      redactionHits: (files) =>
        files.filter((file) => file.text.includes('shared-pattern-value')).map((file) => file.path),
    });
    assert.equal(result.status, 0);
    for (const path of ['scripts/config.yaml', 'scripts/key.mjs', 'scripts/hit.mjs'])
      assert.ok(result.output.includes(`prepush-review: withheld (possible secret) ${path}`), path);
    assert.doesNotMatch(result.output, /hunter2|PRIVATE KEY|shared-pattern-value/);
    const [call] = calls();
    assert.match(
      call.input,
      /=== scripts\/types\.ts\n\+1\texport interface Session \{ token: string \}/,
    );
    assert.match(
      call.input,
      /=== scripts\/label-cli\.mts\n\+1\texport interface Options \{ apiKey: string \}/,
    );
    assert.match(call.input, /=== scripts\/Client\.swift\n\+1\tlet token: String/);
    assert.doesNotMatch(call.input, /hunter2|PRIVATE KEY|shared-pattern-value|config\.yaml/);
  });
});

test('the shared redaction patterns withhold a file through the real scan', () => {
  fixture(({ commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({ 'scripts/leak.mjs': `export const key = 'ghp_${'a'.repeat(36)}';\n` });
    const result = review({ redactionHits: undefined });
    assert.deepEqual(result, {
      status: 0,
      output:
        'prepush-review: withheld (possible secret) scripts/leak.mjs\nprepush-review: count: 0 (path scripts/tool.mjs)'.replace(
          'tool.mjs',
          'leak.mjs',
        ),
    });
    assert.equal(calls().length, 0);
  });
});

test('an unavailable secret scan sends nothing and leaves the head unreviewed', () => {
  fixture(({ repo, commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({ 'scripts/tool.mjs': 'export const value = 1;\n' });
    const result = review({ redactionHits: () => null });
    assert.equal(result.status, 0);
    assert.match(result.output, /skipped \(secret scan unavailable\)/);
    assert.equal(calls().length, 0);
    assert.equal(existsSync(join(repo, '.git/prepush-review.json')), false);
  });
});

test('a credential path body is never sent', () => {
  fixture(({ commit, review, reply, calls }) => {
    reply(CLEAN);
    commit({
      'apps/server/src/services/secrets.ts': 'export const body = 1;\n',
      'apps/server/src/services/plain.ts': 'export const plain = 1;\n',
    });
    const result = review();
    assert.equal(result.status, 0);
    assert.match(
      result.output,
      /skipped \(credential path\) apps\/server\/src\/services\/secrets\.ts/,
    );
    assert.match(calls()[0].input, /plain\.ts/);
    assert.doesNotMatch(calls()[0].input, /secrets\.ts|const body/);
  });
});

test('the review step is in local plans only', () => {
  const step = ['node', 'scripts/prepush-review.mjs'];
  for (const paths of [['docs/a.md'], ['apps/web/src/a.ts']]) {
    assert.deepEqual(
      prepushPlan(paths, 'local').filter((entry) => entry.join(' ') === step.join(' ')),
      [step],
    );
    assert.ok(!prepushPlan(paths, 'ci').some((entry) => entry.join(' ') === step.join(' ')));
    assert.ok(!prepushPlan(paths, 'advisory').some((entry) => entry.join(' ') === step.join(' ')));
  }
});

test('hunk parsing numbers both sides and carried lines follow later edits', () => {
  const [hunk] = parseHunks(
    [
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -2,3 +2,4 @@ head',
      ' two',
      '-three',
      '+THREE',
      '+extra',
      ' four',
      '\\ No newline at end of file',
    ].join('\n'),
  );
  assert.deepEqual(
    hunk.rows.map((row) => [row.sign, row.oldLine, row.newLine]),
    [
      [' ', 2, 2],
      ['-', 3, undefined],
      ['+', undefined, 3],
      ['+', undefined, 4],
      [' ', 4, 5],
    ],
  );
  assert.equal(carriedLine(1, [hunk]), 1);
  assert.equal(carriedLine(3, [hunk]), null);
  assert.equal(carriedLine(9, [hunk]), 10);
});

test('the key-value scan flags values and ignores references and placeholders', () => {
  for (const line of [
    'password: hunter2',
    'API_KEY=abc123',
    '"client_secret": "s3cr3t",',
    'export TOKEN="abc"',
  ])
    assert.equal(keyValueSecret(line), true, line);
  for (const line of [
    'password:',
    `token: ${'$'}{TOKEN}`,
    'TOKEN=$GH_TOKEN',
    'secret: changeme',
    'api_key: <your key>',
    'plain: value',
  ])
    assert.equal(keyValueSecret(line), false, line);
});

test('a reply needs a final count line, and zero findings need the no issues line', () => {
  const sent = new Map([['a.ts', new Set([4])]]);
  assert.equal(parseReply('a.ts:4: race: x.', sent), null);
  assert.equal(parseReply('count: 0', sent), null);
  assert.equal(parseReply(null, sent), null);
  assert.equal(parseReply(`${'x'.repeat(7000)}\ncount: 0`, sent), null);
  assert.deepEqual(parseReply('no issues\ncount: 0\n', sent), []);
  assert.deepEqual(parseReply('- `a.ts:4: race: two writers.`\ncount: 1\n', sent), [
    { path: 'a.ts', line: 4, bugClass: 'race', text: 'two writers.' },
  ]);
});
