// build record——02 §6.2（r5 §3.4/§7.2 SSE 实测补录）。
// 实体等式（02 §4.2/CONTEXT.md）：一次运行 = 一个 build = 一个 conversation =
// 一个 worktree + 一条 conv 分支；buildId ≡ conversationId。

import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';
import { assignmentSchema } from './todo.js';

/** 触发源（r5 §7.2 build doc 实测三值：`chief`/`user`/`schedule`）。 */
export const triggerSourceSchema = z.enum(['user', 'chief', 'schedule']);
export type TriggerSource = z.infer<typeof triggerSourceSchema>;

export const buildRecordSchema = z.object({
  id: recordId, // ≡ conversationId（UUIDv7，r3 §3.0）
  todoId: recordId,
  /** 是否走规划（false = 直执行跳 confirm，02 §4.2/r5 §3.4）。 */
  withPlan: z.boolean(),
  /** 本轮启动前 phase（重跑/定时语义用）；null 形状 [推断]。 */
  prevPhase: phaseSchema.nullable(),
  triggerSource: triggerSourceSchema,
  /** plan 文档 id（plan 即文件 plan.md，02 §4.2）；无 plan 时 null [推断]。 */
  planDocId: recordId.nullable(),
  /** 定时重跑时旧 build = "Cancelled"（r5 §7.2 实测）；失败原因同槽（02 §4.2
   * failed canon 文案的数据面）。 */
  errorMessage: z.string().nullable(),
  /** PR 语义仅 GitHub-backed 项目（r3 §3.9 [推断]）；托管 repo 恒 null。 */
  prUrl: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  diffHash: z.string().nullable(),
  createdAt: epochMs,
});
export type BuildRecord = z.infer<typeof buildRecordSchema>;

/** POST /api/projects/{id}/builds body（r5 §3.4 人工启动抓包原样）：
 * todoIds 数组 = 批量启动形状；assignment 按阶段分 plan/build 两槽。 */
export const startBuildsBodySchema = z.object({
  todoIds: z.array(recordId),
  assignment: assignmentSchema,
  withPlan: z.boolean(),
});
export type StartBuildsBody = z.infer<typeof startBuildsBodySchema>;

/** POST /api/builds/{id}/merge → `202 {"delegated":true}`（r3 §3.6 实测；
 * 02 §4.2/A6：merge = 202 delegated 机器执行，合并步 continue session 复用
 * 执行轮会话）。 */
export const mergeAcceptedResponseSchema = z.object({
  delegated: z.literal(true),
});
export type MergeAcceptedResponse = z.infer<typeof mergeAcceptedResponseSchema>;
