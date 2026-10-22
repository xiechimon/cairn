import { z } from 'zod';
import { epochMs, recordId } from './records/common.js';

export const AGENT_TODO_STATES = ['todo', 'doing', 'done'] as const;
export const agentTodoStateSchema = z.enum(AGENT_TODO_STATES);
export type AgentTodoState = z.infer<typeof agentTodoStateSchema>;

export const agentTodoItemSchema = z.object({
  text: z.string().min(1),
  state: agentTodoStateSchema,
});
export type AgentTodoItem = z.infer<typeof agentTodoItemSchema>;

export const AGENT_TODO_MAX_ITEMS = 64;

export const agentTodoReportSchema = z.object({
  items: z.array(agentTodoItemSchema).max(AGENT_TODO_MAX_ITEMS),
});
export type AgentTodoReport = z.infer<typeof agentTodoReportSchema>;

export const agentTodoSchema = agentTodoReportSchema.extend({
  stepId: recordId,
  at: epochMs,
});
export type AgentTodo = z.infer<typeof agentTodoSchema>;

export const AGENT_TODO_LINE_RE = /^\s*[-*]\s+\[([ xX~/])\]\s+(.*)$/;

export const AGENT_TODO_MARKER_STATES: Record<string, AgentTodoState> = {
  ' ': 'todo',
  x: 'done',
  X: 'done',
  '~': 'doing',
  '/': 'doing',
};

export const CLAUDE_TODO_STATUS_STATES: Record<string, AgentTodoState> = {
  pending: 'todo',
  in_progress: 'doing',
  completed: 'done',
};
