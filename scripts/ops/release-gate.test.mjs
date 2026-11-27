import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { decideRelease } from './release-decide.mjs';
import { evaluate, fetchGateEvidence, pickAuthoritativeRun } from './release-gate.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const job = (name, conclusion) => ({ name, conclusion });
const greenJobs = [
  job('check', 'success'),
  job('pack-smoke', 'success'),
  job('e2e-gate', 'success'),
];
const run = (over = {}) => ({
  id: 7,
  attempt: 1,
  latestAttempt: 1,
  status: 'completed',
  conclusion: 'success',
  head_sha: SHA,
  repository: 'o/r',
  event: 'push',
  head_branch: 'main',
  ...over,
});
const listed = (id, over = {}) => ({
  id,
  run_attempt: 1,
  head_sha: SHA,
  event: 'push',
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  ...over,
});
const pageOf = (url) => Number(/[?&]page=(\d+)/.exec(url)[1]);

test('evaluate releases a SHA whose latest ci attempt is green', () => {
  assert.deepEqual(evaluate({ run: run(), jobs: greenJobs, sha: SHA, repo: 'o/r' }), {
    action: 'release',
  });
});

test('evaluate counts a skipped required job as green, matching the ruleset', () => {
  const verdict = evaluate({
    run: run(),
    jobs: [job('check', 'success'), job('pack-smoke', 'skipped'), job('e2e-gate', 'success')],
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'release');
});

test('evaluate counts skipped as green only for pack-smoke, not the always() aggregates', () => {
  for (const name of ['check', 'e2e-gate']) {
    const jobs = greenJobs.map((entry) => (entry.name === name ? job(name, 'skipped') : entry));
    const verdict = evaluate({ run: run(), jobs, sha: SHA, repo: 'o/r' });
    assert.equal(verdict.action, 'block', name);
    assert.deepEqual(verdict.missing, [name]);
  }
});

test('evaluate blocks a completed run whose conclusion is not success', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'neutral', null]) {
    const verdict = evaluate({
      run: run({ conclusion }),
      jobs: greenJobs,
      sha: SHA,
      repo: 'o/r',
    });
    assert.equal(verdict.action, 'block', String(conclusion));
    assert.match(verdict.reason, /run 7 attempt 1/);
  }
});

test('evaluate tells the operator to re-run all jobs when a success run omits a required job', () => {
  const verdict = evaluate({
    run: run(),
    jobs: [job('check', 'success'), job('e2e-gate', 'success')],
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'block');
  assert.deepEqual(verdict.missing, ['pack-smoke']);
  assert.match(verdict.reason, /re-run all jobs/);
});

test('evaluate blocks when a required job never ran in the latest attempt', () => {
  const verdict = evaluate({
    run: run(),
    jobs: [job('check', 'success')],
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'block');
  assert.deepEqual(verdict.missing, ['pack-smoke', 'e2e-gate']);
  assert.match(verdict.reason, /pack-smoke/);
});

test('evaluate waits, not releases, when no push-to-main ci run exists yet', () => {
  const verdict = evaluate({ run: null, jobs: [], sha: SHA, repo: 'o/r' });
  assert.equal(verdict.action, 'wait');
  assert.deepEqual(verdict.missing, ['check', 'pack-smoke', 'e2e-gate']);
});

test('evaluate waits while the latest attempt is still running', () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'requested', null]) {
    const verdict = evaluate({
      run: run({ status, conclusion: null }),
      jobs: greenJobs,
      sha: SHA,
      repo: 'o/r',
    });
    assert.equal(verdict.action, 'wait', String(status));
    assert.match(verdict.reason, /run 7 attempt 1/);
  }
});

