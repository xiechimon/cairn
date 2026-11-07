import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { workPolicy } from '../src/db/schema.js';
import { bootServer, req, seedPolicy } from './helpers.js';

function sessionTools(s: ReturnType<typeof bootServer>): string[] | undefined {
  return s.db
    .select()
    .from(workPolicy)
    .where(and(eq(workPolicy.teamId, s.team.id), eq(workPolicy.use, 'session')))
    .get()?.tools;
}

function patchPolicy(s: ReturnType<typeof bootServer>, body: Record<string, unknown>) {
  return req(s.app, 'PATCH', `/api/teams/${s.team.id}/work-policies/session`, body);
}

describe('Work policy tools write-side filtering (XMON-77)', () => {
  test('create: out-of-vocabulary values (self-made entry and retired remote shell) silently dropped, remaining switches kept in order', async () => {
    const s = bootServer();
    const res = await patchPolicy(s, {
      tools: ['推送分支', '远程 shell', '创建标签', '自造档', '更新技能'],
    });
    expect(res.status).toBe(200);
    expect(sessionTools(s)).toEqual(['推送分支', '创建标签', '更新技能']);
    s.dispose();
  });

  test('create: explicit all-off (tools:[]) stays empty', async () => {
    const s = bootServer();
    const res = await patchPolicy(s, { tools: [] });
    expect(res.status).toBe(200);
    expect(sessionTools(s)).toEqual([]);
    s.dispose();
  });

  test('patch: read-modify-write carrying out-of-vocabulary values -> residual values cleared on write', async () => {
    const s = bootServer();
    seedPolicy(s, 'session', { tools: ['自造档', '创建技能'] });
    const res = await patchPolicy(s, { tools: ['自造档', '创建技能', '推送分支'] });
    expect(res.status).toBe(200);
    expect(sessionTools(s)).toEqual(['创建技能', '推送分支']);
    s.dispose();
  });

  test('patch: tools absent -> granted set unchanged (undefined != cleared)', async () => {
    const s = bootServer();
    seedPolicy(s, 'session', { tools: ['合并分支', '推送分支'] });
    const res = await patchPolicy(s, { defaultSkill: 'skill-a' });
    expect(res.status).toBe(200);
    expect(sessionTools(s)).toEqual(['合并分支', '推送分支']);
    s.dispose();
  });

  test('patch: clearing (tools: []) is an explicit all-off', async () => {
    const s = bootServer();
    seedPolicy(s, 'session', { tools: ['推送分支'] });
    const res = await patchPolicy(s, { tools: [] });
    expect(res.status).toBe(200);
    expect(sessionTools(s)).toEqual([]);
    s.dispose();
  });
});
