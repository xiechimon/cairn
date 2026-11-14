import { createHash } from 'node:crypto';
import { chiefIdFormat } from '@cairn/shared';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { coordinatorTurnSnapshot, project, step, todo } from '../../src/db/schema.js';
import * as ids from '../../src/lib/ids.js';
import {
  capturePreCallWorld,
  captureToolResult,
  existingTurnCapture,
  openTurnCapture,
  sealCoordinatorTurnSnapshot,
} from '../../src/services/coordinator-turn-capture.js';
import { boot, stub, type World, world } from './runner-world.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function snapshotRow(db: Db, turnId: string) {
  return db
    .select()
    .from(coordinatorTurnSnapshot)
    .where(eq(coordinatorTurnSnapshot.turnId, turnId))
    .get();
}

function toolThenCreateTodo(w: World) {
  w.s.db.insert(project).values({ id: 'p0', teamId: w.teamId, name: 'docs' }).run();
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
  faux.setResponses(
    Array(8).fill((c: { messages: { role: string }[] }) => {
      const last = c.messages.at(-1);
      if (last?.role === 'toolResult') return fauxAssistantMessage('created');
      return fauxAssistantMessage(
        [
          fauxToolCall('create_todo', {
            projectId: 'p0',
            quotes: ['create a task'],
          }),
        ],
        { stopReason: 'toolUse' },
      );
    }),
  );
  return { faux };
}