test('evaluate waits when a newer attempt superseded the pinned jobs evidence', () => {
  const verdict = evaluate({
    run: run({ attempt: 1, latestAttempt: 2 }),
    jobs: greenJobs,
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'wait');
  assert.match(verdict.reason, /attempt 2/);
});

test('evaluate blocks a red latest attempt and names the failed jobs', () => {
  for (const conclusion of ['failure', 'timed_out', 'cancelled']) {
    const verdict = evaluate({
      run: run({ conclusion: 'success' }),
      jobs: [job('check', conclusion), job('pack-smoke', 'success'), job('e2e-gate', 'success')],
      sha: SHA,
      repo: 'o/r',
    });
    assert.equal(verdict.action, 'block', conclusion);
    assert.deepEqual(verdict.failed, ['check']);
    assert.match(verdict.reason, /check went red|went red.*check/);
  }
});

test('evaluate blocks while a required job in the attempt is still running', () => {
  const verdict = evaluate({
    run: run(),
    jobs: [job('check', 'success'), job('pack-smoke', 'success'), job('e2e-gate', null)],
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'block');
  assert.deepEqual(verdict.missing, ['e2e-gate']);
});

test('evaluate refuses a run that tested another commit', () => {
  const verdict = evaluate({
    run: run({ head_sha: OTHER_SHA }),
    jobs: greenJobs,
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'block');
  assert.match(verdict.reason, new RegExp(OTHER_SHA.slice(0, 7)));
});

test('evaluate refuses a run that completed in another repository', () => {
  const verdict = evaluate({
    run: run({ repository: 'upstream/cairn' }),
    jobs: greenJobs,
    sha: SHA,
    repo: 'o/r',
  });
  assert.equal(verdict.action, 'block');
  assert.match(verdict.reason, /upstream\/cairn/);
});

test('evaluate refuses a run that is not a push to main', () => {
  for (const over of [
    { event: 'pull_request' },
    { head_branch: 'release-gate' },
    { event: undefined, head_branch: undefined },
  ]) {
    const verdict = evaluate({ run: run(over), jobs: greenJobs, sha: SHA, repo: 'o/r' });
    assert.equal(verdict.action, 'block', JSON.stringify(over));
    assert.match(verdict.reason, /push to main/);
  }
});

test('pickAuthoritativeRun selects the newest ci run on the SHA', () => {
  assert.equal(pickAuthoritativeRun([listed(9), listed(3), listed(7)])?.id, 9);
  assert.equal(pickAuthoritativeRun([]), null);
  assert.equal(pickAuthoritativeRun([{ head_sha: SHA }, listed(4)])?.id, 4);
});

test('pickAuthoritativeRun ignores runs that are not pushes to main', () => {
  const main = listed(3);
  const preflight = listed(9, { head_branch: 'preflight/release-gate' });
  const queued = listed(8, { head_branch: 'queue/main' });
  const manual = listed(7, { event: 'workflow_dispatch' });
  assert.equal(pickAuthoritativeRun([preflight, queued, manual, main])?.id, 3);
  assert.equal(pickAuthoritativeRun([preflight, queued, manual]), null);
});

test('pickAuthoritativeRun prefers a newer still-running run over an older completed one', () => {
  const older = listed(3, { status: 'completed', conclusion: 'success' });
  const newer = listed(9, { status: 'in_progress', conclusion: null, run_attempt: 2 });
  assert.equal(pickAuthoritativeRun([older, newer])?.id, 9);
});

const runsCall = (calls) => calls.find((url) => url.includes('/workflows/ci.yml/runs'));

test('the gate resolves the newest push-to-main run without a status filter, then re-reads it around the pinned jobs', () => {
  const calls = [];
  const reads = [
    {
      id: 9,
      run_attempt: 2,
      status: 'completed',
      conclusion: 'success',
      head_sha: SHA,
      event: 'push',
      head_branch: 'main',
    },
    {
      id: 9,
      run_attempt: 2,
      status: 'completed',
      conclusion: 'success',
      head_sha: SHA,
      event: 'push',
      head_branch: 'main',
    },
  ];
  const evidence = fetchGateEvidence({
    repo: 'o/r',
    sha: SHA,
    gh(args) {
      const url = args[1];
      calls.push(url);
      if (url.includes('/jobs')) {
        if (pageOf(url) === 1) return JSON.stringify({ jobs: greenJobs });
        return JSON.stringify({ jobs: [] });
      }
      if (url.includes('/workflows/')) {
        if (pageOf(url) === 1) {
          return JSON.stringify({
            workflow_runs: [
              listed(9, { run_attempt: 2, status: 'in_progress', conclusion: null }),
              listed(3, { run_attempt: 1 }),
            ],
          });
        }
        return JSON.stringify({ workflow_runs: [] });
      }
      return JSON.stringify(reads.shift());
    },
  });
  assert.equal(evidence.run.id, 9);
  assert.equal(evidence.run.attempt, 2);
  assert.equal(evidence.run.latestAttempt, 2);
  assert.equal(evidence.run.status, 'completed');
  assert.equal(evidence.run.repository, 'o/r');
  const list = runsCall(calls);
  assert.match(list, /head_sha=a{40}&event=push&branch=main/);
  assert.doesNotMatch(list, /status=/);
  assert.deepEqual(
    calls.map((url) => url.replace(/[?&]per_page=100/, '').replace(/[?&]page=\d/, '')),
    [
      'repos/o/r/actions/workflows/ci.yml/runs?head_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&event=push&branch=main',
      'repos/o/r/actions/workflows/ci.yml/runs?head_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&event=push&branch=main',
      'repos/o/r/actions/runs/9',
      'repos/o/r/actions/runs/9/attempts/2/jobs',
      'repos/o/r/actions/runs/9/attempts/2/jobs',
      'repos/o/r/actions/runs/9',
    ],
  );
});

test('the gate waits when a newer attempt started between the jobs read and the run re-read', () => {
  const reads = [
    {
      id: 7,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      head_sha: SHA,
      event: 'push',
      head_branch: 'main',
    },
    {
      id: 7,
      run_attempt: 2,
      status: 'in_progress',
      conclusion: null,
      head_sha: SHA,
      event: 'push',
      head_branch: 'main',
    },
  ];
  const evidence = fetchGateEvidence({
    repo: 'o/r',
    sha: SHA,
    gh(args) {
      const url = args[1];
      if (url.includes('/jobs')) {
        if (pageOf(url) === 1) return JSON.stringify({ jobs: greenJobs });
        return JSON.stringify({ jobs: [] });
      }
      if (url.includes('/workflows/')) {
        if (pageOf(url) === 1) return JSON.stringify({ workflow_runs: [listed(7)] });
        return JSON.stringify({ workflow_runs: [] });
      }
      return JSON.stringify(reads.shift());
    },
  });
  const verdict = evaluate({ ...evidence, sha: SHA, repo: 'o/r' });
  assert.equal(verdict.action, 'wait');
  assert.match(verdict.reason, /attempt 2/);
});

test('a rerun that failed or was cancelled blocks the release', () => {
  for (const conclusion of ['failure', 'cancelled']) {
    const evidence = fetchGateEvidence({
      repo: 'o/r',
      sha: SHA,
      gh(args) {
        const url = args[1];
        if (url.includes('/jobs')) {
          if (pageOf(url) === 1) {
            return JSON.stringify({
              jobs: [
                job('check', conclusion),
                job('pack-smoke', 'success'),
                job('e2e-gate', 'success'),
              ],
            });
          }
          return JSON.stringify({ jobs: [] });
        }
        if (url.includes('/workflows/')) {
          if (pageOf(url) === 1) {
            return JSON.stringify({
              workflow_runs: [listed(7, { run_attempt: 2 })],
            });
          }
          return JSON.stringify({ workflow_runs: [] });
        }
        return JSON.stringify({
          id: 7,
          run_attempt: 2,
          status: 'completed',
          conclusion,
          head_sha: SHA,
          event: 'push',
          head_branch: 'main',
        });
      },
    });
    const verdict = evaluate({ ...evidence, sha: SHA, repo: 'o/r' });
    assert.equal(verdict.action, 'block', conclusion);
    assert.match(verdict.reason, /attempt 2/);
  }
});

test('fetchGateEvidence returns no run and no further calls when the sha has no push run', () => {
  const calls = [];
  const evidence = fetchGateEvidence({
    repo: 'o/r',
    sha: SHA,
    gh(args) {
      calls.push(args[1]);
      return JSON.stringify({ workflow_runs: [] });
    },
  });
  assert.equal(evidence.run, null);
  assert.deepEqual(evidence.jobs, []);
  assert.equal(calls.length, 1);
});

test('fetchGateEvidence follows pagination until an empty page; a required job on a later page still counts', () => {
  const calls = [];
  const read = {
    id: 7,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
  };
  const { jobs, run: evidenceRun } = fetchGateEvidence({
    repo: 'o/r',
    sha: SHA,
    gh(args) {
      const url = args[1];
      calls.push(url);
      if (url.includes('/jobs')) {
        if (pageOf(url) >= 3) return JSON.stringify({ jobs: [] });
        if (pageOf(url) === 2) return JSON.stringify({ jobs: [job('e2e-gate', 'success')] });
        return JSON.stringify({
          jobs: [
            job('check', 'success'),
            job('pack-smoke', 'success'),
            ...Array.from({ length: 98 }, (_, i) => job(`other-${i}`, 'success')),
          ],
        });
      }
      if (url.includes('/workflows/')) {
        if (pageOf(url) === 1) return JSON.stringify({ workflow_runs: [listed(7)] });
        return JSON.stringify({ workflow_runs: [] });
      }
      return JSON.stringify(read);
    },
  });
  assert.ok(calls.some((url) => url.includes('page=2')));
  assert.deepEqual(evaluate({ run: evidenceRun, jobs, sha: SHA, repo: 'o/r' }), {
    action: 'release',
  });
});

test('release-tip resolves the current main tip through the gh api', async () => {
  const { fetchMainTip } = await import('./release-tip.mjs');
  const calls = [];
  const tip = fetchMainTip({
    repo: 'o/r',
    gh(args) {
      calls.push(args[1]);
      return JSON.stringify({ commit: { sha: SHA } });
    },
  });
  assert.equal(tip, SHA);
  assert.deepEqual(calls, ['repos/o/r/branches/main']);
});

test('release-tip permits main ancestors and refuses missing, diverged or ahead candidates', async () => {
  const { mainDecision } = await import('./release-tip.mjs');
  for (const status of ['ahead', 'behind', 'diverged', 'identical', undefined]) {
    for (const base of [SHA, OTHER_SHA]) {
      const decision = mainDecision({
        repo: 'o/r',
        sha: SHA,
        gh: ([, url]) =>
          JSON.stringify(
            url.includes('/branches/')
              ? { commit: { sha: OTHER_SHA } }
              : { status, merge_base_commit: { sha: base } },
          ),
      });
      assert.equal(decision.onMain, status === 'ahead' && base === SHA);
    }
  }
  assert.throws(() => mainDecision({ repo: 'o/r', sha: SHA, gh: () => '{}' }), /no commit sha/);
});

const workflow = readFileSync(
  join(import.meta.dirname, '../../.github/workflows/desktop-release.yml'),
  'utf8',
);
const parsed = parse(workflow);

const jobBlock = (name) => {
  const match = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\w|$(?![\\s\\S]))`, 'm').exec(
    workflow,
  );
  assert.ok(match, `${name} job exists`);
  return match[1];
};

test('desktop-release wakes on every completed main ci run, a fifteen-minute schedule and manual dispatch; no push can reach it', () => {
  assert.equal(parsed.on.push, undefined);
  assert.deepEqual(parsed.on.schedule, [{ cron: '*/15 * * * *' }]);
  assert.ok('workflow_dispatch' in parsed.on);
  assert.deepEqual(parsed.on.workflow_run, {
    workflows: ['ci'],
    types: ['completed'],
    branches: ['main'],
  });
  assert.equal(parsed.jobs.redispatch, undefined, 'the re-dispatch job is gone');
  assert.doesNotMatch(workflow, /release-redispatch|GITHUB_EVENT_NAME/);
});

test('a manual dispatch runs the decide job only when it names the main ref', () => {
  assert.equal(parsed.jobs.decide.if, "github.ref == 'refs/heads/main'");
});

test('decide resolves the current main tip and checks it out, not the triggering push', () => {
  const decide = jobBlock('decide');
  const sha =
    /id: sha[\s\S]*?gh api "repos\/\$GATE_REPO\/branches\/main" --jq \.commit\.sha[\s\S]*?echo "sha=\$tip" >> "\$GITHUB_OUTPUT"/.exec(
      decide,
    );
  assert.ok(sha, 'the released sha is the main tip read when the run holds the slot');
  const checkout =
    /actions\/checkout@[^\n]*\n\s*with:\n\s*fetch-depth: 0\n\s*persist-credentials: false\n\s*ref: \$\{\{ steps\.sha\.outputs\.sha \}\}/.exec(
      decide,
    );
  assert.ok(
    checkout,
    'decide checks out the resolved main tip without persisting its write-scoped token',
  );
  assert.ok(sha.index < checkout.index, 'the tip is resolved before the checkout');
});

test('the decide job resolves the tip, then one step emits release and version without waiting or branching on the event', () => {
  const decide = jobBlock('decide');
  assert.match(decide, /actions: read/);
  assert.match(decide, /GATE_REPO: \$\{\{ github\.repository \}\}/);
  const sha = /id: sha[\s\S]*?branches\/main/.exec(decide);
  assert.ok(sha, 'the tip is resolved first');
  const decision =
    /id: decision\s*\n\s*env:[\s\S]*?RELEASE_SHA: \$\{\{ steps\.sha\.outputs\.sha \}\}[\s\S]*?run: node scripts\/ops\/release-decide\.mjs "\$RELEASE_SHA" >> "\$GITHUB_OUTPUT"/.exec(
      decide,
    );
  assert.ok(decision, 'one decision step runs release-decide on the resolved tip');
  assert.ok(sha.index < decision.index, 'the decision follows the tip resolution');
  assert.doesNotMatch(decide, /--wait|GITHUB_EVENT_NAME|workflow_dispatch/);
  assert.equal(parsed.jobs.decide.outputs.release, `\${{ steps.decision.outputs.release }}`);
  assert.equal(parsed.jobs.decide.outputs.version, `\${{ steps.decision.outputs.version }}`);
});

test('the decide cli releases a green changed untagged tip and skips a released one without reading ci', (t) => {
  const step = parsed.jobs.decide.steps.find((entry) => entry.id === 'decision');
  assert.ok(step, 'decide runs release-decide.mjs');
  const root = makeTestTempDir('release-decide-cli-');
  t.after(() => releaseTestTempDir(root));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const calls = join(root, 'gh-calls');
  const output = join(root, 'output');
  const green = {
    id: 7,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
  };
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$GH_CALLS"',
      'case "$2" in',
      '  *"releases?per_page=100&page=1"*) printf \'%s\\n\' "$RELEASES_PAGE1"; exit 0 ;;',
      '  *"releases?per_page=100&page="*) printf \'[]\\n\'; exit 0 ;;',
      '  *page=2*|*page=3*) printf \'%s\\n\' "$EMPTY_PAGE"; exit 0 ;;',
      '  *attempts/*/jobs*) printf \'%s\\n\' "$JOBS_PAGE"; exit 0 ;;',
      '  *workflows/ci.yml/runs*) printf \'%s\\n\' "$RUNS_PAGE"; exit 0 ;;',
      '  *matching-refs*) printf \'%s\\n\' "$TAGS_READ"; exit 0 ;;',
      "  *releases*) printf '[]\\n'; exit 0 ;;",
      '  *actions/runs/*) printf \'%s\\n\' "$RUN_READ"; exit 0 ;;',
      'esac',
      'printf \'stub gh: unexpected %s\\n\' "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const runStep = (over = {}) => {
    writeFileSync(output, '');
    writeFileSync(calls, '');
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: join(import.meta.dirname, '../..'),
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_SHA: SHA,
        GATE_REPO: 'o/r',
        GH_TOKEN: 'fixture-token',
        GH_CALLS: calls,
        GITHUB_OUTPUT: output,
        TAGS_READ: '[]',
        RUNS_PAGE: JSON.stringify({ workflow_runs: [green] }),
        RUN_READ: JSON.stringify(green),
        JOBS_PAGE: JSON.stringify({ jobs: greenJobs }),
        EMPTY_PAGE: JSON.stringify({ jobs: [], workflow_runs: [] }),
        RELEASES_PAGE1: '[]',
        ...over,
      },
    });
  };
  const fresh = runStep();
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(readFileSync(output, 'utf8'), /^release=true$/m);
  assert.match(readFileSync(output, 'utf8'), /^version=0\.1\.1$/m);
  assert.match(readFileSync(calls, 'utf8'), new RegExp(`head_sha=${SHA}`));
  const released = runStep({
    TAGS_READ: JSON.stringify([
      { ref: 'refs/tags/desktop-v0.1.2', object: { sha: SHA, type: 'commit' } },
    ]),
    RELEASES_PAGE1: JSON.stringify([
      { tag_name: 'desktop-v0.1.2', draft: false, prerelease: false },
    ]),
  });
  assert.equal(released.status, 0, released.stderr);
  assert.match(readFileSync(output, 'utf8'), /^release=false$/m);
  assert.doesNotMatch(
    readFileSync(calls, 'utf8'),
    /workflows\/ci\.yml/,
    'a released tip never reads ci',
  );
  assert.match(
    readFileSync(calls, 'utf8'),
    /releases\?per_page/,
    'the plan still reads the release list for the released check',
  );
  const prerelease = runStep({
    TAGS_READ: JSON.stringify([
      { ref: 'refs/tags/desktop-v0.1.2', object: { sha: SHA, type: 'commit' } },
    ]),
    RELEASES_PAGE1: JSON.stringify([
      { tag_name: 'desktop-v0.1.2', draft: false, prerelease: true },
    ]),
  });
  assert.equal(prerelease.status, 0, prerelease.stderr);
  assert.match(readFileSync(output, 'utf8'), /^release=true$/m);
  assert.match(
    readFileSync(output, 'utf8'),
    /^version=0\.1\.3$/m,
    'a prerelease on the tip allocates a fresh version above it instead of skipping',
  );
});

test('the publish job rechecks CI and main ancestry before releasing', () => {
  const publish = jobBlock('publish');
  assert.match(publish, /actions: read/);
  const gateThenTipThenPublish =
    /release-gate\.mjs "\$RELEASE_SHA"[\s\S]*?id: tip[\s\S]*?release-tip\.mjs "\$RELEASE_SHA" >> "\$GITHUB_OUTPUT"[\s\S]*?- name: Publish the release\s*\n\s*if: steps\.tip\.outputs\.on_main == 'true'/.exec(
      publish,
    );
  assert.ok(
    gateThenTipThenPublish,
    'publish re-reads the ci evidence, re-checks the main tip, then gates the release flip on it',
  );
});

test('the whole run serializes on one workflow-level group so every tick judges the current tip', () => {
  assert.deepEqual(parsed.concurrency, {
    group: 'desktop-release',
    'cancel-in-progress': false,
  });
  for (const [name, job] of Object.entries(parsed.jobs)) {
    assert.equal(job.concurrency, undefined, `${name} has no job-level group`);
  }
  for (const name of ['live-verify', 'package-arm64', 'package-x64']) {
    assert.equal(
      parsed.jobs[name].if,
      "needs.decide.outputs.release == 'true'",
      `${name} runs only when decide released`,
    );
  }
});

test('every job builds, verifies and publishes the resolved release commit', () => {
  assert.equal(parsed.jobs.decide.outputs.sha, `\${{ steps.decision.outputs.sha }}`);
  const pinned = `\${{ needs.decide.outputs.sha }}`;
  for (const name of [
    'live-verify',
    'package-arm64',
    'package-x64',
    'package-win',
    'package-linux',
    'verify-arm64-smoke',
    'verify-arm64-journeys',
    'verify-arm64-post-install',
    'publish',
  ]) {
    const checkouts = (parsed.jobs[name].steps ?? []).filter(
      (step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    );
    assert.ok(checkouts.length > 0, `${name} checks out`);
    for (const checkout of checkouts) {
      assert.equal(
        checkout.with?.ref,
        name === 'publish' ? `\${{ github.sha }}` : pinned,
        `${name} pins application sources or trusted release control`,
      );
    }
  }
  assert.ok(parsed.jobs.publish.needs.includes('decide'));
});

test('a live-verify job drives the new-task journey on an isolated stack', () => {
  const job = jobBlock('live-verify');
  assert.match(job, /needs: \[?decide\]?/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /launch\.mjs/);
  assert.match(job, /vp\.mjs drive board-new-task new-task/);
  assert.match(job, /cleanup\.mjs/);
});

test('live-verify requires a passing new-task result with nonempty assertions', () => {
  const job = jobBlock('live-verify');
  assert.match(job, /require-verify-evidence\.mjs "\$VERIFY_EVIDENCE_DIR\/result\.json" new-task/);
  assert.doesNotMatch(job, /cp .*(launch|server|web)\.log/);
});

test('live-verify evidence uploads under a per-attempt name on every outcome', () => {
  const job = jobBlock('live-verify');
  const upload =
    /if: always\(\)[\s\S]*?upload-artifact[\s\S]*?name: live-verify-evidence-\$\{\{ github\.run_attempt \}\}/.exec(
      job,
    );
  assert.ok(upload, 'an always() step uploads the evidence once per run attempt');
});

const evidenceScript = resolve(import.meta.dirname, 'require-verify-evidence.mjs');

test('the evidence gate refuses a missing, failed or empty new-task result', (t) => {
  const dir = makeTestTempDir('verify-evidence-');
  t.after(() => releaseTestTempDir(dir));
  const file = join(dir, 'result.json');
  const run = () => spawnSync(process.execPath, [evidenceScript, file, 'new-task']);
  const write = (result) => writeFileSync(file, JSON.stringify(result));

  assert.notEqual(run().status, 0);

  write({ probe: 'new-task', ok: true, checks: [] });
  assert.notEqual(run().status, 0);

  write({
    probe: 'new-task',
    ok: false,
    checks: [{ ok: false, label: 'GET /api/todos 含新任务' }],
  });
  assert.notEqual(run().status, 0);
});

test('the evidence gate requires the named row, api and sqlite assertions for new-task', (t) => {
  const dir = makeTestTempDir('verify-evidence-');
  t.after(() => releaseTestTempDir(dir));
  const file = join(dir, 'result.json');
  const run = () => spawnSync(process.execPath, [evidenceScript, file, 'new-task']);
  const write = (checks, ok = true) =>
    writeFileSync(file, JSON.stringify({ probe: 'new-task', ok, checks }));

  write([{ ok: true, label: 'row landed' }]);
  assert.notEqual(run().status, 0, 'a single passing assertion proves nothing');

  write([
    { ok: true, id: 'row', label: 'row landed' },
    { ok: true, id: 'api', label: 'api row' },
  ]);
  assert.notEqual(run().status, 0, 'the sqlite assertion is required');

  write([
    { ok: true, id: 'row', label: 'row landed' },
    { ok: true, id: 'api', label: 'api row' },
    { ok: true, id: 'db', label: 'sqlite row' },
  ]);
  assert.equal(run().status, 0);

  write([
    { ok: true, id: 'row', label: 'row landed' },
    { ok: true, id: 'api', label: 'api row' },
    { ok: false, id: 'db', label: 'sqlite row' },
  ]);
  assert.notEqual(run().status, 0, 'a failed required assertion blocks');
});

const driveProbe = readFileSync(
  join(import.meta.dirname, '../../.claude/skills/verify-cairn/scripts/drive.mjs'),
  'utf8',
);

test('the new-task probe does not depend on the runner browser locale', () => {
  assert.match(driveProbe, /locale: 'zh-CN'/);
  assert.doesNotMatch(driveProbe, /getByRole\('complementary',\s*\{\s*name:/);
});

test('the new-task probe names its row, api and sqlite assertions', () => {
  for (const id of ['row', 'api', 'db']) {
    assert.match(driveProbe, new RegExp(`check\\([\\s\\S]{0,400}?'${id}'\\s*,?\\s*\\)`), id);
  }
});

test('the publish ancestry step skips a diverged candidate and accepts the main tip', (t) => {
  const step = parsed.jobs.publish.steps.find((entry) => entry.id === 'tip');
  assert.ok(step, 'publish re-reads the main tip before staging');
  const root = makeTestTempDir('release-tip-step-');
  t.after(() => releaseTestTempDir(root));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const output = join(root, 'output');
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      'case "$2" in',
      '  *branches/main*) printf \'%s\\n\' "$BRANCH_READ"; exit 0 ;;',
      '  *compare/*) printf \'%s\\n\' \'{"status":"diverged"}\'; exit 0 ;;',
      'esac',
      'printf \'stub gh: unexpected %s\\n\' "$*" >&2',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const runStep = (tip) => {
    writeFileSync(output, '');
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: join(import.meta.dirname, '../..'),
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_SHA: SHA,
        GATE_REPO: 'o/r',
        GH_TOKEN: 'fixture-token',
        GITHUB_OUTPUT: output,
        BRANCH_READ: JSON.stringify({ commit: { sha: tip } }),
      },
    });
  };
  const moved = runStep(OTHER_SHA);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(
    readFileSync(output, 'utf8'),
    'on_main=false\n',
    'a stale packaged sha leaves the step green and skips the publish step',
  );
  const current = runStep(SHA);
  assert.equal(current.status, 0, current.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'on_main=true\n');
});

const freshTip = { released: false, version: '0.1.9' };
const greenVerdict = { action: 'release' };

test('decideRelease releases a green tip whose shipped sources moved and no tag covers', () => {
  const decision = decideRelease({ plan: freshTip, verdict: greenVerdict, changed: true });
  assert.equal(decision.release, true);
});

test('decideRelease skips while the tip ci is pending and when it is red', () => {
  for (const verdict of [
    { action: 'wait', reason: 'ci run 7 attempt 1 is in_progress; it has not completed' },
    { action: 'block', reason: 'ci run 7 attempt 1 concluded failure' },
  ]) {
    const decision = decideRelease({ plan: freshTip, verdict, changed: true });
    assert.equal(decision.release, false, verdict.action);
    assert.match(decision.reason, /not green/);
    assert.match(decision.reason, new RegExp(verdict.reason.slice(0, 20)));
  }
});

test('decideRelease skips a tip whose shipped sources did not move', () => {
  const decision = decideRelease({ plan: freshTip, verdict: greenVerdict, changed: false });
  assert.equal(decision.release, false);
  assert.match(decision.reason, /nothing the app ships changed/);
});

test('decideRelease skips a tip a published desktop-v tag already covers, before needing a verdict', () => {
  const decision = decideRelease({
    plan: { released: true, version: '0.1.2' },
  });
  assert.equal(decision.release, false);
  assert.match(decision.reason, /desktop-v0\.1\.2/);
});

test('a manual dispatch follows the same rule as the schedule: unchanged sources still skip', () => {
  for (const changed of [false, true]) {
    for (const event of ['schedule', 'workflow_dispatch']) {
      const decision = decideRelease({ plan: freshTip, verdict: greenVerdict, changed, event });
      assert.equal(decision.release, changed, `${event} changed=${changed}`);
    }
  }
});

test('an incomplete final run read never keeps an earlier green verdict', () => {
  const first = {
    id: 7,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
  };
  for (const final of [
    {},
    { ...first, head_sha: undefined },
    { ...first, run_attempt: undefined },
    { ...first, event: undefined },
    { ...first, head_branch: undefined },
    { ...first, head_branch: 'preflight/not-main' },
  ]) {
    const reads = [first, final];
    const evidence = fetchGateEvidence({
      repo: 'o/r',
      sha: SHA,
      gh(args) {
        const url = args[1];
        if (url.includes('/jobs')) {
          if (pageOf(url) === 1) return JSON.stringify({ jobs: greenJobs });
          return JSON.stringify({ jobs: [] });
        }
        if (url.includes('/workflows/')) {
          if (pageOf(url) === 1) return JSON.stringify({ workflow_runs: [listed(7)] });
          return JSON.stringify({ workflow_runs: [] });
        }
        return JSON.stringify(reads.shift());
      },
    });
    assert.notEqual(evaluate({ ...evidence, sha: SHA, repo: 'o/r' }).action, 'release');
  }
});

test('a release page that is not a list stops the inventory instead of ending it', async () => {
  const { fetchDesktopReleases } = await import('./last-desktop-release.mjs');
  const pages = [JSON.stringify(null)];
  assert.throws(() => fetchDesktopReleases({ repo: 'o/r', gh: () => pages.shift() }), /not a list/);
});
