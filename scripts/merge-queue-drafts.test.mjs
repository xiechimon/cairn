import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const skip =
  "    if: \u0024{{ !(github.event.pull_request.user.login == 'mergify[bot]' && startsWith(github.head_ref, 'mergify/merge-queue/')) }}";

function jobBlock(file, job) {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf(`\n  ${job}:\n`);
  assert.notEqual(start, -1, `${file} has no job ${job}`);
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

for (const [file, job] of [
  ['.github/workflows/pr-evidence.yml', 'pr-evidence'],
  ['.github/workflows/ci.yml', 'gates'],
])
  test(`${job} skips only Mergify's own merge-queue draft PRs`, () => {
    const lines = jobBlock(file, job).split('\n');
    assert.equal(lines[1], skip);
    assert.equal(lines.filter((line) => /^ {4}if:/.test(line)).length, 1);
  });

for (const job of ['check', 'e2e-gate', 'pack-smoke'])
  test(`${job} still runs on merge-queue draft PRs`, () => {
    assert.doesNotMatch(jobBlock('.github/workflows/ci.yml', job), /mergify/);
  });
