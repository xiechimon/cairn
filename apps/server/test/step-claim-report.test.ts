import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  apiKey as apiKeyTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { nowMs } from '../src/lib/ids.js';
import {
  BUILD_ABANDONED_STEP_MS,
  sweepAbandonedBuildSteps,
} from '../src/services/build-abandoned-sweep.js';
import { issueStepGitCredential } from '../src/services/credentials.js';
import { claimStep, type MachineDeps } from '../src/services/machines.js';
import { githubFake } from './fakes/github.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, finishStepForClaim, seedSessionRoute } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const MACHINE = 'machine-m1';
const STEP = 'step-1473';
const CARD_ID = 'todo-1473';
const PRIOR_PR = 777;
const REPO = 'demo-owner/demo-repo';

afterEach(() => vi.restoreAllMocks());

function makeWorld(priorPr = false) {
  const github = githubFake(REPO, { repositoryId: 4242 });
  const githubFetch = github.impl;
  const s = bootServer({ githubFetch });
  stubGithubApp(null);
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const base = nowMs();
  s.db
    .insert(projectTable)
    .values({
      id: 'proj-1473',
      name: 'p1473',
      teamId,
      repoKind: 'github',
      githubRepo: REPO,
    })
    .run();
  s.db
    .insert(machineTable)
    .values(readyMachine({ id: MACHINE, teamId, name: 'm1', online: true }))
    .run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: MACHINE });
  s.db
    .insert(todoTable)
    .values({
      id: CARD_ID,
      teamId,
      projectId: 'proj-1473',
      title: 'p1473',
      phase: 'building',
      phaseAt: base,
      latestBuildId: 'build-1473',
      seqNum: 1,
    })
    .run();
  if (priorPr) {
    s.db
      .insert(buildTable)
      .values({
        id: 'build-1473-prior',
        todoId: CARD_ID,
        withPlan: false,
        triggerSource: 'user',
        prUrl: `https://github.com/${REPO}/pull/${PRIOR_PR}`,
        prNumber: PRIOR_PR,
        createdAt: base - 60_000,
      })
      .run();
  }
  s.db
    .insert(buildTable)
    .values({
      id: 'build-1473',
      todoId: CARD_ID,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: STEP,
      buildId: 'build-1473',
      kind: 'build',
      status: 'pending',
      machineId: null,
      createdAt: base,
    })
    .run();
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    githubFetch,
  };
  const stepRow = () => s.db.select().from(stepTable).where(eq(stepTable.id, STEP)).get()!;
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, CARD_ID)).get()!;
  const claim = () => claimStep(deps, MACHINE, teamId, 10, 'http://localhost');
  const sweep = () =>
    sweepAbandonedBuildSteps(
      s.svc,
      (stepRow().claimedAt ?? nowMs()) + BUILD_ABANDONED_STEP_MS + 1_000,
    );
  const credentialCount = () =>
    s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${STEP}`))
      .all().length;
  return { s, deps, teamId, stepRow, todoRow, claim, sweep, credentialCount, github };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('#1473 a report counts only for the current claim', () => {
  test('released and re-claimed by the same machine: the in-flight claim report is booked, later reports change nothing', async () => {
    const w = makeWorld();
    expect((await w.claim())?.step.id).toBe(STEP);
    w.sweep();
    expect(w.stepRow()).toMatchObject({ status: 'pending', machineId: null });
    await tick();
    expect((await w.claim())?.step.id).toBe(STEP);
    await finishStepForClaim(w.deps, MACHINE, STEP, { status: 'success', hasChanges: true });
    expect(w.stepRow().status).toBe('done');
    const settled = w.todoRow().phase;
    const before = w.todoRow();
    await finishStepForClaim(w.deps, MACHINE, STEP, {
      status: 'failed',
      errorMessage: 'second report',
    });
    expect(w.stepRow().status).toBe('done');
    expect(w.todoRow().phase).toBe(settled);
    expect(w.todoRow().v).toBe(before.v);
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, 'build-1473')).get();
    expect(buildRow?.errorMessage ?? null).toBeNull();
  });

  test('the card closed and the step stopped by the sweep: a late report changes nothing, the git credential is reclaimed', async () => {
    const w = makeWorld();
    await w.claim();
    issueStepGitCredential(w.deps, { teamId: w.teamId, stepId: STEP, claimedAt: null });
    expect(w.credentialCount()).toBe(1);
    w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, CARD_ID)).run();
    w.sweep();
    expect(w.stepRow().status).toBe('stopped');
    await finishStepForClaim(w.deps, MACHINE, STEP, {
      status: 'success',
      hasChanges: true,
      sessionId: 'late-session',
    });
    expect(w.stepRow().status).toBe('stopped');
    expect(w.stepRow().sessionId).toBeNull();
    expect(w.todoRow().phase).toBe('closed');
    expect(w.credentialCount()).toBe(0);
  });

  test('a step released back to pending: the original runner report gets ok without writing, the credential reclaimed; another team machine still 404', async () => {
    const w = makeWorld();
    await w.claim();
    issueStepGitCredential(w.deps, { teamId: w.teamId, stepId: STEP, claimedAt: null });
    w.sweep();
    expect(w.stepRow()).toMatchObject({ status: 'pending', machineId: null });
    expect(w.credentialCount()).toBe(0);
    w.s.db.insert(teamTable).values({ id: 'team-other', name: 'other', createdAt: nowMs() }).run();
    w.s.db
      .insert(machineTable)
      .values(
        readyMachine({ id: 'machine-other-team', teamId: 'team-other', name: 'x', online: true }),
      )
      .run();
    await expect(
      finishStepForClaim(w.deps, 'machine-other-team', STEP, {
        status: 'failed',
        errorMessage: 'x',
      }),
    ).rejects.toThrow(/not yours/);
    await finishStepForClaim(w.deps, MACHINE, STEP, { status: 'failed', errorMessage: 'late' });
    expect(w.stepRow()).toMatchObject({ status: 'pending', machineId: null });
    expect(w.todoRow().phase).toBe('building');
    expect(w.credentialCount()).toBe(0);
  });

  test('the step was released and re-claimed during the GitHub probe: the report 409s, the new claim stays claimed', async () => {
    let gateProbe = false;
    let probeEntered!: () => void;
    const entered = new Promise<void>((r) => {
      probeEntered = r;
    });
    let releaseProbe!: () => void;
    const released = new Promise<void>((r) => {
      releaseProbe = r;
    });
    const w = makeWorld(true);
    w.github.overrides.set(`/repos/${REPO}/pulls/${PRIOR_PR}`, async () => {
      if (gateProbe) {
        gateProbe = false;
        probeEntered();
        await released;
      }
      return { body: { state: 'open', merged: false } };
    });
    expect((await w.claim())?.step.id).toBe(STEP);
    gateProbe = true;
    const report = finishStepForClaim(w.deps, MACHINE, STEP, {
      status: 'success',
      hasChanges: true,
      prUrl: 'https://github.com/demo-owner/demo-repo/pull/778',
      prNumber: 778,
    });
    await entered;
    w.sweep();
    expect(w.stepRow().status).toBe('pending');
    await tick();
    expect((await w.claim())?.step.id).toBe(STEP);
    const reclaimedAt = w.stepRow().claimedAt;
    releaseProbe();
    const err = await report.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect(w.stepRow()).toMatchObject({
      status: 'claimed',
      machineId: MACHINE,
      claimedAt: reclaimedAt,
    });
    expect(w.todoRow().phase).toBe('building');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, 'build-1473')).get();
    expect(buildRow?.prNumber ?? null).toBeNull();
  });
});
