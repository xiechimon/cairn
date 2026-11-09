import { z } from 'zod';
import { epochMs, recordId } from './common.js';
import { askUserQuestionContentSchema } from './message.js';
import { todoRecordSchema } from './todo.js';

export const tasksQuerySchema = z.object({
  todos: z.array(todoRecordSchema),
  questions: z.array(
    z.object({
      requestId: z.string(),
      threadId: recordId,
      projectId: recordId.nullable(),
      title: z.string(),
      section: z.literal('needs_input'),
      createdAt: epochMs,
      content: askUserQuestionContentSchema,
    }),
  ),
});
export type TasksQuery = z.infer<typeof tasksQuerySchema>;
