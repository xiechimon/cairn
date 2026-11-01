import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

function jobBlock(file, job) {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `${file} has no job ${job}`);
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

function runsFor(condition, pr) {
  const expression = condition
    .replace(/^\s*if: \$\{\{ (.*) \}\}$/, '$1')
    .replaceAll('github.event.pull_request.draft', JSON.stringify(pr.draft))
    .replaceAll('github.event.pull_request.user.login', JSON.stringify(pr.login))
    .replaceAll('github.head_ref', JSON.stringify(pr.head))
    .replaceAll('startsWith(', 'starts(')
    .replaceAll(' == ', ' === ')
    .replaceAll("'", '"');
  return runInNewContext(expression, { starts: (value, prefix) => value.startsWith(prefix) });
}

const queueDraft = { draft: true, login: 'mergify[bot]', head: 'mergify/merge-queue/0123456789' };

test('pr-evidence skips only the draft PRs Mergify opens for a queued batch', () => {
  const lines = jobBlock('.github/workflows/pr-evidence.yml', 'pr-evidence').split('\n');
  const conditions = lines.filter((line) => /^ {4}if:/.test(line));
  assert.equal(conditions.length, 1);
  assert.equal(lines[1], conditions[0]);
  assert.equal(runsFor(conditions[0], queueDraft), false);
  for (const pr of [
    { ...queueDraft, draft: false },
    { ...queueDraft, login: 'xiechimon' },
    { ...queueDraft, login: 'cairnwright[bot]' },
    { ...queueDraft, head: 'lane/1' },
    { draft: false, login: 'xiechimon', head: 'mergify/merge-queue/x' },
  ])
    assert.equal(runsFor(conditions[0], pr), true, JSON.stringify(pr));
});

const SKIPS_QUEUE_DRAFTS = /mergify|merge-queue|pull_request\.draft/i;

function jobConditions(block) {
  const lines = block.split('\n');
  const conditions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^ {4}if:/.test(lines[i])) continue;
    const parts = [lines[i]];
    while (i + 1 < lines.length && /^ {5,}\S/.test(lines[i + 1])) {
      i += 1;
      parts.push(lines[i]);
    }
    conditions.push(parts.join('\n'));
  }
  return conditions;
}

for (const job of ['gates', 'check', 'e2e-gate', 'pack-smoke'])
  test(`${job} still runs on merge-queue draft PRs`, () => {
    for (const condition of jobConditions(jobBlock('.github/workflows/ci.yml', job)))
      assert.doesNotMatch(condition, SKIPS_QUEUE_DRAFTS);
  });

test('the guard reads whole job conditions, not step names', () => {
  const job = [
    '  gates:',
    '    if: >-',
    "      github.event.pull_request.user.login != 'mergify[bot]'",
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Mergify queue config follows pr-gate routing',
    '        run: node --test scripts/mergify-config.test.mjs',
  ].join('\n');
  const [condition] = jobConditions(job);
  assert.match(condition, SKIPS_QUEUE_DRAFTS);
  assert.deepEqual(jobConditions(job.replace(/ {4}if: >-\n.*\n/, '')), []);
  assert.doesNotMatch("    if: needs.changes.outputs.has-code != 'false'", SKIPS_QUEUE_DRAFTS);
});
