import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { awaitMainHealth, decideMainHealth, githubMainRunFetcher } from './await-main-health.mjs';

const sha = 'a'.repeat(40);
const run = (id, status, conclusion = null) => ({
  id,
  status,
  conclusion,
});
const green = run(1, 'completed', 'success');

test('only the latest completed successful CI permits publication', () => {
  assert.equal(decideMainHealth(green).verdict, 'success');
  assert.equal(decideMainHealth(null).verdict, 'missing');
  for (const conclusion of ['failure', 'skipped', 'cancelled', 'neutral', 'timed_out']) {
    assert.equal(decideMainHealth(run(2, 'completed', conclusion)).verdict, 'red');
  }
  assert.equal(decideMainHealth(run(2, 'in_progress')).verdict, 'pending');
});

test('publication waits for pending CI, retries API errors, and fails closed at its deadline', async () => {
  for (const snapshots of [
    [new Error('503'), run(2, 'in_progress'), green],
    [run(2, 'in_progress')],
    [new Error('503')],
    [run(2, 'completed', 'failure')],
  ]) {
    let clock = 0;
    let calls = 0;
    const result = await awaitMainHealth({
      fetchRun: async () => {
        const snapshot = snapshots[Math.min(calls++, snapshots.length - 1)];
        if (snapshot instanceof Error) throw snapshot;
        return snapshot;
      },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      timeoutMs: 300,
      intervalMs: 100,
    });
    assert.equal(result.ok, snapshots.length === 3);
    if (snapshots.length === 3) assert.equal(calls, 3);
    else if (result.verdict === 'red') assert.equal(calls, 1);
    else assert.match(result.verdict, /^timeout-/);
  }
});

test('the API query and returned run must both identify this exact main push SHA', async (t) => {
  const workflow = {
    ...green,
    head_sha: sha,
    head_branch: 'main',
    event: 'push',
  };
  let returned = workflow;
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(
      url,
      `https://api.github.com/repos/x/y/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=1`,
    );
    return {
      ok: true,
      json: async () => ({ workflow_runs: returned ? [returned, workflow] : [] }),
    };
  });
  const fetchRun = githubMainRunFetcher({ repo: 'x/y', sha, token: 'fixture' });
  assert.equal(decideMainHealth(await fetchRun()).verdict, 'success');
  returned = { ...workflow, status: 'completed', conclusion: 'failure' };
  assert.equal(decideMainHealth(await fetchRun()).verdict, 'red');
  returned = { ...workflow, status: 'in_progress', conclusion: null };
  assert.equal(decideMainHealth(await fetchRun()).verdict, 'pending');
  for (const mismatch of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' },
    { event: 'pull_request' },
    null,
  ]) {
    returned = mismatch === null ? null : { ...workflow, ...mismatch };
    assert.equal(decideMainHealth(await fetchRun()).verdict, 'missing');
  }
});

test('each publisher checks main CI before the command that publishes the checked-out SHA', () => {
  for (const [file, job, command] of [
    ['release', 'publish', 'pnpm exec changeset publish --from-pack-dir release-pack'],
    ['site-deploy', 'deploy', 'vercel@latest deploy --prod'],
    ['desktop-release', 'release', 'gh release create'],
  ]) {
    const workflow = parse(
      readFileSync(new URL(`../.github/workflows/${file}.yml`, import.meta.url), 'utf8'),
    );
    const publisher = workflow.jobs[job];
    assert.match(publisher.if, /github.ref == 'refs\/heads\/main'/, file);
    assert.equal((publisher.permissions ?? workflow.permissions).actions, 'read', file);
    const guard = publisher.steps.findIndex(
      (step) => step.run === 'node scripts/await-main-health.mjs',
    );
    const publish = publisher.steps.findIndex((step) => step.run?.includes(command));
    assert.ok(guard >= 0 && publish > guard, file);
    assert.equal(publisher.steps[guard].env.GH_TOKEN, `\${{ github.token }}`, file);
    const checkout = publisher.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    assert.ok(checkout.with?.ref === undefined || checkout.with.ref === `\${{ github.sha }}`, file);
  }
});
