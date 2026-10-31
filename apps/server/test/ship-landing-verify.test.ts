import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { agent, build, project, pushDelivery, step, team, todo } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { finishStep } from '../src/services/machines.js';
import { appendShipGateInstruction } from '../src/services/ship-gate.js';
import { bootServer, insertMachine } from './helpers.js';

const JUDGED = 'a'.repeat(40);
const PUSHED = 'e'.repeat(40);
const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function pullFetch(pull: { merged: boolean; head: string }): FetchLike {
  return async (url) => {
    const body = String(url).includes('/pulls/')
      ? {
          state: pull.merged ? 'closed' : 'open',
          merged: pull.merged,
          merge_commit_sha: pull.merged ? 'f'.repeat(40) : null,
          head: { sha: pull.head, ref: 'cairn/x', repo: { id: 1 } },
          base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
        }
      : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function world(pull: { merged: boolean; head: string }) {
  const s = bootServer({ githubFetch: pullFetch(pull) });
  disposables.push(() => s.dispose());
  const machineId = insertMachine(s);
  const now = Date.now();
  s.db
    .insert(project)
    .values({
      id: 'p1',
      teamId: s.team.id,
      name: 'Ship',
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(agent)
    .values({
      id: 'a1',
      teamId: s.team.id,
      displayName: 'Shipper',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId,
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 't1',
      teamId: s.team.id,
      projectId: 'p1',
      title: 'Ship',
      phase: 'review',
      phaseAt: now,
      seqNum: 1,
      latestBuildId: 'b1',
      hasChanges: true,
      assignment: { plan: null, build: { agentId: 'a1' } },
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'b1',
      todoId: 't1',
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: now,
      prNumber: 7,
      prUrl: 'https://github.com/octo/demo/pull/7',
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'm1',
      buildId: 'b1',
      kind: 'merge',
      status: 'claimed',
      machineId,
      claimedAt: now,
      lastHeartbeatAt: now,
      createdAt: now,
      prompt: appendShipGateInstruction('Ship it.', { buildId: 'b1', judgedHead: JUDGED }),
    })
    .run();
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: 'gho_test', scope: 'repo' },
  );
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    githubFetch: pullFetch(pull),
  };
  return { s, machineId, deps };
}

function failure(s: ReturnType<typeof world>['s']) {
  return s.db.select().from(build).where(eq(build.id, 'b1')).get()?.errorMessage;
}

function stepRow(s: ReturnType<typeof world>['s']) {
  return s.db.select().from(step).where(eq(step.id, 'm1')).get();
}

describe('the custom merge step is verified when it finishes', () => {
  test('merged head equals the judged head: the step succeeds and the brake stays closed', async () => {
    const { s, machineId, deps } = world({ merged: true, head: JUDGED });
    await finishStep(deps, machineId, 'm1', { status: 'success' });
    expect(stepRow(s)?.status).toBe('done');
    expect(s.db.select().from(team).where(eq(team.id, s.team.id)).get()?.autonomyPaused).toBe(
      false,
    );
  });

  test('a push after claim then a merge: step failed, alert raised, brake opened', async () => {
    const { s, machineId, deps } = world({ merged: true, head: PUSHED });
    await finishStep(deps, machineId, 'm1', { status: 'success' });
    const row = stepRow(s);
    expect(row?.status).toBe('failed');
    expect(failure(s)).toMatch(/unjudged/);
    expect(s.db.select().from(team).where(eq(team.id, s.team.id)).get()?.autonomyPaused).toBe(true);
    expect(s.db.select().from(pushDelivery).all().length).toBeGreaterThan(0);
  });

  test('head moved and nothing merged: the step fails with head-moved and the brake stays closed', async () => {
    const { s, machineId, deps } = world({ merged: false, head: PUSHED });
    await finishStep(deps, machineId, 'm1', { status: 'success' });
    const row = stepRow(s);
    expect(row?.status).toBe('failed');
    expect(failure(s)).toMatch(/head-moved/);
    expect(s.db.select().from(team).where(eq(team.id, s.team.id)).get()?.autonomyPaused).toBe(
      false,
    );
  });

  test('an unreadable PR cannot be verified: the step fails closed', async () => {
    const { s, machineId, deps } = world({ merged: true, head: JUDGED });
    const broken: FetchLike = async () => new Response('nope', { status: 502 });
    await finishStep({ ...deps, githubFetch: broken }, machineId, 'm1', { status: 'success' });
    expect(stepRow(s)?.status).toBe('failed');
    expect(failure(s)).toMatch(/cannot verify/);
  });
});
