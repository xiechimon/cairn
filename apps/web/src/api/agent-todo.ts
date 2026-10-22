import type { AgentTodo } from '@pacman/shared';

type Listener = () => void;

const current = new Map<string, AgentTodo>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const agentTodoStore = {
  set(conversationId: string, todo: AgentTodo): void {
    current.set(conversationId, todo);
    emit();
  },
  clear(conversationId: string): void {
    if (current.delete(conversationId)) emit();
  },
  get(conversationId: string): AgentTodo | null {
    return current.get(conversationId) ?? null;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
