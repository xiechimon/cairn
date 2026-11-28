import { WORKSPACE_FILE_CWD } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, chiefMessage, computerCall, machine, message, step } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { coordinatorToolDefs } from '../src/services/coordinator-tool-defs.js';
import { nativeFileSource, runnerFileSource } from '../src/services/file-source.js';
import { receiveComputerFrames } from '../src/services/machine-computer.js';
import { ownedStepRow, upsertChiefRow } from '../src/services/machine-deps.js';
import { storeTranscriptRow } from '../src/services/machines.js';
import { WORKSPACE_CWD_UNSUPPORTED, workspaceCwdRefusal } from '../src/services/own-computer.js';
import { bootServer, postProject, req } from './helpers.js';

const WORKSPACE_A = 'a'.repeat(48);
const WORKSPACE_B = 'b'.repeat(48);
const CONVERSATION = 'source-build';

async function world(machineId: string | null = 'source-runner') {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Write a report',
    spec: '',
  });
  const task = (await created.json()) as { id: string };
  s.db
    .insert(machine)
    .values({
      id: 'source-runner',
      teamId: s.team.id,
      name: 'Source runner',
      tokenHash: hashCredential('source-runner-token'),
    })
    .run();
  s.db
    .insert(machine)
    .values({
      id: 'other-runner',
      teamId: s.team.id,
      name: 'Other runner',
      tokenHash: hashCredential('other-runner-token'),
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: CONVERSATION,
      todoId: task.id,
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  const makeStep = (id: string, claimedAt: number) =>
    s.db
      .insert(step)
      .values({
        id,
        buildId: CONVERSATION,
        kind: 'build',
        status: 'claimed',
        machineId,
        claimedAt,
        createdAt: 1,
      })
      .run();
  makeStep('source-step', 100);
  const publish = (
    stepId: string,
    generation: number,
    workspace?: string,
    id = 'source-message',
    text = 'See report.md',
  ) =>
    s.app.request(`/api/machine/tool/${stepId}?generation=${generation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer source-runner-token' },
      body: JSON.stringify({
        kind: 'transcript_row',
        row: { id, role: 'assistant', createdAt: 2, content: [{ type: 'text', text }] },
        ...(workspace === undefined ? {} : { workspace }),
      }),
    });
  const stored = (id = 'source-message') =>
    s.db.select().from(message).where(eq(message.id, id)).get();
  const history = async () => {
    const response = await s.app.request(`/api/conversations/${CONVERSATION}/messages`);
    return (await response.json()) as { messages: Record<string, unknown>[] };
  };
  return { s, task, makeStep, publish, stored, history };
}

test('a runner row under the active generation stamps the workspace; history and SSE reveal only eligibility', async () => {
  const { s, publish, stored, history } = await world();
  try {
    const events: unknown[] = [];
    s.convHub.subscribe(CONVERSATION, {
      send: (payload: object) => {
        events.push(payload);
        return Promise.resolve();
      },
    });
    expect((await publish('source-step', 100, WORKSPACE_A)).status).toBe(200);
    expect(stored()?.fileSource).toEqual({
      stepId: 'source-step',
      machineId: 'source-runner',
      generation: 100,
      workspace: WORKSPACE_A,
    });
    const page = await history();
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ id: 'source-message', workspaceFileLinks: true });
    expect(JSON.stringify(page)).not.toContain(WORKSPACE_A);
    expect(page.messages[0]).not.toHaveProperty('fileSource');
    const sse = JSON.stringify(events);
    expect(sse).toContain('"workspaceFileLinks":true');
    expect(sse).not.toContain(WORKSPACE_A);
    expect(sse).not.toContain('fileSource');
    expect(sse).not.toContain('source-runner');
  } finally {
    s.dispose();
  }
});

test('a token from another generation or without one is dropped; the row still lands', async () => {
  const { s, publish, stored, history } = await world();
  try {
    expect((await publish('source-step', 100, undefined, 'no-workspace')).status).toBe(200);
    expect(stored('no-workspace')?.fileSource).toEqual({
      stepId: 'source-step',
      machineId: 'source-runner',
      generation: 100,
    });
    const owned = { id: 'source-step', claimedAt: 100, machineId: 'source-runner' };
    const bare = { stepId: 'source-step', machineId: 'source-runner', generation: 100 };
    expect(runnerFileSource(owned, { workspace: WORKSPACE_A })).toEqual(bare);
    expect(runnerFileSource(owned, { workspace: WORKSPACE_A, generation: 99 })).toEqual(bare);
    expect(runnerFileSource(owned, { workspace: 'not a token', generation: 100 })).toEqual(bare);
    expect(runnerFileSource(owned, { workspace: WORKSPACE_A, generation: 100 })).toEqual({
      ...bare,
      workspace: WORKSPACE_A,
    });
    expect((await publish('source-step', 99, WORKSPACE_A, 'stale')).status).toBe(409);
    expect(stored('stale')).toBeUndefined();
    const page = await history();
    expect(page.messages.every((row) => row.workspaceFileLinks === undefined)).toBe(true);
  } finally {
    s.dispose();
  }
});

test('a retry that rewrites the same row id never inherits the earlier attempt stamp', async () => {
  const { s, publish, stored, history } = await world();
  try {
    const events: unknown[] = [];
    s.convHub.subscribe(CONVERSATION, {
      send: (payload: object) => {
        events.push(payload);
        return Promise.resolve();
      },
    });
    expect((await publish('source-step', 100, WORKSPACE_A)).status).toBe(200);
    s.db.update(step).set({ claimedAt: 200 }).where(eq(step.id, 'source-step')).run();
    events.length = 0;
    expect((await publish('source-step', 200, WORKSPACE_B)).status).toBe(200);
    expect(stored()?.fileSource).toBeNull();
    expect(
      (await publish('source-step', 200, WORKSPACE_B, 'source-message', 'See other.md')).status,
    ).toBe(200);
    expect(stored()?.fileSource).toBeNull();
    expect(JSON.stringify(stored()?.content)).toContain('other.md');
    expect(JSON.stringify(events)).not.toContain('workspaceFileLinks');
    expect((await history()).messages[0]).not.toHaveProperty('workspaceFileLinks');
  } finally {
    s.dispose();
  }
});

test('a Coordinator row rewritten by another attempt stays cleared and its event is the persisted result', () => {
  const s = bootServer();
  try {
    s.db.run(sql`pragma foreign_keys = off`);
    const events: unknown[] = [];
    s.convHub.subscribe('thread-1', {
      send: (payload: object) => {
        events.push(payload);
        return Promise.resolve();
      },
    });
    const write = (generation: number, workspace?: string) =>
      upsertChiefRow(s.svc, {
        id: 'chief-row',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'Saved report.md',
        createdAt: 1,
        projectId: null,
        fileSource: {
          stepId: 'chief-step',
          machineId: 'source-runner',
          generation,
          ...(workspace ? { workspace } : {}),
        },
      });
    const stamp = () =>
      s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'chief-row')).get()?.fileSource;
    write(100, WORKSPACE_A);
    expect(stamp()?.workspace).toBe(WORKSPACE_A);
    write(200, WORKSPACE_B);
    expect(stamp()).toBeNull();
    write(200, WORKSPACE_B);
    expect(stamp()).toBeNull();
    const sent = events as { message: Record<string, unknown> }[];
    expect(sent[0]?.message.workspaceFileLinks).toBe(true);
    expect(sent[1]?.message).not.toHaveProperty('workspaceFileLinks');
    expect(sent[2]?.message).not.toHaveProperty('workspaceFileLinks');
    expect(JSON.stringify(sent)).not.toContain(WORKSPACE_B);
  } finally {
    s.dispose();
  }
});

test('the step workspace cwd is advertised and dispatched only for a runner that reads workspaces', async () => {
  const { s } = await world();
  try {
    const cwdOf = (workspaceCwd: boolean) =>
      JSON.stringify(
        coordinatorToolDefs({ ownComputer: true, ownComputerWorkspace: workspaceCwd }).find(
          (def) => def.name === 'user_computer_shell',
        ),
      );
    expect(cwdOf(false)).not.toContain(WORKSPACE_FILE_CWD);
    expect(cwdOf(true)).toContain(WORKSPACE_FILE_CWD);
    const params = { command: 'echo > report.md', cwd: WORKSPACE_FILE_CWD };
    expect(workspaceCwdRefusal(s.db, 'source-runner', params)).toBe(WORKSPACE_CWD_UNSUPPORTED);
    expect(workspaceCwdRefusal(s.db, 'source-runner', { command: 'ls', cwd: '/tmp' })).toBeNull();
    s.db
      .update(machine)
      .set({ capabilities: { mcpServers: [], skills: [], workspaceFileRead: true } })
      .where(eq(machine.id, 'source-runner'))
      .run();
    expect(workspaceCwdRefusal(s.db, 'source-runner', params)).toBeNull();
    expect(workspaceCwdRefusal(s.db, 'other-runner', params)).toBe(WORKSPACE_CWD_UNSUPPORTED);
  } finally {
    s.dispose();
  }
});

test('existing transcripts keep a null source and are not eligible', async () => {
  const { s, history } = await world();
  try {
    s.db
      .insert(message)
      .values({
        id: 'old-row',
        conversationId: CONVERSATION,
        role: 'assistant',
        content: 'old',
        createdAt: 1,
      })
      .run();
    expect(
      s.db.select().from(message).where(eq(message.id, 'old-row')).get()?.fileSource,
    ).toBeNull();
    const page = await history();
    expect(page.messages[0]).toEqual(expect.objectContaining({ id: 'old-row', content: 'old' }));
    expect(page.messages[0]).not.toHaveProperty('workspaceFileLinks');
  } finally {
    s.dispose();
  }
});

function insertShell(
  s: Awaited<ReturnType<typeof world>>['s'],
  id: string,
  stepId: string,
  fields: Partial<typeof computerCall.$inferInsert> = {},
) {
  s.db
    .insert(computerCall)
    .values({
      id,
      teamId: s.team.id,
      stepId,
      toolCallId: id,
      machineId: 'source-runner',
      tool: 'user_computer_shell',
      replaySafe: false,
      params: { command: 'echo > report.md', cwd: WORKSPACE_FILE_CWD },
      state: 'dispatched',
      deadlineAt: 10_000_000_000_000,
      createdAt: 150,
      ...fields,
    })
    .run();
}

const done = (workspace?: string) => ({
  kind: 'done' as const,
  seq: 1,
  text: 'ok',
  ...(workspace === undefined ? {} : { workspace }),
});

test('only the authenticated runner of a sentinel shell call can prove a workspace', async () => {
  const { s } = await world(null);
  try {
    const callId = (n: number) => n.toString(16).padStart(64, '0');
    insertShell(s, callId(1), 'source-step');
    expect(() =>
      receiveComputerFrames(s.db, s.hub, 'other-runner', callId(1), [done(WORKSPACE_B)]),
    ).toThrow();
    receiveComputerFrames(s.db, s.hub, 'source-runner', callId(1), [done(WORKSPACE_A)]);
    expect(
      s.db
        .select()
        .from(computerCall)
        .where(eq(computerCall.id, callId(1)))
        .get()?.workspace,
    ).toBe(WORKSPACE_A);
    insertShell(s, callId(2), 'source-step', { params: { command: 'pwd' } });
    receiveComputerFrames(s.db, s.hub, 'source-runner', callId(2), [done(WORKSPACE_B)]);
    expect(
      s.db
        .select()
        .from(computerCall)
        .where(eq(computerCall.id, callId(2)))
        .get()?.workspace,
    ).toBeNull();
  } finally {
    s.dispose();
  }
});

test('native Coordinator provenance needs one consistent runner and workspace in the current generation', async () => {
  const { s, publish, stored } = await world(null);
  try {
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    const owned = () => ownedStepRow(deps, null, 'source-step');
    expect(nativeFileSource(s.db, owned())).toEqual({
      stepId: 'source-step',
      machineId: null,
      generation: 100,
    });
    insertShell(s, 'c1', 'source-step', { state: 'done', workspace: WORKSPACE_A });
    insertShell(s, 'c2', 'source-step', { state: 'done', workspace: WORKSPACE_A });
    insertShell(s, 'c-old', 'source-step', {
      state: 'done',
      workspace: WORKSPACE_B,
      createdAt: 50,
    });
    insertShell(s, 'c-failed', 'source-step', { state: 'error', workspace: null });
    insertShell(s, 'c-plain', 'source-step', { state: 'done', params: { command: 'ls' } });
    expect(nativeFileSource(s.db, owned())).toEqual({
      stepId: 'source-step',
      machineId: 'source-runner',
      generation: 100,
      workspace: WORKSPACE_A,
    });
    storeTranscriptRow(deps, owned(), 'source-step', {
      id: 'native-row',
      role: 'assistant',
      createdAt: 5,
      content: [{ type: 'text', text: 'Saved report.md' }],
    });
    expect(stored('native-row')?.fileSource?.workspace).toBe(WORKSPACE_A);
    insertShell(s, 'c3', 'source-step', {
      state: 'done',
      machineId: 'other-runner',
      workspace: WORKSPACE_A,
    });
    expect(nativeFileSource(s.db, owned()).workspace).toBeUndefined();
    storeTranscriptRow(deps, owned(), 'source-step', {
      id: 'native-row',
      role: 'assistant',
      createdAt: 5,
      content: [{ type: 'text', text: 'Saved report.md' }],
    });
    expect(stored('native-row')?.fileSource).toEqual({
      stepId: 'source-step',
      machineId: null,
      generation: 100,
    });
    insertShell(s, 'c4', 'source-step', {
      state: 'done',
      workspace: null,
      machineId: 'source-runner',
    });
    expect(nativeFileSource(s.db, owned()).machineId).toBeNull();
    void publish;
  } finally {
    s.dispose();
  }
});
