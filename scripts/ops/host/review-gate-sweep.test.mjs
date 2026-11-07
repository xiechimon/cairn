import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../test-tmpdir.mjs';

const SCRIPT = join(import.meta.dirname, 'tools/review-gate-sweep.sh');
const NOW = Date.now();
const iso = (ageSeconds) => new Date(NOW - ageSeconds * 1000).toISOString().replace('.000', '');

function sweep({ prs, gates, ages }) {
  const dir = makeTestTempDir('gate-sweep-');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
  for (const [sha, run] of Object.entries(gates))
    writeFileSync(
      join(dir, `checks-${sha}.json`),
      JSON.stringify({ check_runs: run ? [run] : [] }),
    );
  for (const [sha, age] of Object.entries(ages))
    writeFileSync(
      join(dir, `commit-${sha}.json`),
      JSON.stringify({ commit: { committer: { date: iso(age) } } }),
    );
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/bash
echo "$*" >> "${dir}/calls"
jqexpr=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do [ "\${args[$i]}" = --jq ] && jqexpr="\${args[$((i + 1))]}"; done
case "$1 $2" in
  "pr list") exec jq -r "$jqexpr" "${dir}/prs.json" ;;
  "api repos/"*)
    sha=$(echo "$2" | sed -E 's#.*/commits/([0-9a-f]+).*#\\1#')
    if [[ "$2" == *check-runs* ]]; then exec jq -r "$jqexpr" "${dir}/checks-$sha.json"; fi
    exec jq -r "$jqexpr" "${dir}/commit-$sha.json" ;;
esac
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${bin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  let calls = '';
  try {
    calls = readFileSync(join(dir, 'calls'), 'utf8');
  } catch {}
  return { result, dispatched: calls.split('\n').filter((l) => l.startsWith('workflow run')) };
}

const pr = (number, sha, extra = {}) => ({
  number,
  isDraft: false,
  headRefName: `lane/${number}`,
  headRefOid: sha,
  ...extra,
});
const sha = (n) => String(n).repeat(40).slice(0, 40);
const OLD = 1800;

test('dispatches for an unresolved gate and for a failed gate past the head-age guard', () => {
  const { result, dispatched } = sweep({
    prs: [pr(1, sha(1)), pr(2, sha(2)), pr(3, sha(3))],
    gates: {
      [sha(1)]: { status: 'in_progress', conclusion: null },
      [sha(2)]: { status: 'completed', conclusion: 'failure' },
      [sha(3)]: null,
    },
    ages: { [sha(1)]: OLD, [sha(2)]: OLD, [sha(3)]: OLD },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(dispatched.length, 3);
  assert.match(dispatched[1], /pr=2/);
});

test('skips a gate that already succeeded', () => {
  const { dispatched } = sweep({
    prs: [pr(1, sha(1))],
    gates: { [sha(1)]: { status: 'completed', conclusion: 'success' } },
    ages: { [sha(1)]: OLD },
  });
  assert.deepEqual(dispatched, []);
});

test('keeps the 15-minute head-age guard, also for a failed gate', () => {
  const { dispatched } = sweep({
    prs: [pr(1, sha(1)), pr(2, sha(2))],
    gates: {
      [sha(1)]: { status: 'completed', conclusion: 'failure' },
      [sha(2)]: { status: 'queued', conclusion: null },
    },
    ages: { [sha(1)]: 600, [sha(2)]: 600 },
  });
  assert.deepEqual(dispatched, []);
});

test('never dispatches for draft PRs or mergify branches', () => {
  const { dispatched } = sweep({
    prs: [
      pr(1, sha(1), { isDraft: true }),
      pr(2, sha(2), { headRefName: 'mergify/merge-queue/abc' }),
      pr(3, sha(3)),
    ],
    gates: {
      [sha(1)]: null,
      [sha(2)]: null,
      [sha(3)]: null,
    },
    ages: { [sha(1)]: OLD, [sha(2)]: OLD, [sha(3)]: OLD },
  });
  assert.equal(dispatched.length, 1);
  assert.match(dispatched[0], /pr=3/);
});
