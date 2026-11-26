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

export function createLiveTextStore(): LiveTextStore {
  const buffers = new Map<string, string>();
  const handoffs = new Map<string, { messageId: string; prefixLen: number }>();
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
      const handoff = handoffs.get(conversationId);
      if (handoff === undefined) {
        store.clear(conversationId);
        return;
      }
      const buf = buffers.get(conversationId) ?? '';
      if (buf.length > handoff.prefixLen) {
        buffers.set(conversationId, buf.slice(0, handoff.prefixLen));
        emit();
      }
    },
    noteSettled(conversationId: string, messageId: string): void {
      const buf = buffers.get(conversationId) ?? '';
      if (buf === '') return;
      handoffs.set(conversationId, { messageId, prefixLen: buf.length });
    },
    getVisible(conversationId: string, knownIds?: Set<string>): string {
      const buf = buffers.get(conversationId) ?? '';
      const h = handoffs.get(conversationId);
      if (h !== undefined && knownIds?.has(h.messageId) === true) {
        return buf.slice(h.prefixLen);
      }
      return buf;
    },
    prune(conversationId: string, knownIds?: Set<string>): void {
      const h = handoffs.get(conversationId);
      if (h === undefined || knownIds?.has(h.messageId) !== true) return;
      const buf = buffers.get(conversationId) ?? '';
      const rest = buf.slice(h.prefixLen);
      if (rest === '') buffers.delete(conversationId);
      else buffers.set(conversationId, rest);
      handoffs.delete(conversationId);
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
