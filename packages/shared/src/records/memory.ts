// agent_memory record——02 §4.4（r5 §6 实测改判）。
// 最小机制（A8 锁定）：Agent 条目集（配额 100 + 溯源）+ 每步 systemPrompt
// 注入 [推断保留——读侧注入形未获一手证据，实现期自证] + `save_memory` 写
// 工具（指令触发 + Agent 裁量；「任务结束自动蒸馏」证伪，原内部名 `remember`
// 作废）。Chief 与绑定 Agent 共用同一存储（换绑不迁移，r5 §2）。

import { z } from 'zod';
import { epochMs, recordId } from './common.js';

/** 配额 100 条/Agent（r5 §6：UI `记忆 · n / 100`）。 */
export const MEMORY_QUOTA_PER_AGENT = 100;

/** 写工具名（r5 §6 改判：agent 工具 save_memory，经 remoteTools 服务端执行；
 * Chief 词表同族 save_memory/delete_memory/memories）。 */
export const MEMORY_TOOLS = ['save_memory', 'update_memory', 'delete_memory', 'memories'] as const;

/** 空态文案 canon（02 §4.4/r3 §4 原文；Chief 设置记忆 tab 同文）。 */
export const MEMORY_EMPTY_COPY = '尚无记忆。Agent 会在工作中将值得沉淀的经验存入此处。';

/** 条目形状（r5 §6 实测原样）——带项目/todo/build 三级溯源。 */
export const memoryRecordSchema = z.object({
  id: recordId,
  agentId: recordId,
  teamId: recordId,
  title: z.string(),
  content: z.string(),
  /** 三级溯源；无任务上下文的写入未观测，null 容忍 [推断]。 */
  projectId: recordId.nullable(),
  sourceTodoId: recordId.nullable(),
  /** chief 来源时为 chief 回合 id（`chief-…` 形，r5 §3.2 同族）。 */
  sourceBuildId: z.string().nullable(),
  createdAt: epochMs,
  updatedAt: epochMs,
  invalidAt: epochMs.nullable().optional(),
  supersededBy: recordId.nullable().optional(),
  lastInjectedAt: epochMs.nullable().optional(),
  history: z
    .array(z.object({ title: z.string(), content: z.string(), updatedAt: epochMs }))
    .optional(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

/** 记忆 tab UI 词（r5 §6：搜索 `搜索记忆…` + `排序` + 条目卡 `添加 <相对时间>`
 * + `来源任务` 溯源链接）。 */
export const MEMORY_UI_COPY = {
  searchPlaceholder: '搜索记忆…',
  sort: '排序',
  sourceLink: '来源任务',
} as const;
