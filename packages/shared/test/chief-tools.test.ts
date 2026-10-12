// Chief remoteTools 词表对拍（M4a）：raw 观测 49 键集 = r5 §3.1 一手来源
// `docs/research/assets/r5/raw/chief-threads-testA.json` 的 toolDefHashes 全键
// （名单实测；description/parameters 细形 [推断] 黑盒逼近，04 §1 A4 边界——
// 本测试只钉「名单与分组」的实测面，不为 [推断] 细形背书）。
// 现行词表 = raw − CHIEF_TOOLS_REMOVED + CHIEF_TOOLS_ADDED（divergence
// 双向登记：除名一件 = spec 13 #367 delete_skills——技能改本地目录投影，
// 无删除面；加入三件 = XMON-109 spec 13 回摆 create_skill/update_skill——
// chief 自动制作/维护技能收进 scope；#627 models——读侧候选模型清单，
// chief 建/改 Agent 指定模型前先读合法值域。set_remote_shell 已随 XMON-115
// 回摆——「远程 shell」本体（XMON-108 双闸 + XMON-110 daemon 工具）落地后，
// chief 写入点恢复成正式形态。raw 键集冻结不改。）

import { describe, expect, it } from 'vitest';
import {
  CHIEF_REBIND_CONFIRM_COPY,
  CHIEF_REMOTE_TOOLS,
  CHIEF_SETTINGS_TABS,
  CHIEF_TOOL_CATEGORIES,
  CHIEF_TOOL_COUNT,
  CHIEF_TOOL_NAMES,
  CHIEF_TOOLS_ADDED,
  CHIEF_TOOLS_REMOVED,
  CHIEF_WATCHES_EMPTY_COPY,
  chiefIdFormat,
  isChiefConversationId,
  machineToolRelayBodySchema,
  machineToolRelayResponseSchema,
  newChiefThreadId,
  remoteToolDefSchema,
} from '../src/index.js';

/** r5 §3.1 一手来源 = `docs/research/assets/r5/raw/chief-threads-testA.json`
 * 的 toolDefHashes 全键（49 件，已排序原样内嵌；shared 包 node-free 纪律 =
 * 不读 fs，键集冻结在此对拍——改动须回写 raw 与本表）。 */
const RAW_TOOL_DEF_HASH_KEYS = [
  'agents',
  'ask_user',
  'attachment',
  'cancel_builds',
  'clear_wake',
  'close_todos',
  'complete_todos',
  'confirm_builds',
  'connect_repo',
  'conversation',
  'create_agent',
  'create_project',
  'create_todo',
  'delete_agents',
  'delete_memory',
  'delete_secrets',
  'delete_skills',
  'delete_todos',
  'docs',
  'issues',
  'machines',
  'mcp_servers',
  'memories',
  'merge_builds',
  'message_todo',
  'notify_user',
  'projects',
  'pull_requests',
  'reopen_todos',
  'run_builds',
  'run_review',
  'save_memory',
  'schedule_todo',
  'schedules',
  'secrets',
  'set_remote_shell',
  'set_secret',
  'set_wake',
  'skills',
  'todos',
  'unschedule_todo',
  'unwatch_todos',
  'update_agent',
  'update_project',
  'update_todo',
  'usage',
  'wakes',
  'watch_todos',
  'workflow_runs',
];

