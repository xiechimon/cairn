import { CHIEF_NOTICE_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefMessage, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { chiefRowOf, existingCoordinatorThread } from './chief-rows.js';
import type { ConversationStreamHub } from './events.js';

export const MERGE_LANDED_TEXT = '合并完成：改动已并入默认分支。';
export const MERGE_UNCONFIRMED_TEXT =
  '合并步已完成；PR 的合并状态以 GitHub 对账结果为准，cairn 读到合并后再记录。';

type AnnounceDeps = {
  db: Db;
  user: { id: string };
  convHub?: ConversationStreamHub | undefined;
};

export function announceMergeStepOutcome(
  deps: AnnounceDeps,
  input: { stepId: string; buildId: string; text: string },
): void {
  const buildRow = deps.db.select().from(build).where(eq(build.id, input.buildId)).get();
  if (!buildRow) return;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return;
  const chiefRow = chiefRowOf(deps, todoRow.teamId);
  if (chiefRow === undefined) return;
  const thread = existingCoordinatorThread(deps, chiefRow);
  if (thread === undefined) return;
  const notice = {
    id: `merge-outcome-${input.stepId}-${thread.id}`,
    threadId: thread.id,
    role: 'system' as const,
    content: JSON.stringify({
      kind: CHIEF_NOTICE_KIND,
      message: `任务「${todoRow.title}」：${input.text}`,
      provenance: `merge:${todoRow.id}`,
    }),
    projectId: todoRow.projectId,
    createdAt: nowMs(),
  };
  const inserted = deps.db.insert(chiefMessage).values(notice).onConflictDoNothing().run();
  if (inserted.changes === 0) return;
  deps.convHub?.publishMessage(thread.id, notice);
}
