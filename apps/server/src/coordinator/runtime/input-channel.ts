export interface NativeInput {
  id: string;
  stepId: string;
  kind: 'initial' | 'steer';
  content: string;
  ownerMessageIds: string[];
  conversationId: string | null;
  state: 'pending' | 'consumed' | 'released';
  entryId: string | null;
  live: boolean;
}

export interface NativeRun {
  threadId: string;
  conversationId: string;
  taskId: string;
  stepId: string;
}

export class InputAuthorityError extends Error {}

export interface InputChannel {
  position(threadId: string): Promise<{
    storeId: string | null;
    conversationId: string;
    lastMirroredEntryId: string | null;
  } | null>;
  targets(threadId: string): Promise<{ id: string; content: string }[]>;
  assertConversation(threadId: string, conversationId: string): Promise<void>;
  runs(threadId: string): Promise<NativeRun[]>;
  bindRun(
    threadId: string,
    conversationId: string,
    taskId: string,
    requestIds: readonly string[],
  ): Promise<void>;
  list(threadId: string): Promise<NativeInput[]>;
  prepare(
    stepId: string,
    conversationId: string,
    content: string,
    existingEntryId?: string,
  ): Promise<NativeInput>;
  consume(requestId: string, conversationId: string, entryId: string): Promise<void>;
  release(requestId: string, conversationId: string | null): Promise<void>;
  checkpoint(threadId: string, conversationId: string, entryId: string): Promise<void>;
}
