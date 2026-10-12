// #1259 机器生命周期出口：删机保护 + 整机迁移。
// 失败方式（先于实现固化）：
// 1. 删无机绑定的机器 → 204 + 行消失。
// 2. 删有绑定 agent 的机器 → 409 且响应点名占用 agent 清单，行不动（FK
//    兜底存在但不指望它当人话出口）。
// 3. 删他团队机器 → 404（不泄露存在性）。
// 4. 整机迁移：全部合格 → 全移走，源机随即删得掉。
// 5. 整机迁移：部分 agent 模型不合 → 合格的移、拒的留在原机且响应列明
//    各自原因（部分迁移合法——人逐项处置，不一刀切回滚）。
// 6. 整机迁移目标机不存在/跨团队 → 404；缺目标机 → 400。
// 7. 迁移到本机（源 = 目标）→ 400（语义误导，无操作不是出口）。

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

describe('机器生命周期出口（#1259）', () => {
  test('删无机绑定的机器 → 204 + 行消失', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(204);
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeUndefined();
    s.dispose();
  });

  test('删有绑定 agent 的机器 → 409 点名占用清单，行不动', async () => {
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

  test('删他团队/不存在机器 → 404', async () => {
    const s = bootServer();
    const res = await req(s.app, 'DELETE', '/api/machines/machine-ghost');
    expect(res.status).toBe(404);
    s.dispose();
  });

  test('整机迁移：全部合格 → 全移走，源机随即删得掉', async () => {
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
    // 源机已腾空 → 删得掉。
    const del = await req(s.app, 'DELETE', `/api/machines/${src}`);
    expect(del.status).toBe(204);
    s.dispose();
  });

  test('整机迁移：模型不合的留下并列原因，合格的移走', async () => {
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
    seedBoundAgent(s, 'agent-ok', src); // pi 档（provider 非 claude-code）免模型查
    // claude-code agent 的模型 dst 没配 → 拒。
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
    // 部分迁移后源机仍被占 → 删机仍 409。
    const del = await req(s.app, 'DELETE', `/api/machines/${src}`);
    expect(del.status).toBe(409);
    s.dispose();
  });

  test('目标机不存在 → 404；缺 targetMachineId → 400；源 = 目标 → 400', async () => {
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
