type Listener = () => void;

export interface LiveTextStore {
  append(conversationId: string, text: string): void;
  clear(conversationId: string): void;
  clearUnlessSettling(conversationId: string): void;
  noteSettled(conversationId: string, messageId: string): void;
  getVisible(conversationId: string, knownIds?: Set<string>): string;
  prune(conversationId: string, knownIds?: Set<string>): void;
  get(conversationId: string): string;
  hasActive(): boolean;
  subscribe(listener: Listener): () => void;
}

interface HandoffEntry {
  messageId: string;
  prefixLen: number;
}

function lastRetiredIndex(
  list: readonly HandoffEntry[] | undefined,
  knownIds?: Set<string>,
): number {
  if (list === undefined || list.length === 0 || knownIds === undefined) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (item !== undefined && knownIds.has(item.messageId)) return i;
  }
  return -1;
}

export function createLiveTextStore(): LiveTextStore {
  const buffers = new Map<string, string>();
  const handoffs = new Map<string, HandoffEntry[]>();
  const listeners = new Set<Listener>();
  let appendFrame: number | null = null;

  const emit = (): void => {
    for (const l of listeners) l();
  };

  const emitOnNextFrame = (): void => {
    if (appendFrame !== null) return;
    appendFrame = requestAnimationFrame(() => {
      appendFrame = null;
      emit();
    });
  };

  const store: LiveTextStore = {
    append(conversationId: string, text: string): void {
      buffers.set(conversationId, (buffers.get(conversationId) ?? '') + text);
      emitOnNextFrame();
    },
    clear(conversationId: string): void {
      const hadBuffer = buffers.delete(conversationId);
      const hadHandoff = handoffs.delete(conversationId);
      if (hadBuffer || hadHandoff) emit();
    },
    clearUnlessSettling(conversationId: string): void {
      const list = handoffs.get(conversationId);
      const last = list?.at(-1);
      if (last === undefined) {
        store.clear(conversationId);
        return;
      }
      const buf = buffers.get(conversationId) ?? '';
      if (buf.length > last.prefixLen) {
        buffers.set(conversationId, buf.slice(0, last.prefixLen));
        emit();
      }
    },
    noteSettled(conversationId: string, messageId: string): void {
      const buf = buffers.get(conversationId) ?? '';
      if (buf === '') return;
      const list = handoffs.get(conversationId) ?? [];
      const existing = list.findIndex((h) => h.messageId === messageId);
      if (existing >= 0) {
        list[existing] = { messageId, prefixLen: buf.length };
      } else {
        list.push({ messageId, prefixLen: buf.length });
      }
      handoffs.set(conversationId, list);
    },
    getVisible(conversationId: string, knownIds?: Set<string>): string {
      const buf = buffers.get(conversationId) ?? '';
      const list = handoffs.get(conversationId);
      const idx = lastRetiredIndex(list, knownIds);
      const entry = idx >= 0 ? list?.[idx] : undefined;
      return entry !== undefined ? buf.slice(entry.prefixLen) : buf;
    },
    prune(conversationId: string, knownIds?: Set<string>): void {
      const list = handoffs.get(conversationId);
      const idx = lastRetiredIndex(list, knownIds);
      const entry = idx >= 0 ? list?.[idx] : undefined;
      if (entry === undefined || list === undefined) return;
      const cutoff = entry.prefixLen;
      const buf = buffers.get(conversationId) ?? '';
      const rest = buf.slice(cutoff);
      if (rest === '') buffers.delete(conversationId);
      else buffers.set(conversationId, rest);
      const remaining = list
        .slice(idx + 1)
        .map((h) => ({ messageId: h.messageId, prefixLen: Math.max(0, h.prefixLen - cutoff) }));
      if (remaining.length === 0) handoffs.delete(conversationId);
      else handoffs.set(conversationId, remaining);
    },
    get(conversationId: string): string {
      return buffers.get(conversationId) ?? '';
    },
    hasActive(): boolean {
      return buffers.size > 0;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return store;
}

export const liveTextStore = createLiveTextStore();
