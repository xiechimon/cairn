import type {
  AgentTodo,
  BuildRecord,
  ConversationMessageEvent,
  ConversationStepEvent,
  NotificationDelivery,
  NotificationRecord,
  StepActivity,
  TodoRecord,
  TranscriptRow,
} from '@cairn/shared';
import { publicFileSourceRow } from './file-source.js';

export interface TeamStreamConnection<Data = object> {
  nextSeq(): number;
  send(payload: Data): Promise<void>;
}

type StreamSubscriber<Data> = Pick<TeamStreamConnection<Data>, 'send'>;
interface TeamSubscriber {
  send(payload: object, encoded: string): Promise<void>;
}

export class TeamStreamHub {
  private readonly byTeam = new Map<string, Map<TeamSubscriber, string | undefined>>();

  constructor(
    private readonly projectOfBuildTodo?: (teamId: string, todoId: string) => string | undefined,
  ) {}

  subscribe<T extends TeamSubscriber>(teamId: string, conn: T, userId?: string): () => void {
    let set = this.byTeam.get(teamId);
    if (!set) {
      set = new Map();
      this.byTeam.set(teamId, set);
    }
    set.set(conn, userId);
    return () => {
      set?.delete(conn);
      if (set && set.size === 0) this.byTeam.delete(teamId);
    };
  }

  subscriberCount(teamId: string): number {
    return this.byTeam.get(teamId)?.size ?? 0;
  }

  publishTodoDoc(teamId: string, doc: TodoRecord): void {
    this.publish(teamId, () => ({ type: 'todo', v: doc.v, doc }));
  }

  publishBuildDoc(teamId: string, doc: BuildRecord): void {
    this.publish(teamId, () => {
      const projectId = this.projectOfBuildTodo?.(teamId, doc.todoId);
      return { type: 'build', v: 1, doc, ...(projectId === undefined ? {} : { projectId }) };
    });
  }

  publishNotification(
    teamId: string,
    record: NotificationRecord,
    delivery?: NotificationDelivery,
  ): void {
    this.publishPrivate(teamId, record.userId, () => ({
      type: 'notification',
      notification: record,
      ...(delivery === undefined ? {} : { delivery }),
    }));
  }

  publishPrivate(teamId: string, userId: string, frame: () => object): void {
    if (!userId) return;
    const set = this.byTeam.get(teamId);
    if (!set) return;
    let publication: [object, string] | undefined;
    for (const [conn, subscriberUserId] of set) {
      if (subscriberUserId !== userId) continue;
      if (publication === undefined) {
        const payload = frame();
        publication = [payload, JSON.stringify(payload)];
      }
      void conn.send(...publication);
    }
  }

  publish(teamId: string, frame: () => object): void {
    const set = this.byTeam.get(teamId);
    if (!set) return;
    const payload = frame();
    const encoded = JSON.stringify(payload);
    for (const conn of set.keys()) void conn.send(payload, encoded);
  }
}

export const SSE_MAX_PENDING_WRITES = 4096;

export interface SerialConnectionOptions {
  maxPending?: number;
  onOverflow?: () => void;
}

export function createSerialConnection<Data = object>(
  write: (payload: Data, seq: number) => Promise<void>,
  options: SerialConnectionOptions = {},
): TeamStreamConnection<Data> {
  const maxPending = options.maxPending ?? SSE_MAX_PENDING_WRITES;
  let seq = 0;
  let frameId = 0;
  let pending = 0;
  let overflowed = false;
  let tail: Promise<void> = Promise.resolve();
  return {
    nextSeq: () => ++seq,
    send(payload) {
      if (overflowed) return tail;
      if (pending >= maxPending) {
        overflowed = true;
        options.onOverflow?.();
        return tail;
      }
      pending += 1;
      tail = tail
        .then(() => write(payload, ++frameId))
        .catch(() => {})
        .finally(() => {
          pending -= 1;
        });
      return tail;
    },
  };
}

export interface StreamSession {
  readonly conn: StreamSubscriber<string>;
  readonly teamId: string;
  readonly deviceId: string | null;
  readonly subscriptions: Map<string, () => void>;
  revision: number | undefined;
  closed: boolean;
}

