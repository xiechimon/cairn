import { AGENT_DESC_MAX_LENGTH } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { bootServer, insertMachine, req } from './helpers.js';

// #1243 agent.description 长度闸：超 2000 字返回 400 并指明上限。
describe('agent description 长度闸（#1243）', () => {
  const MAX = AGENT_DESC_MAX_LENGTH;

  test('创建 agent description ≤ MAX 成功', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'probe',
      machineId: mid,
      description: 'A'.repeat(MAX),
    });
    expect(res.status).toBe(201);
    s.dispose();
  });

  test('创建 agent description > MAX 返 400', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'probe',
      machineId: mid,
      description: 'A'.repeat(MAX + 1),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
    expect(body.error).toContain(String(MAX));
    s.dispose();
  });

  test('PATCH agent description > MAX 返 400', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    // 先建
    const cr = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'probe',
      machineId: mid,
    });
    const created = (await cr.json()) as { id: string };
    expect(cr.status).toBe(201);
    // 再 patch 超长
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${created.id}`, {
      description: 'A'.repeat(MAX + 1),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
    expect(body.error).toContain(String(MAX));
    s.dispose();
  });

  test('PATCH agent description = MAX 成功', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const cr = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'probe',
      machineId: mid,
    });
    const created = (await cr.json()) as { id: string };
    const res = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${created.id}`, {
      description: 'A'.repeat(MAX),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description: string };
    expect(body.description).toBe('A'.repeat(MAX));
    s.dispose();
  });
});