describe('coordinator turn snapshot writer', () => {
  it('seals a snapshot after a successful chief turn', async () => {
    const w = await world('hello');
    const { faux } = stub('all quiet');
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();

    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
    const row = snapshotRow(w.s.db, w.stepId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('sealed');
    expect(row?.outcome).toBe('success');
    expect(row?.sourceTraceId).toBe(otlpTraceIdOfTurn(w.stepId));
    expect(row?.schemaVersion).toBeGreaterThan(0);
    expect(row?.teamId).toBe(w.teamId);
    expect(row?.payloadBytes).toBe(Buffer.byteLength(row?.payload ?? '', 'utf8'));
    expect(row?.digest).toBe(
      createHash('sha256')
        .update(canonical(JSON.parse(row?.payload ?? 'null')))
        .digest('hex'),
    );
    expect(row?.expiresAt).toBe((row?.capturedAt ?? 0) + 30 * 86_400_000);
  });

  it('captures the verbatim prompt and context inputs fed to the claim', async () => {
    const w = await world('what should I ask?');
    const { faux } = stub('fine');
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();

    const row = snapshotRow(w.s.db, w.stepId);
    expect(row?.status).toBe('sealed');
    const payload = JSON.parse(row?.payload ?? 'null');
    const claim = payload?.claim;
    expect(claim).toBeDefined();
    expect(claim.systemPrompt).toContain('Coordinator');
    expect(claim.instruction).toBe('what should I ask?');
    expect(claim.trigger).toBe('user');
    expect(Array.isArray(claim.memories)).toBe(true);
    expect(claim.memories.join('\n')).toContain('记忆文件');
    expect(claim.provider).toBe('stub');
    expect(claim.modelId).toBe('m');
    expect(claim.volatileText).toBeNull();
  });

  it('keeps the turn successful when snapshot sealing fails and never inserts a second row', async () => {
    const w = await world('hello');
    const { faux } = stub('all quiet');
    const coordinator = boot(w, faux, {});
    coordinator.wake(w.threadId);
    await coordinator.idle();
    const first = snapshotRow(w.s.db, w.stepId);
    expect(first).toBeDefined();

    const before = w.s.db.select().from(coordinatorTurnSnapshot).all().length;
    expect(before).toBe(1);
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
  });

  it.each(['0123456789012345678sk', '0123456789012345678SK', 'sk-012345678901234567'])(
    'records tool-boundary views for create_todo with pre-call world and committed effects for owner %s',
    async (ownerId) => {
      const seedIds = vi
        .spyOn(ids, 'newRecordId')
        .mockReset()
        .mockReturnValueOnce(ownerId)
        .mockReturnValueOnce('012345678901234567890');
      onTestFinished(() => seedIds.mockRestore());
      const w = await world('please create a task');
      const { faux } = toolThenCreateTodo(w);
      const coordinator = boot(w, faux);
      coordinator.wake(w.threadId);
      await coordinator.idle();

      const row = snapshotRow(w.s.db, w.stepId);
      expect(row?.status).toBe('sealed');
      expect(row?.redactionCount).toBe(0);
      const payload = JSON.parse(row?.payload ?? 'null');
      const calls = payload?.toolViews ?? [];
      const createCall = calls.find((c: { tool: string }) => c.tool === 'create_todo');
      expect(createCall).toBeDefined();
      expect(calls.length).toBeLessThanOrEqual(128);
      expect(createCall.preCallTodos).toHaveLength(0);
      const created = w.s.db.select().from(todo).all();
      expect(created).toHaveLength(1);
      const result = JSON.parse(String(createCall.result)) as { id: string; sourceBuildId: string };
      expect(result.id).toBe(created[0]?.id);
      expect(result.sourceBuildId).toBe(chiefIdFormat(ownerId, w.teamId));
      expect(result.sourceBuildId).toBe(created[0]?.sourceBuildId);
    },
  );

  it('never recreates a capture lost to a restart and seals no row for it', async () => {
    const w = await world('hello');
    const db = w.s.db;
    const unclaimedStep = { ...w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()! };
    capturePreCallWorld(db, unclaimedStep.id, w.teamId, 'projects', 'c1', {});
    captureToolResult(unclaimedStep.id, 'projects', []);
    expect(existingTurnCapture(unclaimedStep.id)).toBeUndefined();
    const before = db.select().from(coordinatorTurnSnapshot).all().length;
    sealCoordinatorTurnSnapshot(db, unclaimedStep, w.teamId, 'success', 1234);
    expect(db.select().from(coordinatorTurnSnapshot).all().length).toBe(before);
    openTurnCapture('claimed-elsewhere');
    capturePreCallWorld(db, 'claimed-elsewhere', w.teamId, 'projects', 'c2', {});
    captureToolResult('claimed-elsewhere', 'projects', []);
    const capture = existingTurnCapture('claimed-elsewhere');
    expect(capture?.views).toHaveLength(1);
  });

  it('marks a turn unusable instead of truncating when payload bounds are exceeded', async () => {
    const w = await world('hello');
    const { faux } = stub('ok');
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const rows = w.s.db.select().from(coordinatorTurnSnapshot).all();
    for (const row of rows) {
      if (row.status === 'sealed' && row.payload !== null) {
        expect(Buffer.byteLength(row.payload, 'utf8')).toBeLessThanOrEqual(2 * 1024 * 1024);
      }
      if (row.status === 'unusable') {
        expect(row.reason).toBeTruthy();
        expect(row.payload).toBeNull();
      }
    }
  });
});

it('records the full todo closure of pre-existing todos at claim time', async () => {
  const w = await world('hello');
  w.s.db.insert(project).values({ id: 'p-closure', teamId: w.teamId, name: 'closure' }).run();
  w.s.db
    .insert(todo)
    .values({
      id: 'todo-pre',
      teamId: w.teamId,
      projectId: 'p-closure',
      title: 'pre-existing task',
      spec: 'spec text',
      phase: 'done',
      phaseAt: 5,
      seqNum: 1,
      latestBuildId: null,
      output: 'info',
    })
    .run();
  const seeded = w.s.db.select().from(todo).where(eq(todo.id, 'todo-pre')).get();
  expect(seeded).toBeDefined();
  const { faux } = stub('all quiet');
  const coordinator = boot(w, faux, {});
  coordinator.wake(w.threadId);
  await coordinator.idle();

  const row = snapshotRow(w.s.db, w.stepId);
  expect(row?.status).toBe('sealed');
  const payload = JSON.parse(row?.payload ?? 'null');
  const closure = payload?.claim?.initialTodos ?? [];
  expect(closure).toHaveLength(1);
  expect(closure[0]).toMatchObject({
    id: 'todo-pre',
    projectId: 'p-closure',
    title: 'pre-existing task',
    spec: 'spec text',
    phase: 'done',
    latestBuildId: null,
  });
  expect(Object.keys(closure[0]).sort()).toEqual([
    'archivedAt',
    'blockedBy',
    'id',
    'latestBuildId',
    'orderIndex',
    'output',
    'phase',
    'phaseAt',
    'projectId',
    'request',
    'seqNum',
    'sourceKind',
    'sourceRef',
    'spec',
    'title',
  ]);
  expect(payload?.claim?.initialThreads ?? []).toHaveLength(0);
  expect(payload?.claim?.initialVisible ?? []).toEqual([
    expect.objectContaining({ id: 'todo-pre' }),
  ]);
});

it('does not count the repeated pre-call todo projection against the record cap', async () => {
  const w = await world('please create a task');
  w.s.db.insert(project).values({ id: 'p-cap', teamId: w.teamId, name: 'cap' }).run();
  for (let i = 0; i < 200; i += 1) {
    w.s.db
      .insert(todo)
      .values({
        id: `todo-cap-${i}`,
        teamId: w.teamId,
        projectId: 'p-cap',
        title: `cap ${i}`,
        phase: 'todo',
        phaseAt: 1,
        seqNum: i + 1,
      })
      .run();
  }
  const { faux } = toolThenCreateTodo(w);
  const coordinator = boot(w, faux);
  coordinator.wake(w.threadId);
  await coordinator.idle();

  const row = snapshotRow(w.s.db, w.stepId);
  expect(row?.status).toBe('sealed');
  const payload = JSON.parse(row?.payload ?? 'null');
  expect(payload?.claim?.initialTodos).toHaveLength(200);
  expect((payload?.toolViews ?? []).length).toBeGreaterThan(0);
});

it('seals a closure whose text mentions bearer auth descriptively', async () => {
  const w = await world('hello');
  w.s.db.insert(project).values({ id: 'p-bearer', teamId: w.teamId, name: 'bearer' }).run();
  w.s.db
    .insert(todo)
    .values({
      id: 'todo-bearer',
      teamId: w.teamId,
      projectId: 'p-bearer',
      title: 'auth comparison',
      spec: 'compare Bearer vs api-key auth in the provider seam',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 1,
    })
    .run();
  const { faux } = stub('all quiet');
  const coordinator = boot(w, faux, {});
  coordinator.wake(w.threadId);
  await coordinator.idle();

  const row = snapshotRow(w.s.db, w.stepId);
  expect(row?.status).toBe('sealed');
  expect(row?.redactionCount).toBe(0);
  const payload = JSON.parse(row?.payload ?? 'null');
  expect(payload?.claim?.initialTodos?.[0]?.spec).toContain('Bearer vs api-key');
});
