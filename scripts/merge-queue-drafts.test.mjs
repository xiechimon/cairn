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
    .replaceAll('github.event.pull_request.state', JSON.stringify(pr.state))
    .replaceAll('github.event.pull_request.draft', JSON.stringify(pr.draft))
    .replaceAll('github.event.pull_request.user.login', JSON.stringify(pr.login))
    .replaceAll('github.head_ref', JSON.stringify(pr.head))
    .replaceAll('startsWith(', 'starts(')
    .replaceAll(' == ', ' === ')
    .replaceAll("'", '"');
  return runInNewContext(expression, { starts: (value, prefix) => value.startsWith(prefix) });
}

const queueDraft = {
  state: 'open',
  draft: true,
  login: 'mergify[bot]',
  head: 'mergify/merge-queue/0123456789',
};

for (const job of ['pr-evidence', 'merge-route']) {
  test(`${job} skips closed PRs and only Mergify queue drafts among open PRs`, () => {
    const lines = jobBlock('.github/workflows/pr-evidence.yml', job).split('\n');
    const conditions = lines.filter((line) => /^ {4}if:/.test(line));
    assert.equal(conditions.length, 1);
    assert.equal(lines[1], conditions[0]);
    assert.equal(runsFor(conditions[0], queueDraft), false);
    for (const pr of [
      { ...queueDraft, draft: false },
      { ...queueDraft, login: 'xiechimon' },
      { ...queueDraft, login: 'cairnwright[bot]' },
      { ...queueDraft, head: 'lane/1' },
      { ...queueDraft, draft: false, login: 'xiechimon', head: 'mergify/merge-queue/x' },
    ]) {
      assert.equal(runsFor(conditions[0], pr), true, JSON.stringify(pr));
      for (const merged of [true, false])
        assert.equal(runsFor(conditions[0], { ...pr, state: 'closed', merged }), false);
    }
    assert.equal(runsFor(conditions[0], { ...queueDraft, state: 'closed' }), false);
  });
}

for (const job of ['gates', 'check', 'e2e-gate', 'pack-smoke'])
  test(`${job} still runs on merge-queue draft PRs`, () => {
    assert.doesNotMatch(
      jobBlock('.github/workflows/ci.yml', job),
      /mergify\[bot\]|mergify\/merge-queue\//,
    );
  });
