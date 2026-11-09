import { z } from 'zod';
import { epochMs, recordId } from './common.js';
import { askUserQuestionContentSchema } from './message.js';
import { todoRecordSchema, todoSectionSchema } from './todo.js';

export const tasksQuerySchema = z.object({
  entries: z.array(
    z.discriminatedUnion('kind', [
      todoRecordSchema.extend({ kind: z.literal('todo'), section: todoSectionSchema.nullable() }),
      z.object({
        kind: z.literal('question'),
        requestId: z.string(),
        threadId: recordId,
        projectId: recordId.nullable(),
        title: z.string(),
        section: z.literal('needs_input'),
        createdAt: epochMs,
        content: askUserQuestionContentSchema,
      }),
    ]),
  ),
});
export type TasksQuery = z.infer<typeof tasksQuerySchema>;
