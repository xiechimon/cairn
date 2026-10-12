// #1259 agent 归属机：创建必填 + 换绑校验（模型/runtime 闸）。
// 失败方式（先于实现固化）：
// 1. POST 缺 machineId → 必须 400（契约必填），否则浮动 agent 形态复活。
// 2. POST 带他团队/不存在 machineId → 必须当 404，否则跨团队绑定他队机器。
// 3. runtime 闸：pi agent 绑到只开 claude-code 的机器 → 必须 400，否则
//    出生即死（步永远领不走）。
// 4. 模型闸：claude-code agent 的 modelId 不在归属机上报清单 → 必须 400
//    且点名缺的模型，否则「选到的模型必 400」的洞从创建面溜回。
// 5. 未上报过模型清单的机器（老 daemon）→ 必须 400（无法证明配了模型），
//    否则闸对老 daemon 形同虚设。
// 6. 默认槽豁免：claude-code agent 不带 modelId → 必须 201（跟随机器默认
//    槽，恒可用）。
// 7. 换绑：PATCH machineId 到缺模型的机器 → 必须 400 且原值不动；到合格
//    机器 → 200 且落库。
// 8. patch 后门：不换绑只改 modelId 到归属机没有的模型 → 必须 400。

import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { bootServer, insertMachine, req } from './helpers.js';

const REPORT_WITH_GLM = {
  installed: true,
  hostname: 'test-host',
  models: [{ id: 'glm-5.3', name: 'glm-5.3', slot: 'default' }],
};

describe('agent 归属机（#1259）', () => {
  test('POST 缺 machineId → 400（归属机必填）', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '无机探针',
    });
    expect(res.status).toBe(400);
    s.dispose();
  });

  test('POST 带不存在的 machineId → 404', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: '幽灵机探针',
      machineId: 'machine-ghost',
    });
    expect(res.status).toBe(404);
    s.dispose();
  });

  test('runtime 闸：pi agent 绑只开 claude-code 的机器 → 400', async () => {
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

  test('模型闸：modelId 不在归属机上报清单 → 400 点名模型', async () => {
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

  test('模型闸：机器从未上报清单（老 daemon）→ 400', async () => {
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

  test('默认槽豁免 + 合格创建：claude-code 无 modelId → 201；清单命中 → 201 且记录带 machineId', async () => {
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

  test('换绑：到缺模型的机器 → 400 原值不动；到合格机器 → 200 落库', async () => {
    const s = bootServer();
    const home = insertMachine(s, { name: 'home', claudeCodeReport: REPORT_WITH_GLM });
    const bad = insertMachine(s, { name: 'bad' }); // 从未上报
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

  test('patch 后门：不改绑、只把 modelId 换成归属机没有的模型 → 400', async () => {
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
