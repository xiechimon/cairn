import type { TasksQuery } from '@cairn/shared';
import { and, asc, eq, gte, isNull, or } from 'drizzle-orm';
import { chiefMessage, chiefThread, todo } from '../db/schema.js';
import { askQuestionContentOf } from './chief-questions.js';
import { ownershipOf, sectionOf, TASKS_RECENT_MS } from './owner.js';
import { type TodoDeps, toTodoRecords } from './todos.js';

export function listTasks(
  deps: Pick<TodoDeps, 'db'>,
  teamId: string,
  { sectionedOnly = false, now = Date.now() }: { sectionedOnly?: boolean; now?: number } = {},
): TasksQuery {
  const rows = deps.db
    .select()
    .from(todo)
    .where(
      and(
        eq(todo.teamId, teamId),
        or(isNull(todo.archivedAt), gte(todo.archivedAt, now - TASKS_RECENT_MS)),
      ),
    )
    .orderBy(asc(todo.seqNum), asc(todo.id))
    .all()
    .filter(
      (row) => !sectionedOnly || sectionOf(row, ownershipOf(deps.db, row, now), now) !== null,
    );
  const todos = toTodoRecords(deps, rows, now).map((record) => ({
    kind: 'todo' as const,
    ...record,
  }));
  const questions: TasksQuery['entries'] = deps.db
    .select({ message: chiefMessage })
    .from(chiefMessage)
    .innerJoin(chiefThread, eq(chiefThread.id, chiefMessage.threadId))
    .where(
      and(
        eq(chiefThread.teamId, teamId),
        isNull(chiefThread.archivedAt),
        eq(chiefMessage.role, 'assistant'),
      ),
    )
    .orderBy(asc(chiefMessage.createdAt), asc(chiefMessage.id))
    .all()
    .flatMap(({ message }) => {
      const content = askQuestionContentOf(message.content);
      if (content === null || content.status !== 'pending') return [];
      return [
        {
          kind: 'question' as const,
          requestId: content.requestId,
          threadId: message.threadId,
          projectId: message.projectId,
          title: content.questions[0]?.header ?? '',
          section: 'needs_input' as const,
          createdAt: message.createdAt,
          content,
        },
      ];
    });
  return { entries: [...questions, ...todos] };
}
