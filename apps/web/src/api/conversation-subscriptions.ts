import { streamFollowAckSchema } from '@cairn/shared';
import { fetchWithSession } from './auth.js';

export interface ConversationSink {
  onEvent(ev: Record<string, unknown>, legacy: boolean, teamId: string): void;
  onResync(): void;
  inFlight(): boolean;
  reconcile(refetch: () => void | Promise<void>): void | Promise<void>;
}

const PUT_DEADLINE_MS = 10_000;
const RETRY_MS = 2_000;

type FollowMode = 'unknown' | 'versioned' | 'legacy';
type PutResult = 'ack' | 'legacy-ack' | 'legacy-reject' | 'retry' | 'replace';

type Connection = {
  id: string;
  mode: FollowMode;
  controller: AbortController;
  appliedRevision: number;
  mayFollow: Set<string>;
  running: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
  acknowledge: (isCurrent: () => boolean, followedIds: readonly string[]) => void;
  replace: () => void;
};

const sinks = new Map<string, Set<ConversationSink>>();
let connection: Connection | null = null;
let revision = 0;
let followSyncScheduled = false;

async function putSet(
  current: Connection,
  conversationIds: string[],
  sent: number,
): Promise<PutResult> {
  const attachment = current.controller.signal;
  const attempt = new AbortController();
  const retry = current.mode === 'versioned' ? 'retry' : 'replace';
  let abandon!: () => void;
  const abandoned = new Promise<PutResult>((resolve) => {
    abandon = () => {
      attempt.abort();
      resolve(retry);
    };
  });
  const deadline = setTimeout(abandon, PUT_DEADLINE_MS);
  attachment.addEventListener('abort', abandon, { once: true });
  try {
    const path = `/api/streams/${encodeURIComponent(current.id)}/conversations`;
    const response = fetchWithSession(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        current.mode === 'legacy' ? { conversationIds } : { conversationIds, revision: sent },
      ),
      signal: attempt.signal,
    }).then(async (res): Promise<PutResult> => {
      if (res.status === 404) return 'replace';
      if (current.mode === 'unknown' && (res.status === 400 || res.status === 422)) {
        return 'legacy-reject';
      }
      if (!res.ok) return res.status >= 500 ? retry : 'retry';
      if (current.mode === 'legacy' || (current.mode === 'unknown' && res.status === 204)) {
        return 'legacy-ack';
      }
      const ack = streamFollowAckSchema.safeParse(await res.json());
      return ack.success && ack.data.revision === sent ? 'ack' : 'replace';
    });
    return await Promise.race([abandoned, response]);
  } catch {
    return retry;
  } finally {
    clearTimeout(deadline);
    attachment.removeEventListener('abort', abandon);
  }
}

async function sync(): Promise<void> {
  const current = connection;
  if (current === null || current.running || current.appliedRevision === revision) return;
  clearTimeout(current.retryTimer);
  current.retryTimer = undefined;
  current.running = true;
  try {
    while (current === connection && current.appliedRevision !== revision) {
      const sent = revision;
      const ids = [...sinks.keys()];
      for (const id of ids) current.mayFollow.add(id);
      const result = await putSet(current, ids, sent);
      if (current !== connection) return;
      if (result === 'replace') {
        current.replace();
        return;
      }
      if (result === 'legacy-reject') {
        current.mode = 'legacy';
        continue;
      }
      if (result === 'retry') {
        if (sent !== revision) continue;
        current.retryTimer = setTimeout(() => void sync(), RETRY_MS);
        return;
      }
      current.mode = result === 'legacy-ack' ? 'legacy' : 'versioned';
      current.appliedRevision = sent;
      current.mayFollow = new Set(ids);
      if (sent === revision)
        current.acknowledge(() => current === connection && sent === revision, ids);
    }
  } finally {
    current.running = false;
  }
}

function scheduleFollowSync(): void {
  if (followSyncScheduled) return;
  followSyncScheduled = true;
  queueMicrotask(() => {
    followSyncScheduled = false;
    for (const [id, set] of sinks) {
      if (set.size !== 0) continue;
      sinks.delete(id);
      revision++;
    }
    void sync();
  });
}

export function subscribeConversation(conversationId: string, sink: ConversationSink): () => void {
  let set = sinks.get(conversationId);
  if (set === undefined) {
    set = new Set();
    sinks.set(conversationId, set);
    revision++;
    sink.onResync();
    if (connection?.mode !== 'legacy' && connection?.mayFollow.has(conversationId)) {
      connection.replace();
    }
    scheduleFollowSync();
  }
  set.add(sink);
  return () => {
    if (set.delete(sink) && set.size === 0) scheduleFollowSync();
  };
}

export function attachConnection(
  id: string,
  versioned: boolean,
  acknowledge: (isCurrent: () => boolean, followedIds: readonly string[]) => void,
  replace: () => void,
): void {
  detachConnection();
  for (const set of sinks.values()) for (const sink of set) sink.onResync();
  connection = {
    id,
    mode: versioned ? 'versioned' : 'unknown',
    controller: new AbortController(),
    appliedRevision: -1,
    mayFollow: new Set(),
    running: false,
    acknowledge,
    replace,
  };
  void sync();
}

export function detachConnection(): void {
  const retired = connection;
  connection = null;
  retired?.controller.abort();
  clearTimeout(retired?.retryTimer);
}

export function deliverConversationEvent(
  teamId: string,
  conversationId: string,
  ev: Record<string, unknown>,
): void {
  if (connection === null) return;
  const legacy = connection.mode !== 'versioned';
  for (const sink of sinks.get(conversationId) ?? []) {
    if (ev.type === 'preview_reset') sink.onResync();
    else sink.onEvent(ev, legacy, teamId);
  }
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
