import type { ClaimedStep } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  build as buildTable,
  project as projectTable,
  schedule as scheduleTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { NotFoundError, startBuilds } from '../src/services/builds.js';
import { executeChiefTool, executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { readBuildChangeFile } from '../src/services/git.js';
import { PhaseTransitionError } from '../src/services/phase.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { bindAllAgents, bootServer, issueApiKey, type TestServer } from './helpers.js';

const TEAM_B = 'team-b-1497';
const PROJ_B = 'proj-b-1497';
const AGENT_ID = 'agent-1497';

const servers: TestServer[] = [];
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function world() {
  const s = bootServer({ claimHoldMs: 250 });
  servers.push(s);
  s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: nowMs() }).run();
  s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'hosted', repoName: 'beta' })
    .run();
  const plain = await issueApiKey(s);
  const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: plain,
    body: { teamId: s.team.id, name: 'm-1497', cliVersion: '0.1.0' },
  });
  const { token } = (await enroll.json()) as { token: string };
  s.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'a', provider: 'p', modelId: 'm' })
    .run();
  bindAllAgents(s);
  const projectId = 'proj-a-1497';
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: 'alpha',
      teamId: s.team.id,
      repoKind: 'hosted',
      repoName: 'alpha',
    })
    .run();
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '本队任务', spec: 's' },
  });
  const { id: todoId } = (await res.json()) as { id: string };
  return { s, projectId, todoId, token };
}

function pointAtTeamB(s: TestServer, todoId: string): void {
  s.db.update(todoTable).set({ projectId: PROJ_B }).where(eq(todoTable.id, todoId)).run();
}

function stateOf(s: TestServer, todoId: string) {
  const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
  const builds = s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).all();
  return { phase: row?.phase, builds: builds.length };
}

const assignment = { plan: null, build: { agentId: AGENT_ID } };