export class StreamSessionRegistry {
  private readonly sessions = new Map<string, StreamSession>();
  private readonly envelopes = new WeakMap<object, Map<string, string>>();

  open(
    connectionId: string,
    session: Omit<StreamSession, 'subscriptions' | 'revision' | 'closed'>,
  ): () => void {
    const entry: StreamSession = {
      ...session,
      subscriptions: new Map(),
      revision: undefined,
      closed: false,
    };
    this.sessions.set(connectionId, entry);
    return () => {
      entry.closed = true;
      this.sessions.delete(connectionId);
      for (const unsubscribe of entry.subscriptions.values()) unsubscribe();
      entry.subscriptions.clear();
    };
  }

  get(connectionId: string): StreamSession | undefined {
    return this.sessions.get(connectionId);
  }

  setConversations(
    session: StreamSession,
    conversationIds: readonly string[],
    hub: ConversationStreamHub | undefined,
    revision?: number,
  ): number | undefined {
    if (
      session.closed ||
      (session.revision !== undefined && (revision === undefined || revision <= session.revision))
    ) {
      return session.revision;
    }
    session.revision = revision;
    const wanted = new Set(conversationIds);
    for (const [id, unsubscribe] of session.subscriptions) {
      if (wanted.has(id)) continue;
      unsubscribe();
      session.subscriptions.delete(id);
    }
    for (const id of wanted) {
      if (session.subscriptions.has(id)) continue;
      const channel: StreamSubscriber<object> = {
        send: (event) => {
          let frames = this.envelopes.get(event);
          if (frames === undefined) {
            frames = new Map();
            this.envelopes.set(event, frames);
          }
          let data = frames.get(id);
          if (data === undefined) {
            data = JSON.stringify({ type: 'conversation', conversationId: id, event });
            frames.set(id, data);
          }
          return session.conn.send(data);
        },
      };
      if (revision !== undefined) void channel.send({ type: 'preview_reset' });
      if (session.closed) break;
      const unsubscribe = hub?.subscribe(id, channel) ?? (() => {});
      if (session.closed) {
        unsubscribe();
        break;
      }
      session.subscriptions.set(id, unsubscribe);
    }
    return session.revision;
  }
}

export const CONV_TEXT_BUFFER_MAX_BYTES = 128 * 1024;

export const CONV_TEXT_BUFFER_MAX_CONVS = 128;

export class ConversationStreamHub {
  private readonly byConv = new Map<string, Set<StreamSubscriber<object>>>();
  private readonly textBuffers = new Map<string, string>();
  private readonly thinkingBuffers = new Map<string, string>();
  private readonly lastActivity = new Map<string, StepActivity>();

  subscribe<T extends StreamSubscriber<object>>(conversationId: string, conn: T): () => void {
    let set = this.byConv.get(conversationId);
    if (!set) {
      set = new Set();
      this.byConv.set(conversationId, set);
    }
    set.add(conn);
    const buffered = this.textBuffers.get(conversationId);
    if (buffered !== undefined && buffered !== '') {
      void conn.send({ type: 'text_delta', text: buffered });
    }
    const thinking = this.thinkingBuffers.get(conversationId);
    if (thinking !== undefined && thinking !== '') {
      void conn.send({ type: 'thinking_delta', text: thinking });
    }
    const activity = this.lastActivity.get(conversationId);
    if (activity !== undefined) {
      void conn.send({ type: 'activity', activity });
    }
    return () => {
      set?.delete(conn);
      if (set && set.size === 0) this.byConv.delete(conversationId);
    };
  }

  subscriberCount(conversationId: string): number {
    return this.byConv.get(conversationId)?.size ?? 0;
  }

