import type {
  AgentTodo,
  BranchSyncRecord,
  BuildRecord,
  ConversationStepEvent,
  NotificationRecord,
  StepActivity,
  TodoRecord,
  TranscriptRow,
} from '@cairn/shared';

export interface TeamStreamConnection {
  nextSeq(): number;
  send(payload: object): Promise<void>;
}

export class TeamStreamHub {
  private readonly byTeam = new Map<string, Set<TeamStreamConnection>>();

  subscribe(teamId: string, conn: TeamStreamConnection): () => void {
    let set = this.byTeam.get(teamId);
    if (!set) {
      set = new Set();
      this.byTeam.set(teamId, set);
    }
    set.add(conn);
    return () => {
      set?.delete(conn);
      if (set && set.size === 0) this.byTeam.delete(teamId);
    };
  }

  subscriberCount(teamId: string): number {
    return this.byTeam.get(teamId)?.size ?? 0;
  }

  publishTodoDoc(teamId: string, doc: TodoRecord): void {
    this.publish(teamId, (conn) => ({ type: 'todo', seq: conn.nextSeq(), v: doc.v, doc }));
  }

  publishBuildDoc(teamId: string, doc: BuildRecord): void {
    this.publish(teamId, (conn) => ({ type: 'build', seq: conn.nextSeq(), v: 1, doc }));
  }

  publishNotification(teamId: string, record: NotificationRecord): void {
    this.publish(teamId, () => ({ type: 'notification', notification: record }));
  }

  publishBranchSync(teamId: string, record: BranchSyncRecord): void {
    this.publish(teamId, () => ({ type: 'branch_sync', sync: record }));
  }

  publish(teamId: string, frame: (conn: TeamStreamConnection) => object): void {
    const set = this.byTeam.get(teamId);
    if (!set) return;
    for (const conn of set) {
      void conn.send(frame(conn));
    }
  }
}

export function createSerialConnection(
  write: (payload: object) => Promise<void>,
): TeamStreamConnection {
  let seq = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    nextSeq: () => ++seq,
    send(payload) {
      tail = tail.then(() => write(payload)).catch(() => {});
      return tail;
    },
  };
}

export const CONV_TEXT_BUFFER_MAX_BYTES = 128 * 1024;

export const CONV_TEXT_BUFFER_MAX_CONVS = 128;

export class ConversationStreamHub {
  private readonly byConv = new Map<string, Set<TeamStreamConnection>>();
  private readonly textBuffers = new Map<string, string>();
  private readonly thinkingBuffers = new Map<string, string>();
  private readonly lastActivity = new Map<string, StepActivity>();
  private readonly lastAgentTodo = new Map<string, AgentTodo>();

  subscribe(conversationId: string, conn: TeamStreamConnection): () => void {
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
    const agentTodo = this.lastAgentTodo.get(conversationId);
    if (agentTodo !== undefined) {
      void conn.send({ type: 'agent_todo', todo: agentTodo });
    }
    return () => {
      set?.delete(conn);
      if (set && set.size === 0) this.byConv.delete(conversationId);
    };
  }

  subscriberCount(conversationId: string): number {
    return this.byConv.get(conversationId)?.size ?? 0;
  }

  publishMessage(conversationId: string, message: TranscriptRow): void {
    if (endsLiveTextBuffer(message)) {
      this.textBuffers.delete(conversationId);
      this.lastActivity.delete(conversationId);
      if (message.role !== 'assistant') this.thinkingBuffers.delete(conversationId);
    } else if (isThinkingOnlyRow(message.content)) {
      this.thinkingBuffers.delete(conversationId);
    }
    this.publish(conversationId, { type: 'message', message });
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
    this.lastAgentTodo.delete(conversationId);
    this.lastAgentTodo.set(conversationId, todo);
    if (this.lastAgentTodo.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.lastAgentTodo.keys().next().value;
      if (oldest !== undefined) this.lastAgentTodo.delete(oldest);
    }
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
    this.lastAgentTodo.delete(conversationId);
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
