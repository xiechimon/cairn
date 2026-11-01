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

function jobCondition(block) {
  const conditions = block.split('\n').filter((line) => /^ {4}if:/.test(line));
  assert.ok(conditions.length <= 1, 'job has multiple conditions');
  return conditions[0];
}

function runsFor(condition, pr) {
  if (condition === undefined) return true;
  const expression = condition
    .replace(/^\s*if:\s*/, '')
    .replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1')
    .replaceAll('github.event_name', JSON.stringify(pr.eventName ?? 'pull_request'))
    .replaceAll('needs.changes.outputs.has-code', JSON.stringify(String(pr.hasCode ?? true)))
    .replaceAll('always()', 'true')
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

for (const job of ['gates', 'check', 'e2e-gate', 'pack-smoke'])
  test(`${job} still runs on merge-queue draft PRs`, () => {
    const condition = jobCondition(jobBlock('.github/workflows/ci.yml', job));
    assert.equal(runsFor(condition, queueDraft), true);
    assert.equal(runsFor(condition, { eventName: 'push' }), true);
    assert.equal(runsFor(condition, { ...queueDraft, hasCode: false }), job !== 'pack-smoke');
  });

test('job eligibility ignores Mergify steps but rejects a job-level draft exclusion', () => {
  const steps = `    steps:
      - name: Mergify config
        if: \${{ !github.event.pull_request.draft }}
        run: node --test scripts/mergify-config.test.mjs
`;
  assert.equal(runsFor(jobCondition(`  gates:\n${steps}`), queueDraft), true);
  const exclusion =
    "    if: ${{ !(github.event.pull_request.draft && github.event.pull_request.user.login == 'mergify[bot]') }}\n";
  assert.equal(runsFor(jobCondition(`  gates:\n${exclusion}${steps}`), queueDraft), false);
});

test('job conditions preserve code classification and push eligibility', () => {
  const condition =
    "if: github.event_name != 'pull_request' || needs.changes.outputs.has-code != 'false'";
  assert.equal(runsFor(condition, queueDraft), true);
  assert.equal(runsFor(condition, { ...queueDraft, hasCode: false }), false);
  assert.equal(runsFor(condition, { eventName: 'push', hasCode: false }), true);
  assert.equal(runsFor('if: always()', queueDraft), true);
  assert.throws(() => runsFor('if: unknown()', queueDraft));
});
