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

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export function parseAgentTodoText(text: string): AgentTodoItem[] | null {
  let run: AgentTodoItem[] | null = null;
  let inFence = false;
  for (const raw of text.split('\n')) {
    if (FENCE_OPEN.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = AGENT_TODO_LINE_RE.exec(raw);
    if (m === null) {
      run = null;
      continue;
    }
    const content = (m[2] ?? '').trim();
    if (content === '') continue;
    const state = AGENT_TODO_MARKER_STATES[m[1] ?? ''];
    if (state === undefined) continue;
    run = run ?? [];
    if (run.length < AGENT_TODO_MAX_ITEMS) {
      run.push({ text: content, state });
    }
  }
  return run !== null && run.length > 0 ? run : null;
}

export function todoFromTodoWrite(name: unknown, input: unknown): AgentTodoItem[] | null {
  if (name !== 'TodoWrite') return null;
  const todos = (input as { todos?: unknown } | null | undefined)?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const items: AgentTodoItem[] = [];
  for (const raw of todos) {
    const content = (raw as { content?: unknown })?.content;
    const status = (raw as { status?: unknown })?.status;
    if (typeof content !== 'string' || content === '') continue;
    const state = typeof status === 'string' ? CLAUDE_TODO_STATUS_STATES[status] : undefined;
    if (state === undefined) continue;
    if (items.length >= AGENT_TODO_MAX_ITEMS) break;
    items.push({ text: content, state });
  }
  return items.length > 0 ? items : null;
}
