// 51 词表 relay 执行面（#1128 自 chief.test.ts 拆分；判定口径与 M4a 组头注见
// ./chief-harness.ts）。共享 harness 收编位 = ./chief-harness.ts，
// 状态经 H 单出口每用例重绑。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_TOOL_COUNT,
  CHIEF_TOOL_NAMES,
  CHIEF_TOOLS_ADDED,
  CHIEF_TOOLS_REMOVED,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { AGENT_ID, H, registerChiefHarness, relay, seedMachineReport } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

// —— 结构契约: 51 词表 relay 白名单（raw 49 − 除名 1 + 新增 3，XMON-109/115/#627）—————

describe('51 词表 relay 执行面（02 §4.3）', () => {
  test('词表外工具名 → 400（白名单纪律，不执行）', async () => {
    let status = 0;
    try {
      await relay('not_a_tool', {});
    } catch (err) {
      status = err instanceof HttpError ? err.status : 0;
    }
    expect(status).toBe(400);
  });

  // XMON-115 回摆：set_remote_shell 写入点恢复（XMON-108 双闸预检 + XMON-110
  // daemon 工具落地后的收尾）。失败方式先于实现钉死：
  // ① 绕过 filterAgentTools 的裸 Set 写 → 存量残值不清退；② 写 wire 词
  // remote_shell 而非开关词「远程 shell」→ claim localTools 判定不认
  // （machine-shell.test.ts 对拍）；③ revoke 读改写撞掉邻档；④ enabled 缺省
  // 静默当 true（#573 前形如此——fail-open，恢复时收紧为 400）；⑤ 未知
  // agentId 不 404。
  test('set_remote_shell 授予：REST 先写邻档 → chief 增「远程 shell」→ REST GET 回读一致（验收 #2）', async () => {
    // 双入口同字段正向半：REST PATCH 先写（UI 通道语义），chief 再授予。
    const patch = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/agents/${AGENT_ID}`, {
      tools: ['推送分支'],
    });
    expect(patch.status).toBe(200);
    const granted = (await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true })) as {
      agentId: string;
      remoteShell: boolean;
      tools: string[];
    };
    // 返回体带 tools（写点回读，XMON-74 证据探针按此字段复核，见 chief-tools.ts）。
    expect(granted).toEqual({
      agentId: AGENT_ID,
      remoteShell: true,
      tools: ['推送分支', '远程 shell'],
    });
    // REST 回读（验收 #2：chief 改后 UI/API 回读一致——UI 消费同一 GET）。
    const readback = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/agents/${AGENT_ID}`);
    const record = (await readback.json()) as { tools: string[] };
    expect(record.tools).toEqual(['推送分支', '远程 shell']);
  });

  test('撤销只摘「远程 shell」：邻档与顺序不动；重复授予幂等', async () => {
    H.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const revoked = (await relay('set_remote_shell', { agentId: AGENT_ID, enabled: false })) as {
      remoteShell: boolean;
      tools: string[];
    };
    expect(revoked.remoteShell).toBe(false);
    expect(revoked.tools).toEqual(['推送分支']);
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual(['推送分支']);
    await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true });
    await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true });
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual(['推送分支', '远程 shell']);
  });

  test('写路径同过 filterAgentTools：存量残值随写清退（与 REST PATCH 同律）', async () => {
    H.s.db
      .update(agentTable)
      .set({ tools: ['自造档', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    await relay('set_remote_shell', { agentId: AGENT_ID, enabled: true });
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual(['推送分支', '远程 shell']);
  });

  test('enabled 缺省/非布尔 → 400 且行未写（fail-closed；不沿用 #573 前缺省 true）', async () => {
    for (const bad of [{ agentId: AGENT_ID }, { agentId: AGENT_ID, enabled: 'yes' }]) {
      let status = 0;
      try {
        await relay('set_remote_shell', bad);
      } catch (err) {
        status = err instanceof HttpError ? err.status : 0;
      }
      expect(status).toBe(400);
    }
    expect(
      H.s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!.tools,
    ).toEqual([]);
  });

  test('未知 agentId → 404（requireTeamAgent 同律，不误写）', async () => {
    let status = 0;
    let message = '';
    try {
      await relay('set_remote_shell', { agentId: 'agent-nope', enabled: true });
    } catch (err) {
      status = err instanceof HttpError ? err.status : 0;
      message = err instanceof HttpError ? err.message : '';
    }
    expect(status).toBe(404);
    expect(message).toContain('agent-nope');
  });

  // #627 models 读工具：候选清单行语义 = web toModelOptions 投影（#770 起
  // providers 段已除，只剩 model-sources 非 pi 段，first-wins 去重）。
  // 失败方式先于实现钉死：① 无 provider 且 claude-code 未装时报错而非空集；
  // ② 空 id 行漏跳 → 脏行；③ pi 段重复产行；④ claude-code 段 providerLabel
  // 落 runtime 原词而非显示名 → 与 web 候选不同义；⑤ custom provider 的
  // models[] 不再被任何候选面引用（providers 写面照常可用）。
  test('models：无 custom provider + claude-code 未装 → 空清单不报错', async () => {
    expect(await relay('models', {})).toEqual([]);
  });

  test('models：providers 写面照常，候选只出 claude-code 段（去重 + 行卫生）', async () => {
    const provRes = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/providers`, {
      providerId: 'gw-a',
      label: '网关甲',
      baseUrl: 'https://a.example.com/v1',
      api: 'openai-completions',
      models: [
        { id: 'model-a', name: '模型甲' },
        { id: 'model-b', name: '' },
        { id: '', name: '空 id 行' },
      ],
    });
    expect(provRes.status).toBe(201);
    // claude-code 段：上报行（default 槽 + opus 槽同 id → 段内去重留一行）；
    // providers 段（gw-a 三行）一律不产候选行（#770）。
    seedMachineReport('exec-1', {
      installed: true,
      hostname: 'exec-host-1',
      models: [
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5' },
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5' },
      ],
    });
    const rows = (await relay('models', {})) as {
      provider: string;
      providerLabel: string;
      modelId: string;
      modelName: string;
    }[];
    expect(rows).toEqual([
      { provider: 'pi', providerLabel: 'pi', modelId: 'model-a', modelName: '模型甲' },
      { provider: 'pi', providerLabel: 'pi', modelId: 'model-b', modelName: 'model-b' },
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'claude-opus-4-5',
        modelName: 'claude-opus-4-5',
      },
    ]);
  });

  test('models：custom provider 取名 claude-code 不再遮蔽上报行（#770/#707）', async () => {
    const provRes = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/providers`, {
      providerId: 'claude-code',
      label: '同名网关',
      baseUrl: 'https://cc.example.com/v1',
      api: 'openai-completions',
      models: [{ id: 'm-cc', name: '同名行' }],
    });
    expect(provRes.status).toBe(201);
    seedMachineReport('exec-1', {
      installed: true,
      hostname: 'exec-host-1',
      models: [{ id: 'm-cc', name: 'm-cc' }],
    });
    const rows = (await relay('models', {})) as {
      provider: string;
      providerLabel: string;
      modelId: string;
      modelName: string;
    }[];
    // providers 段已除：同名 provider 记录存在，但候选行取执行机上报
    // （品牌 label 'Claude Code'，name 原样）。
    expect(rows).toEqual([
      { provider: 'pi', providerLabel: 'pi', modelId: 'm-cc', modelName: '同名行' },
      { provider: 'claude-code', providerLabel: 'Claude Code', modelId: 'm-cc', modelName: 'm-cc' },
    ]);
  });

  test('读工具 replaySafe 标记与执行一致（抽样 projects/todos/machines/models）', async () => {
    for (const name of ['projects', 'todos', 'machines', 'models']) {
      const def = CHIEF_REMOTE_TOOLS.find((t) => t.name === name)!;
      expect(def.replaySafe).toBe(true);
      expect(await relay(name, {})).toBeDefined();
    }
  });

  test('词表键集 = r5 raw toolDefHashes 全键 − 除名登记（一手来源防漂移，node fs 面）', () => {
    const raw = resolve(
      import.meta.dirname,
      '../../../docs/research/assets/r5/raw/chief-threads-testA.json',
    );
    const doc = JSON.parse(readFileSync(raw, 'utf8')) as unknown;
    const found: string[][] = [];
    const walk = (o: unknown) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o !== null && typeof o === 'object') {
        const rec = o as Record<string, unknown>;
        if (rec.toolDefHashes && typeof rec.toolDefHashes === 'object') {
          found.push(Object.keys(rec.toolDefHashes as Record<string, unknown>));
        }
        Object.values(rec).forEach(walk);
      }
    };
    walk(doc);
    expect(found.length).toBeGreaterThan(0);
    // divergence 双向登记（XMON-109/XMON-115/#627）：raw 观测 49 键冻结，现行
    // 词表 = raw − CHIEF_TOOLS_REMOVED（delete_skills）+ CHIEF_TOOLS_ADDED
    // （create_skill/update_skill，chief 免开关；models，#627 候选清单）
    // + set_remote_shell 回摆。
    const removed: readonly string[] = CHIEF_TOOLS_REMOVED;
    const added: readonly string[] = CHIEF_TOOLS_ADDED;
    const expected = (found[0] as string[]).filter(
      (name) => !removed.includes(name) && !added.includes(name),
    );
    expect(CHIEF_TOOL_NAMES).toEqual([...expected, ...added].sort());
  });

  test('chief-tools.ts 里所有「现行 N 件」文字与 CHIEF_TOOL_COUNT 一致', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../packages/shared/src/protocol/chief-tools.ts'),
      'utf8',
    );
    const stated = [...source.matchAll(/现行 (\d+) 件/g)].map((match) => Number(match[1]));
    expect(stated.length).toBeGreaterThan(0);
    expect(stated.every((count) => count === CHIEF_TOOL_COUNT)).toBe(true);
  });
});
