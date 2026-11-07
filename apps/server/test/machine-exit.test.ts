import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { machine as machineTable, routingRule } from '../src/db/schema.js';
import { bootServer, insertMachine, req, seedRoute } from './helpers.js';

const REPORT = {
  installed: true,
  hostname: 'h',
  models: [{ id: 'stub-model', name: 'stub-model', slot: 'default' }],
};

describe('machine lifecycle exit (#1259)', () => {
  test('deleting a machine with no routing rule pinned -> 204 + row gone', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(204);
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeUndefined();
    s.dispose();
  });

  test('deleting a machine with pinned routing rules -> 204 and the rules float again', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const sessionId = seedRoute(s, 'session', { provider: 'stub-gw', machineId: mid });
    const reviewId = seedRoute(s, 'review', { provider: 'stub-gw', machineId: mid });
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(204);
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeUndefined();
    for (const id of [sessionId, reviewId]) {
      expect(s.db.select().from(routingRule).where(eq(routingRule.id, id)).get()?.machineId).toBe(
        null,
      );
    }
    s.dispose();
  });

  test('deleting another team / nonexistent machine -> 404', async () => {
    const s = bootServer();
    const res = await req(s.app, 'DELETE', '/api/machines/machine-ghost');
    expect(res.status).toBe(404);
    s.dispose();
  });

  test('full-machine migration: all valid -> all moved, source machine immediately deletable', async () => {
    const s = bootServer();
    const src = insertMachine(s, { name: 'src', claudeCodeReport: REPORT });
    const dst = insertMachine(s, { name: 'dst', claudeCodeReport: REPORT });
    const sessionId = seedRoute(s, 'session', { provider: 'stub-gw', machineId: src });
    const reviewId = seedRoute(s, 'review', { provider: 'stub-gw', machineId: src });
    const res = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {
      targetMachineId: dst,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { moved: string[]; rejected: unknown[] };
    expect(body.moved.sort()).toEqual([sessionId, reviewId].sort());
    expect(body.rejected).toEqual([]);
    expect(
      s.db.select().from(routingRule).where(eq(routingRule.id, sessionId)).get()!.machineId,
    ).toBe(dst);
    const del = await req(s.app, 'DELETE', `/api/machines/${src}`);
    expect(del.status).toBe(204);
    s.dispose();
  });

  test('full-machine migration: model-mismatched stay with the reason listed, valid ones moved', async () => {
    const s = bootServer();
    const src = insertMachine(s, { name: 'src', claudeCodeReport: REPORT });
    const dst = insertMachine(s, {
      name: 'dst',
      claudeCodeReport: {
        installed: true,
        hostname: 'h',
        models: [{ id: 'other-model', name: 'other-model', slot: 'default' }],
      },
    });
    const okId = seedRoute(s, 'session', { provider: 'stub-gw', machineId: src });
    const blockedId = seedRoute(s, 'review', {
      provider: 'claude-code',
      modelId: 'stub-model',
      machineId: src,
    });
    const res = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {
      targetMachineId: dst,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      moved: string[];
      rejected: { agentId: string; reason: string }[];
    };
    expect(body.moved).toEqual([okId]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]!.agentId).toBe(blockedId);
    expect(body.rejected[0]!.reason).toContain('stub-model');
    expect(
      s.db.select().from(routingRule).where(eq(routingRule.id, blockedId)).get()!.machineId,
    ).toBe(src);
    s.dispose();
  });

  test('target machine missing -> 404; missing targetMachineId -> 400; source = target -> 400', async () => {
    const s = bootServer();
    const src = insertMachine(s, { name: 'src' });
    const ghost = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {
      targetMachineId: 'machine-ghost',
    });
    expect(ghost.status).toBe(404);
    const missing = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {});
    expect(missing.status).toBe(400);
    const self = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {
      targetMachineId: src,
    });
    expect(self.status).toBe(400);
    s.dispose();
  });
});
