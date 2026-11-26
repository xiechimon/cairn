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

export const AGENT_TODO_LINE_RE = /^\s*[-*]\s+\[([ xX~/])\]\s+(\S.*|)$/;

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

const TODO_ORDINAL = /^\d+[.)、]\s*/;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

const STANDALONE_TODO_HEADER_RE =
  /^(?:#{1,6}\s+)?(?:\*{1,2}|_{1,2})?(?:计划|任务清单|清单|待办|待办事项|步骤|Plan|Plans|Todo|Todos|To-Do|Checklist|Task\s+list|Tasks|Steps)(?:\*{1,2}|_{1,2})?\s*(?:[:：]\s*)?$/i;

export function parseAgentTodoText(text: string): AgentTodoItem[] | null {
  let run: AgentTodoItem[] | null = null;
  let closed: AgentTodoItem[] | null = null;
  let inFence = false;
  for (const raw of text.split('\n')) {
    if (FENCE_OPEN.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = AGENT_TODO_LINE_RE.exec(raw);
    if (m === null) {
      if (run !== null) closed = run;
      run = null;
      continue;
    }
    const content = (m[2] ?? '').trim().replace(TODO_ORDINAL, '');
    if (content === '') continue;
    const state = AGENT_TODO_MARKER_STATES[m[1] ?? ''];
    if (state === undefined) continue;
    run = run ?? [];
    if (run.length < AGENT_TODO_MAX_ITEMS) {
      run.push({ text: content, state });
    }
  }
  const last = run ?? closed;
  return last !== null && last.length > 0 ? last : null;
}

export function stripAgentTodoText(text: string): string {
  if (parseAgentTodoText(text) === null) return text;
  const lines = text.split('\n');
  const fenced = new Array<boolean>(lines.length).fill(false);
  const remove = new Array<boolean>(lines.length).fill(false);
  let inFence = false;
  let runStart = -1;
  let runHasItem = false;

  const flushRun = (endExclusive: number) => {
    if (runStart < 0 || !runHasItem) {
      runStart = -1;
      runHasItem = false;
      return;
    }
    for (let i = runStart; i < endExclusive; i++) remove[i] = true;
    let back = runStart - 1;
    while (back >= 0 && !fenced[back] && (lines[back] ?? '').trim() === '') back--;
    if (back >= 0 && !fenced[back] && STANDALONE_TODO_HEADER_RE.test((lines[back] ?? '').trim())) {
      for (let i = back; i < runStart; i++) remove[i] = true;
    }
    runStart = -1;
    runHasItem = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (FENCE_OPEN.test(raw)) {
      flushRun(i);
      fenced[i] = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fenced[i] = true;
      continue;
    }
    const m = AGENT_TODO_LINE_RE.exec(raw);
    if (m === null) {
      flushRun(i);
      continue;
    }
    if (runStart < 0) runStart = i;
    const content = (m[2] ?? '').trim().replace(TODO_ORDINAL, '');
    const state = AGENT_TODO_MARKER_STATES[m[1] ?? ''];
    if (content !== '' && state !== undefined) runHasItem = true;
  }
  flushRun(lines.length);

  const kept: string[] = [];
  let sawRemoved = false;
  for (let i = 0; i < lines.length; i++) {
    if (remove[i]) {
      sawRemoved = true;
      continue;
    }
    const line = lines[i] ?? '';
    if (
      sawRemoved &&
      !fenced[i] &&
      line.trim() === '' &&
      (kept.length === 0 || (kept.at(-1) ?? '').trim() === '')
    ) {
      continue;
    }
    if (line.trim() !== '') sawRemoved = false;
    kept.push(line);
  }
  while (kept.length > 0 && (kept.at(-1) ?? '').trim() === '' && sawRemoved) {
    kept.pop();
  }
  return kept.join('\n');
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

export function agentTodoOfContent(content: unknown): AgentTodoItem[] | null {
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const c = content as {
      kind?: unknown;
      call?: { name?: unknown; arguments?: unknown; todo?: AgentTodoItem[]; isError?: boolean };
    };
    if (c.kind !== 'toolcall' || c.call == null || c.call.isError === true) return null;
    const items = c.call.todo ?? todoFromTodoWrite(c.call.name, c.call.arguments);
    return items !== null && items.length > 0 ? items : null;
  }
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((b: unknown) => {
              if (typeof b === 'string') return b;
              const block = b as { type?: unknown; text?: unknown } | null;
              return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
            })
            .join('')
        : '';
  return parseAgentTodoText(text.trim());
}