describe('#1497 startBuilds: the project must share the todo team', () => {
  test('V1 an own-team todo pointing at another team project -> NotFound project, no build created, the phase unchanged', async () => {
    const { s, todoId } = await world();
    pointAtTeamB(s, todoId);
    const before = stateOf(s, todoId);
    expect(() =>
      startBuilds(s.svc, { projectId: PROJ_B, todoIds: [todoId], assignment, withPlan: false }),
    ).toThrow(new NotFoundError(`project ${PROJ_B}`));
    expect(stateOf(s, todoId)).toEqual(before);
  });

  test('V1 the REST entry 404s the same way', async () => {
    const { s, todoId } = await world();
    pointAtTeamB(s, todoId);
    const res = await call(s.app, 'POST', `/api/projects/${PROJ_B}/builds`, {
      body: { todoIds: [todoId], assignment, withPlan: false },
    });
    expect(res.status).toBe(404);
    expect(stateOf(s, todoId).builds).toBe(0);
  });

  test('V2 a scheduled trigger: tick does not throw, no build created', async () => {
    const { s, todoId } = await world();
    pointAtTeamB(s, todoId);
    const at = Math.ceil((nowMs() + 3_600_000) / 900_000) * 900_000;
    createSchedule(
      { db: s.db, hub: s.hub },
      {
        teamId: s.team.id,
        projectId: PROJ_B,
        todoId,
        kind: 'once',
        at,
        tz: 'UTC',
        createdBy: s.user.id,
      },
    );
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    expect(() => scheduler.tick(at + 1_000)).not.toThrow();
    expect(stateOf(s, todoId).builds).toBe(0);
    expect(s.db.select().from(scheduleTable).where(eq(scheduleTable.todoId, todoId)).all()).toEqual(
      [],
    );
  });

  test('V6 the same id twice: the second 409s, only one build', async () => {
    const { s, projectId, todoId } = await world();
    expect(() =>
      startBuilds(s.svc, { projectId, todoIds: [todoId, todoId], assignment, withPlan: false }),
    ).toThrow(PhaseTransitionError);
    expect(stateOf(s, todoId).builds).toBe(1);
  });

  test('V7 the changes read surface: a todo pointing at another team hosted project -> 404, the other team repo unread', async () => {
    const { s, projectId, todoId } = await world();
    const [created] = startBuilds(s.svc, {
      projectId,
      todoIds: [todoId],
      assignment,
      withPlan: false,
    });
    pointAtTeamB(s, todoId);
    const err = await readBuildChangeFile(
      { db: s.db, reposDir: s.reposDir },
      created?.id ?? '',
      'README.md',
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
  });

  test('V5 own-team projects create builds as usual', async () => {
    const { s, projectId, todoId } = await world();
    const created = startBuilds(s.svc, {
      projectId,
      todoIds: [todoId],
      assignment,
      withPlan: false,
    });
    expect(created).toHaveLength(1);
    expect(stateOf(s, todoId)).toEqual({ phase: 'queued', builds: 1 });
  });
});

describe('#1497 claim: another team project stays out of the payload, no credentials issued', () => {
  async function claimed(cross: boolean) {
    const { s, projectId, todoId, token } = await world();
    startBuilds(s.svc, { projectId, todoIds: [todoId], assignment, withPlan: false });
    if (cross) pointAtTeamB(s, todoId);
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    const tokenRes = await call(s.app, 'GET', `/api/machine/token/${step.step.id}`, {
      cred: token,
    });
    const creds = (await tokenRes.json()) as { git: unknown };
    return { step, creds };
  }

  test('V3 a todo pointing at another team hosted project: no repo in the payload, the git credential null', async () => {
    const { step, creds } = await claimed(true);
    expect(step.project?.repo ?? null).toBeNull();
    expect(JSON.stringify(step)).not.toContain(`/${TEAM_B}/`);
    expect(creds.git).toBeNull();
  });

  test('V5 an own-team hosted project: the payload carries the repo, credentials issued as usual', async () => {
    const { step, creds } = await claimed(false);
    expect(step.project?.repo?.kind).toBe('hosted');
    expect(creds.git).not.toBeNull();
  });
});

describe('#1497 chief delete_memory: deletes only this agent own-team entries', () => {
  function insertMemory(s: TestServer, agentId: string, teamId: string): string {
    const id = newRecordId();
    s.db
      .insert(agentMemory)
      .values({
        id,
        agentId,
        teamId,
        title: 't',
        content: 'c',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })
      .run();
    return id;
  }

  async function chiefDelete(s: TestServer, memoryId: string): Promise<unknown> {
    return executeChiefTool(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: `chief-${s.user.id}-${s.team.id}`,
        threadId: 'chief-1497',
        chiefAgentId: AGENT_ID,
        conversationId: 'chief-1497',
      },
      'delete_memory',
      { memoryId },
    );
  }

  function exists(s: TestServer, id: string): boolean {
    return s.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get() !== undefined;
  }

  test('V4 another agent / another team memories are not deleted', async () => {
    const { s } = await world();
    const otherAgent = insertMemory(s, 'agent-other-1497', s.team.id);
    const otherTeam = insertMemory(s, AGENT_ID, TEAM_B);
    for (const id of [otherAgent, otherTeam]) {
      const err = await chiefDelete(s, id).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(404);
    }
    expect(exists(s, otherAgent)).toBe(true);
    expect(exists(s, otherTeam)).toBe(true);
  });

  test('V4 worker delete_memory: another agent memories -> 404, not deleted', async () => {
    const { s, todoId } = await world();
    const otherAgent = insertMemory(s, 'agent-other-1497', s.team.id);
    const err = await executeWorkerMemoryTool(
      s.db,
      {
        teamId: s.team.id,
        agentId: AGENT_ID,
        todoId,
        projectId: null,
        buildId: 'build-1497',
        attachmentsDir: s.attachmentsDir,
      },
      'delete_memory',
      { memoryId: otherAgent },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as HttpError).status).toBe(404);
    expect(exists(s, otherAgent)).toBe(true);
  });

  test('V5 this agent own-team memories are deleted as usual', async () => {
    const { s } = await world();
    const own = insertMemory(s, AGENT_ID, s.team.id);
    await chiefDelete(s, own);
    expect(exists(s, own)).toBe(false);
  });
});
