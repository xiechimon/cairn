import { createHash } from 'node:crypto';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { coordinatorTurnSnapshot, project, step, todo } from '../../src/db/schema.js';
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

  it('records tool-boundary views for create_todo with pre-call world and committed effects', async () => {
    const w = await world('please create a task');
    const { faux } = toolThenCreateTodo(w);
    const coordinator = boot(w, faux);
    coordinator.wake(w.threadId);
    await coordinator.idle();

    const row = snapshotRow(w.s.db, w.stepId);
    expect(row?.status).toBe('sealed');
    const payload = JSON.parse(row?.payload ?? 'null');
    const calls = payload?.toolViews ?? [];
    const createCall = calls.find((c: { tool: string }) => c.tool === 'create_todo');
    expect(createCall).toBeDefined();
    expect(calls.length).toBeLessThanOrEqual(128);
    expect(createCall.preCallTodos).toHaveLength(0);
    const created = w.s.db.select().from(todo).all();
    expect(created).toHaveLength(1);
    const result = JSON.parse(String(createCall.result)) as { id: string };
    expect(result.id).toBe(created[0]?.id);
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
