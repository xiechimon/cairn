type Listener = () => void;

const buffers = new Map<string, string>();
const handoffs = new Map<string, { messageId: string; prefixLen: number }>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const liveThinkingStore = {
  append(conversationId: string, text: string): void {
    buffers.set(conversationId, (buffers.get(conversationId) ?? '') + text);
    emit();
  },
  clear(conversationId: string): void {
    const hadBuffer = buffers.delete(conversationId);
    const hadHandoff = handoffs.delete(conversationId);
    if (hadBuffer || hadHandoff) emit();
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
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
