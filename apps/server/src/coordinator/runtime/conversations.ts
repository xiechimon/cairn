import type { Context } from '@earendil-works/chord/context';
import type { ConversationId, Harness } from '@earendil-works/pi-durable';

export type Conversation = Awaited<ReturnType<Harness['root']>>;

export async function activeConversation(
  harness: Harness,
  conversationId: string | null | undefined,
  context: Context,
): Promise<Conversation | undefined> {
  if (conversationId === null || conversationId === undefined) return harness.root(context);
  return harness.conversation(Number(conversationId) as ConversationId, context);
}

export async function withRegisteredMailConversation<T>(
  harness: Harness,
  context: Context,
  priorId: string | null,
  register: (conversationId: string, restoreOwnerId: string | null) => void,
  run: (conversationId: string) => Promise<T>,
): Promise<T> {
  const isolated = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
  register(String(isolated.id), priorId);
  try {
    return await run(String(isolated.id));
  } finally {
    if (priorId !== null) {
      register(priorId, null);
    } else {
      const fresh = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
      register(String(fresh.id), null);
    }
  }
}

export async function newestEntryId(
  conversation: Conversation,
  context: Context,
): Promise<number | undefined> {
  const newest = (await conversation.entries({}, 1, undefined, context)).items[0]?.id;
  return newest === undefined ? undefined : Number(newest);
}
