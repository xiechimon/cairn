import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { bootServer, insertMachine, req } from './helpers.js';

const REPORT_WITH_GLM = {
  installed: true,
  hostname: 'test-host',
  models: [{ id: 'glm-5.3', name: 'glm-5.3', slot: 'default' }],
};

describe('agent home machine (#1259)', () => {
  test('POST without machineId -> 400 (home machine required)', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '无机探针',
    });
    expect(res.status).toBe(400);
    s.dispose();
  });

  test('POST with a nonexistent machineId -> 404', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '幽灵机探针',
      machineId: 'machine-ghost',
    });
    expect(res.status).toBe(404);
    s.dispose();
  });

  test('runtime gate: a pi agent bound to a claude-code-only machine -> 400', async () => {
    const s = bootServer();
    const mid = insertMachine(s, { name: 'cc-only', enabledRuntimes: ['claude-code'] });
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'pi 探针',
      machineId: mid,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('pi');
    s.dispose();
  });

  test('model gate: modelId not in the home machine reported list -> 400 naming the model', async () => {
    const s = bootServer();
    const mid = insertMachine(s, { name: 'no-glm', claudeCodeReport: REPORT_WITH_GLM });
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '模型探针',
      provider: 'claude-code',
      modelId: 'kimi-k3',
      machineId: mid,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('kimi-k3');
    s.dispose();
  });

  test('model gate: machine never reported a list (legacy daemon) -> 400', async () => {
    const s = bootServer();
    const mid = insertMachine(s, { name: 'old-daemon' });
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '老 daemon 探针',
      provider: 'claude-code',
      modelId: 'glm-5.3',
      machineId: mid,
    });
    expect(res.status).toBe(400);
    s.dispose();
  });

  test('default-slot exemption + valid creation: claude-code without modelId -> 201; list hit -> 201 and record carries machineId', async () => {
    const s = bootServer();
    const mid = insertMachine(s, { claudeCodeReport: REPORT_WITH_GLM });
    const defaultSlot = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '默认槽探针',
      provider: 'claude-code',
      machineId: mid,
    });
    expect(defaultSlot.status).toBe(201);
    const hit = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '命中探针',
      provider: 'claude-code',
      modelId: 'glm-5.3',
      machineId: mid,
    });
    expect(hit.status).toBe(201);
    const id = ((await hit.json()) as { id: string }).id;
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, id)).get()!.machineId).toBe(mid);
    s.dispose();
  });

  test('rebind: to a machine missing the model -> 400 and the old value stays; to a valid machine -> 200 persisted', async () => {
    const s = bootServer();
    const home = insertMachine(s, { name: 'home', claudeCodeReport: REPORT_WITH_GLM });
    const bad = insertMachine(s, { name: 'bad' });
    const create = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '换绑探针',
      provider: 'claude-code',
      modelId: 'glm-5.3',
      machineId: home,
    });
    const id = ((await create.json()) as { id: string }).id;
    const reject = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
      machineId: bad,
    });
    expect(reject.status).toBe(400);
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, id)).get()!.machineId).toBe(home);
    const ok = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
      machineId: insertMachine(s, { name: 'good', claudeCodeReport: REPORT_WITH_GLM }),
    });
    expect(ok.status).toBe(200);
    const record = (await ok.json()) as { machineId?: string };
    expect(record.machineId).toBe('machine-good');
    s.dispose();
  });

  test('patch backdoor: keeping the binding but swapping modelId to a model the home machine lacks -> 400', async () => {
    const s = bootServer();
    const home = insertMachine(s, { name: 'home', claudeCodeReport: REPORT_WITH_GLM });
    const create = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '后门探针',
      provider: 'claude-code',
      modelId: 'glm-5.3',
      machineId: home,
    });
    const id = ((await create.json()) as { id: string }).id;
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
      modelId: 'kimi-k3',
    });
    expect(res.status).toBe(400);
    expect(s.db.select().from(agentTable).where(eq(agentTable.id, id)).get()!.modelId).toBe(
      'glm-5.3',
    );
    s.dispose();
  });
});
