import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable, machine as machineTable } from '../src/db/schema.js';
import { bootServer, insertMachine, req, type TestServer } from './helpers.js';

function seedBoundAgent(s: TestServer, id: string, machineId: string, provider = 'stub-gw') {
  s.db
    .insert(agentTable)
    .values({ id, teamId: s.team.id, displayName: id, provider, modelId: 'stub-model', machineId })
    .run();
}

const REPORT = {
  installed: true,
  hostname: 'h',
  models: [{ id: 'stub-model', name: 'stub-model', slot: 'default' }],
};

describe('machine lifecycle exit (#1259)', () => {
  test('deleting a machine with no agents bound -> 204 + row gone', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(204);
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeUndefined();
    s.dispose();
  });

  test('deleting a machine with bound agents -> 409 naming the occupancy list, row untouched', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    seedBoundAgent(s, 'agent-held-1', mid);
    seedBoundAgent(s, 'agent-held-2', mid);
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('agent-held-1');
    expect(body.error).toContain('agent-held-2');
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeDefined();
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
    seedBoundAgent(s, 'agent-m1', src);
    seedBoundAgent(s, 'agent-m2', src);
    const res = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {
      targetMachineId: dst,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { moved: string[]; rejected: unknown[] };
    expect(body.moved.sort()).toEqual(['agent-m1', 'agent-m2']);
    expect(body.rejected).toEqual([]);
    expect(
      s.db.select().from(agentTable).where(eq(agentTable.id, 'agent-m1')).get()!.machineId,
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
    seedBoundAgent(s, 'agent-ok', src);
    seedBoundAgent(s, 'agent-blocked', src, 'claude-code');
    const res = await req(s.app, 'POST', `/api/machines/${src}/evacuate`, {
      targetMachineId: dst,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      moved: string[];
      rejected: { agentId: string; reason: string }[];
    };
    expect(body.moved).toEqual(['agent-ok']);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]!.agentId).toBe('agent-blocked');
    expect(body.rejected[0]!.reason).toContain('stub-model');
    expect(
      s.db.select().from(agentTable).where(eq(agentTable.id, 'agent-blocked')).get()!.machineId,
    ).toBe(src);
    const del = await req(s.app, 'DELETE', `/api/machines/${src}`);
    expect(del.status).toBe(409);
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
