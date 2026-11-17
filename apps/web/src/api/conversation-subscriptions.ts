export interface ConversationSink {
  onEvent(ev: Record<string, unknown>): void;
  onResync(): void;
  inFlight(): boolean;
  reconcile(refetch: () => void | Promise<void>): void | Promise<void>;
}

const RETRY_MS = 2_000;

const sinks = new Map<string, Set<ConversationSink>>();
let connectionId: string | null = null;
let chain: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

async function putSet(id: string, ids: string[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(id)}/conversations`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds: ids }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function sync(): void {
  const id = connectionId;
  if (id === null) return;
  chain = chain.then(async () => {
    if (connectionId !== id) return;
    const ok = await putSet(id, [...sinks.keys()]);
    if (ok || connectionId !== id) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      sync();
    }, RETRY_MS);
  });
}

export function subscribeConversation(conversationId: string, sink: ConversationSink): () => void {
  let set = sinks.get(conversationId);
  const isNew = set === undefined;
  if (set === undefined) {
    set = new Set();
    sinks.set(conversationId, set);
  }
  set.add(sink);
  if (isNew) queueMicrotask(sync);
  return () => {
    const current = sinks.get(conversationId);
    if (current === undefined) return;
    current.delete(sink);
    if (current.size === 0) {
      sinks.delete(conversationId);
      queueMicrotask(sync);
    }
  };
}

export function attachConnection(id: string): void {
  connectionId = id;
  sync();
}

export function detachConnection(): void {
  connectionId = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

export function deliverConversationEvent(
  conversationId: string,
  ev: Record<string, unknown>,
): void {
  for (const sink of sinks.get(conversationId) ?? []) sink.onEvent(ev);
}

export function resyncConversations(): void {
  for (const set of sinks.values()) for (const sink of set) sink.onResync();
}

export function conversationsInFlight(): boolean {
  for (const set of sinks.values()) for (const sink of set) if (sink.inFlight()) return true;
  return false;
}

export async function reconcileConversations(refetch: () => void | Promise<void>): Promise<void> {
  let started: void | Promise<void>;
  let ran = false;
  const once = () => {
    if (!ran) {
      ran = true;
      started = refetch();
    }
    return started;
  };
  const pending: Promise<void>[] = [];
  for (const set of sinks.values()) {
    for (const sink of set) pending.push(Promise.resolve(sink.reconcile(once)));
  }
  await Promise.all([...pending, Promise.resolve(once())]);
}