describe('52 词表（raw 49 − 除名 1 + 新增 4 + 回摆 1）', () => {
  const rawKeys: string[] = RAW_TOOL_DEF_HASH_KEYS;
  const removed: readonly string[] = CHIEF_TOOLS_REMOVED;
  const added: readonly string[] = CHIEF_TOOLS_ADDED;
  const expected = [
    ...rawKeys.filter((name) => !removed.includes(name) && !added.includes(name)),
    ...added,
  ].sort();

  it('raw 键集恰 49 件；现行词表 = raw − 除名 + 新增 = 52 件', () => {
    expect(rawKeys).toHaveLength(49);
    expect(CHIEF_TOOL_COUNT).toBe(52);
    expect(CHIEF_TOOL_COUNT).toBe(rawKeys.length - removed.length + added.length);
  });

  it('词表键集 = raw 键集 − 除名登记 + 新增登记（无其它增删改名）', () => {
    expect(CHIEF_TOOL_NAMES).toEqual(expected);
    expect(CHIEF_REMOTE_TOOLS.map((t) => t.name).sort()).toEqual(expected);
  });

  it('除名登记 = delete_skills；新增登记 = create_skill + update_skill + models + split_todo（divergence 全量双向）；set_remote_shell 已回摆（XMON-115）', () => {
    expect(removed).toEqual(['delete_skills']);
    expect(added).toEqual(['create_skill', 'update_skill', 'models', 'split_todo']);
    // XMON-115 回摆钉：写入点词条/分组/定义三处在位（claim 判定与 REST 双闸
    // 都指着它——缺席即恢复不完整）。
    expect(CHIEF_TOOL_NAMES).toContain('set_remote_shell');
    expect(CHIEF_TOOL_CATEGORIES.organize).toContain('set_remote_shell');
    expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === 'set_remote_shell')).toBeDefined();
    // #1250 split_todo 钉：词条/分组/定义三处在位（chief 拆票编排入口）。
    expect(CHIEF_TOOL_CATEGORIES.organize).toContain('split_todo');
    expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === 'split_todo')).toBeDefined();
    for (const name of removed) {
      expect(CHIEF_TOOL_NAMES).not.toContain(name);
      expect(Object.values(CHIEF_TOOL_CATEGORIES).flat()).not.toContain(name);
      expect(CHIEF_REMOTE_TOOLS.map((t) => t.name)).not.toContain(name);
    }
    // 新增件不在 raw 键集内（反向登记的语义前提）。
    for (const name of added) {
      expect(rawKeys).not.toContain(name);
    }
  });

  it('分组 = 读 16 + 组织 21 + 执行 5 + 私有 10（raw 实数 − delete_skills + 四件新增 + 回摆一件）', () => {
    expect(CHIEF_TOOL_CATEGORIES.read).toHaveLength(16);
    expect(CHIEF_TOOL_CATEGORIES.organize).toHaveLength(21);
    expect(CHIEF_TOOL_CATEGORIES.execute).toHaveLength(5);
    expect(CHIEF_TOOL_CATEGORIES.private).toHaveLength(10);
  });

  it('读侧全 replaySafe（bundle 提取：读工具带重试预算，r5 §3.1）；写侧不标', () => {
    for (const name of CHIEF_TOOL_CATEGORIES.read) {
      expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === name)?.replaySafe, name).toBe(true);
    }
    for (const name of [...CHIEF_TOOL_CATEGORIES.organize, ...CHIEF_TOOL_CATEGORIES.execute]) {
      expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === name)?.replaySafe, name).toBeUndefined();
    }
    // 私有侧读件（memories/wakes）同 replaySafe。
    expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === 'memories')?.replaySafe).toBe(true);
    expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === 'wakes')?.replaySafe).toBe(true);
    expect(CHIEF_REMOTE_TOOLS.find((t) => t.name === 'save_memory')?.replaySafe).toBeUndefined();
  });

  it('每条过 remoteToolDefSchema（bundle 位形 name/label/description/parameters/replaySafe）', () => {
    for (const def of CHIEF_REMOTE_TOOLS) {
      expect(remoteToolDefSchema.safeParse(def).success, def.name).toBe(true);
      expect(def.description.length, def.name).toBeGreaterThan(0);
    }
  });

  it('set_remote_shell 定义形（XMON-115 回摆）：agentId/enabled 双必填、写侧不标 replaySafe', () => {
    const def = CHIEF_REMOTE_TOOLS.find((t) => t.name === 'set_remote_shell');
    const params = def?.parameters as { required?: string[] } | undefined;
    expect(params?.required).toEqual(['agentId', 'enabled']);
    expect(def?.replaySafe).toBeUndefined(); // 写件（grant/revoke 不可重放）
  });

  // #903（ADR 0014）：withPlan 收回工具面 = chief 的逐次派发判定参数，
  // dispatchReason = 判定理由（回执可审计）。失败方式：① 判定参数被标成
  // 必填（缺省即判定的语义断——缺省必须先规划，不能 400）；② 参数除名
  // 回潮（判定权又没了入口）；③ description 退回「不可 per-call 覆盖」
  // 的旧设置 clamp 口径。
  it('run_builds 定义形（#903）：withPlan/dispatchReason 皆可选判定参数，必填仅 todoIds', () => {
    const def = CHIEF_REMOTE_TOOLS.find((t) => t.name === 'run_builds');
    const params = def?.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(params?.required).toEqual(['todoIds']);
    expect(params?.properties?.withPlan).toBeDefined();
    expect(params?.properties?.dispatchReason).toBeDefined();
    expect(def?.description).toContain('per-dispatch judgment');
    expect(def?.description).toContain('review gate');
  });
});

describe('relay wire（bundle 提取原样，r5 §3.1 raw）', () => {
  it('请求 body = {name, params}', () => {
    expect(
      machineToolRelayBodySchema.parse({ name: 'todos', params: { projectId: 'p1' } }),
    ).toEqual({ name: 'todos', params: { projectId: 'p1' } });
  });

  it('成功响应 = {text}（结果 JSON 串）', () => {
    expect(machineToolRelayResponseSchema.parse({ text: '[]' })).toEqual({ text: '[]' });
  });
});

describe('设置齿轮 canon + id 缝（r5 §2/§3.6，AC3 后端半）', () => {
  it('4 tab 与 chief 记录四字段对应（agent/charter/watches/wakes）', () => {
    expect(CHIEF_SETTINGS_TABS).toEqual(['Agent', '章程', '记忆', '关注与提醒']);
  });

  it('换绑二次确认告示 = r5 §2 原文（记忆不迁移）', () => {
    expect(CHIEF_REBIND_CONFIRM_COPY).toBe(
      '更换总管的 agent？总管的记忆保存在其运行所用的 Agent 上。切换至 <agent> 后，记忆将变为 <agent> 的记忆，当前记忆不会迁移。',
    );
    expect(CHIEF_REBIND_CONFIRM_COPY).toContain('当前记忆不会迁移');
  });

  it('关注与提醒空态 canon（r5 §2）', () => {
    expect(CHIEF_WATCHES_EMPTY_COPY).toContain('暂无跟进事项');
  });

  it('chief id 形 = chief-<userId>-<teamId>；conv id 判别单源', () => {
    expect(chiefIdFormat('u1', 't1')).toBe('chief-u1-t1');
    const threadId = newChiefThreadId('01a0c86f-c1fb-7171-9666-64a3db176b5b');
    expect(threadId).toBe('chief-01a0c86f-c1fb-7171-9666-64a3db176b5b');
    expect(isChiefConversationId(threadId)).toBe(true);
    expect(isChiefConversationId(chiefIdFormat('u1', 't1'))).toBe(true); // 同前缀族
    expect(isChiefConversationId('01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toBe(false); // worker build
  });
});
