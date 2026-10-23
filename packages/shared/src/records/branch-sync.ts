// branch_sync record — M7 #319（08 册 §3 story 10）：分支对话框「同步到机器」
// 状态落账。状态机 = pending → running → synced | failed；team stream
// `branch_sync` 事件载荷 = 单源（web 实时结果卡数据面，r1 changelog 09-13）。

import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const branchSyncStatusSchema = z.enum(['pending', 'running', 'synced', 'failed']);
export type BranchSyncStatus = z.infer<typeof branchSyncStatusSchema>;

export const branchSyncRecordSchema = z.object({
  id: recordId,
  /** ≡ buildId = conversationId（02 §4.2/CONTEXT.md 实体等式）。 */
  buildId: recordId,
  machineId: recordId,
  teamId: recordId,
  /** 目标同步目录（机器本机路径，~ 开头 = 用户家目录相对；web 默认
   * `~/<homeDirName>/workspaces/<buildId>`，可改）。 */
  directory: z.string(),
  /** 目标 ref = 分支名（如 `cairn/conv-<uuid>`，brand conversationBranch）；
   * commit = 12hex 目标 commit（spec `目标提交 <12hex>` r3 §3.9 同族显示）。 */
  ref: z.string(),
  commit: z.string(),
  /** force 语义 = 丢弃修改 + 删未跟踪文件（保留 .gitignore 内容），
   * 仅本次生效（M7 #319 r1 changelog 09-13）。 */
  force: z.boolean(),
  status: branchSyncStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: epochMs,
  startedAt: epochMs.nullable(),
  finishedAt: epochMs.nullable(),
});
export type BranchSyncRecord = z.infer<typeof branchSyncRecordSchema>;

/** POST /api/builds/{id}/branch-sync body（M7 #319）：web 用户发起同步。 */
export const createBranchSyncBodySchema = z.object({
  machineId: recordId,
  directory: z.string().min(1),
  ref: z.string().min(1),
  commit: z.string().min(1),
  force: z.boolean(),
});
export type CreateBranchSyncBody = z.infer<typeof createBranchSyncBodySchema>;
