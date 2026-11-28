import { buildOrchestratePrompt, canOrchestrate } from '@cairn/shared';
import { conflict, notFound, taskArchived } from '../lib/errors.js';
import { sendChiefMessage } from './chief.js';
import { isCorrectionTask } from './correction.js';
import type { ConversationStreamHub } from './events.js';
import { CORRECTION_PROMPT } from './merge-gate/correction.js';
import { assertProjectWritable } from './project-writable.js';
import { getTodo, type TodoDeps } from './todos.js';

export interface OrchestrateDeps extends TodoDeps {
  convHub?: ConversationStreamHub;
}

export function orchestrateTodo(deps: OrchestrateDeps, todoId: string) {
  const record = getTodo(deps, todoId);
  if (!record) throw notFound(`todo ${todoId}`);
  if (record.archivedAt != null) throw taskArchived();
  assertProjectWritable(deps.db, record.teamId, record.projectId);
  if (!canOrchestrate(record.phase)) {
    throw conflict(`orchestrate 仅适用于 待开始/失败 相位（当前 ${record.phase}）`);
  }
  const content = buildOrchestratePrompt({
    id: record.id,
    seqNum: record.seqNum,
    spec: record.spec,
    failed: record.phase === 'failed',
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    request: record.request ?? null,
  });
  const result = sendChiefMessage(
    deps,
    record.teamId,
    {
      threadId: null,
      projectId: record.projectId,
      content: isCorrectionTask(deps.db, todoId) ? `${CORRECTION_PROMPT}\n\n${content}` : content,
    },
    { ownerWords: false },
  );
  deps.convHub?.publishMessage(result.thread.id, { ...result.message });
  return result;
}
