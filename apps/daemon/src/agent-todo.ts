import {
  AGENT_TODO_LINE_RE,
  AGENT_TODO_MARKER_STATES,
  AGENT_TODO_MAX_ITEMS,
  type AgentTodoItem,
} from '@pacman/shared';

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
