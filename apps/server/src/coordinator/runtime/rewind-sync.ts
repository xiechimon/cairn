import type { Context } from '@earendil-works/chord/context';
import type { EntryId, Harness } from '@earendil-works/pi-durable';
import { parseWatermark } from '../watermark.js';
import { activeConversation } from './conversations.js';

export type RewindSync =
  | { action: 'none' }
  | { action: 'forked'; conversationId: string; entryId: number }
  | { action: 'reseed' };

export async function syncToRewind(
  harness: Harness,
  context: Context,
  state: { conversationId: string | null; lastMirroredEntryId: string | null },
): Promise<RewindSync> {
  const watermark = parseWatermark(state.lastMirroredEntryId);
  if (watermark?.kind !== 'rewind') return { action: 'none' };
  const conversation = await activeConversation(harness, state.conversationId, context);
  if (conversation === undefined) return { action: 'reseed' };
  const target = (
    await conversation.entries({ maxEntryId: watermark.entryId as EntryId }, 1, undefined, context)
  ).items[0];
  if (target === undefined) return { action: 'reseed' };
  const newest = (await conversation.entries({}, 1, undefined, context)).items[0];
  if (newest !== undefined && newest.id === target.id) {
    return {
      action: 'forked',
      conversationId: String(conversation.id),
      entryId: Number(target.id),
    };
  }
  const fork = await conversation.fork(target.id, { ownership: { kind: 'ownerless' } }, context);
  return { action: 'forked', conversationId: String(fork.id), entryId: Number(target.id) };
}
