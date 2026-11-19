import { z } from 'zod';

export const BACKGROUND_TASK_TEXT_MAX = 2000;

export const backgroundTaskStatusSchema = z.enum([
  'running',
  'done',
  'failed',
  'stopped',
  'orphaned',
]);
export type BackgroundTaskStatus = z.infer<typeof backgroundTaskStatusSchema>;

export const backgroundTaskSchema = z.object({
  taskId: z.string().min(1).max(200),
  toolCallId: z.string().max(200).optional(),
  type: z.enum(['agent', 'shell']),
  description: z.string().max(BACKGROUND_TASK_TEXT_MAX),
  prompt: z.string().max(BACKGROUND_TASK_TEXT_MAX).optional(),
  status: backgroundTaskStatusSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  toolUses: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  summary: z.string().max(BACKGROUND_TASK_TEXT_MAX).optional(),
});
export type BackgroundTask = z.infer<typeof backgroundTaskSchema>;

export function backgroundTaskMessageId(stepId: string, taskId: string): string {
  return `${backgroundTaskMessagePrefix(stepId)}${taskId}`;
}

export function backgroundTaskMessagePrefix(stepId: string): string {
  return `bg-${stepId}-`;
}
