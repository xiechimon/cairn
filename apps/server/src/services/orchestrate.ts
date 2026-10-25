import { buildOrchestratePrompt, canOrchestrate } from '@cairn/shared';
import { inArray } from 'drizzle-orm';
import { tag } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { sendChiefMessage } from './chief.js';
import type { ConversationStreamHub } from './events.js';
import { getTodo, type TodoDeps } from './todos.js';

export interface OrchestrateDeps extends TodoDeps {
  convHub?: ConversationStreamHub;
}

export function orchestrateTodo(deps: OrchestrateDeps, todoId: string) {
  const record = getTodo(deps, todoId);
  if (!record) throw notFound(`todo ${todoId}`);
  if (!canOrchestrate(record.phase)) {
    throw conflict(`orchestrate 仅适用于 待开始/失败 相位（当前 ${record.phase}）`);
  }
  const bugLabel =
    record.sourceKind === 'github-issue' && record.tagIds.length > 0
      ? deps.db
          .select({ name: tag.name })
          .from(tag)
          .where(inArray(tag.id, record.tagIds))
          .all()
          .some((row) => row.name.toLowerCase() === 'bug')
      : false;
  const content = buildOrchestratePrompt({
    id: record.id,
    seqNum: record.seqNum,
    spec: record.spec,
    failed: record.phase === 'failed',
    bugLabel,
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
  });
  const result = sendChiefMessage(deps, record.teamId, {
    threadId: null,
    content,
  });
  deps.convHub?.publishMessage(result.thread.id, { ...result.message });
  return result;
}