  publishMessage(
    conversationId: string,
    published: TranscriptRow,
    deliveredQueue?: ConversationMessageEvent['deliveredQueue'],
    clientMessageId?: string,
  ): void {
    // Rows may arrive straight from the database; the private source never reaches a browser.
    const message: TranscriptRow =
      'fileSource' in published ? (publicFileSourceRow(published) as TranscriptRow) : published;
    if (endsLiveTextBuffer(message)) {
      this.textBuffers.delete(conversationId);
      this.lastActivity.delete(conversationId);
      if (message.role !== 'assistant') this.thinkingBuffers.delete(conversationId);
    } else if (isThinkingOnlyRow(message.content)) {
      this.thinkingBuffers.delete(conversationId);
    }
    const event: ConversationMessageEvent = {
      type: 'message',
      message,
      ...(deliveredQueue === undefined ? {} : { deliveredQueue }),
      ...(clientMessageId === undefined ? {} : { clientMessageId }),
    };
    this.publish(conversationId, event);
    if (
      message.role === 'user' &&
      deliveredQueue !== undefined &&
      deliveredQueue.conversationId !== conversationId
    )
      this.publish(deliveredQueue.conversationId, { ...event, conversationId });
  }

  publishTextDelta(conversationId: string, text: string): void {
    if (text === '') return;
    const next = tailWithinBytes(
      (this.textBuffers.get(conversationId) ?? '') + text,
      CONV_TEXT_BUFFER_MAX_BYTES,
    );
    this.textBuffers.delete(conversationId);
    this.textBuffers.set(conversationId, next);
    if (this.textBuffers.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.textBuffers.keys().next().value;
      if (oldest !== undefined) this.textBuffers.delete(oldest);
    }
    this.publish(conversationId, { type: 'text_delta', text });
  }

  publishThinkingDelta(conversationId: string, text: string): void {
    if (text === '') return;
    const next = tailWithinBytes(
      (this.thinkingBuffers.get(conversationId) ?? '') + text,
      CONV_TEXT_BUFFER_MAX_BYTES,
    );
    this.thinkingBuffers.delete(conversationId);
    this.thinkingBuffers.set(conversationId, next);
    if (this.thinkingBuffers.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.thinkingBuffers.keys().next().value;
      if (oldest !== undefined) this.thinkingBuffers.delete(oldest);
    }
    this.publish(conversationId, { type: 'thinking_delta', text });
  }

  publishActivity(conversationId: string, activity: StepActivity): void {
    if (activity.resetLive === true) {
      this.textBuffers.delete(conversationId);
      this.thinkingBuffers.delete(conversationId);
    }
    const { resetLive: _drop, ...rest } = activity;
    const stored: StepActivity = activity.resetLive === true ? rest : activity;
    this.lastActivity.delete(conversationId);
    this.lastActivity.set(conversationId, stored);
    if (this.lastActivity.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.lastActivity.keys().next().value;
      if (oldest !== undefined) this.lastActivity.delete(oldest);
    }
    this.publish(conversationId, { type: 'activity', activity });
  }

  publishAgentTodo(conversationId: string, todo: AgentTodo): void {
    this.publish(conversationId, { type: 'agent_todo', todo });
  }

  publishStep(conversationId: string, step: ConversationStepEvent['step']): void {
    if (step.status === 'done' || step.status === 'failed' || step.status === 'stopped') {
      this.clearConversationBuffer(conversationId);
    }
    this.publish(conversationId, { type: 'step', step });
  }

  clearConversationBuffer(conversationId: string): void {
    this.textBuffers.delete(conversationId);
    this.thinkingBuffers.delete(conversationId);
    this.lastActivity.delete(conversationId);
  }

  publish(conversationId: string, payload: object): void {
    const set = this.byConv.get(conversationId);
    if (!set) return;
    for (const conn of set) {
      void conn.send(payload);
    }
  }
}

function endsLiveTextBuffer(message: TranscriptRow): boolean {
  return !isToolCallRow(message.content) && !isThinkingOnlyRow(message.content);
}

function isToolCallRow(content: unknown): boolean {
  return (
    content !== null &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === 'toolcall'
  );
}

function isThinkingOnlyRow(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (block) =>
      block !== null &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'thinking',
  );
}

function tailWithinBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(text.slice(text.length - mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  const suffix = text.slice(text.length - lo);
  const first = suffix.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? suffix.slice(1) : suffix;
}
