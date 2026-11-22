const seeds = new Map<string, string>();
const listeners = new Set<() => void>();

export function seedSideChat(todoId: string, text: string): void {
  seeds.set(todoId, text);
  for (const listener of listeners) listener();
}

export function takeSideChatSeed(todoId: string): string | undefined {
  const seed = seeds.get(todoId);
  seeds.delete(todoId);
  return seed;
}

export function onSideChatSeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
