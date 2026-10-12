// 编排服务面（#1137 抽取）：POST /api/todos/:id/orchestrate 的内联逻辑收口
// 成服务函数——REST 面与 GitHub webhook receiver（#1137）两路共用同一实现，
// 零行为漂移（orchestration-source.test.ts D 组回归面钉住）。
// 语义（#640 / r14 §5.7）：相位闸（todo=开始 / failed=重跑，其余 409）→
// buildOrchestratePrompt → sendChiefMessage（新 chief 线程 + 编排请求首条
// 用户消息 + chief 步入队）→ convHub 推送。

import { buildOrchestratePrompt } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { machine } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { sendChiefMessage } from './chief.js';
import type { ConversationStreamHub } from './events.js';
import { getTodo, type TodoDeps } from './todos.js';

export interface OrchestrateDeps extends TodoDeps {
  /** 会话流即时推送（缺省 = 无推送，bootServer 单测形态）。 */
  convHub?: ConversationStreamHub;
}

/** 开始任务 = 编排回合单出口（REST POST /api/todos/:id/orchestrate 与
 * webhook receiver 共用）。返回 = sendChiefMessage 全形（thread/message/
 * modelFallback）。相位不合法 → 409（HttpError，两调用面同语义）。 */
export function orchestrateTodo(deps: OrchestrateDeps, todoId: string) {
  const record = getTodo(deps, todoId);
  if (!record) throw notFound(`todo ${todoId}`);
  if (record.phase !== 'todo' && record.phase !== 'failed') {
    throw new HttpError(409, `orchestrate 仅适用于 待开始/失败 相位（当前 ${record.phase}）`);
  }
  const machineRow =
    record.machineId !== null
      ? deps.db.select().from(machine).where(eq(machine.id, record.machineId)).get()
      : undefined;
  const content = buildOrchestratePrompt({
    id: record.id,
    seqNum: record.seqNum,
    spec: record.spec,
    failed: record.phase === 'failed',
    ...(machineRow ? { pinnedMachineName: machineRow.name } : {}),
  });
  const result = sendChiefMessage(deps, record.teamId, {
    threadId: null,
    content,
    ...(record.machineId !== null ? { pinnedMachineId: record.machineId } : {}),
  });
  // 会话流即时推送（chief 会话 = chief-<threadId> 键，POST threads 同形）。
  deps.convHub?.publishMessage(result.thread.id, { ...result.message });
  return result;
}
