import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  type ConversationId,
  type EntryId,
  type EntryRecord,
} from '@earendil-works/pi-durable';
import { expect, test } from 'vitest';
import { entryRowSources } from '../../src/coordinator/runtime/mirror.js';

const entry: EntryRecord = {
  id: 5 as EntryId,
  conversationId: 2 as ConversationId,
  kind: AssistantEntry.kind,
  model: [fauxAssistantMessage('Answer.')],
};

test('reused entry IDs in a new store cannot overwrite an earlier native answer', () => {
  const before = entryRowSources('producer', [entry], 'store_one');
  const after = entryRowSources('producer', [entry], 'store_two');
  expect(after[0]?.row.id).not.toBe(before[0]?.row.id);
});

test('tool rows and their payload identities are isolated across store replacement', () => {
  const toolEntry = {
    ...entry,
    model: [fauxAssistantMessage([fauxToolCall('read_history', {})], { stopReason: 'toolUse' })],
  };
  const before = entryRowSources('producer', [toolEntry], 'store_one');
  const after = entryRowSources('producer', [toolEntry], 'store_two');
  expect(after[0]?.row.id).not.toBe(before[0]?.row.id);
  expect(JSON.stringify(after[0]?.row.content)).not.toBe(JSON.stringify(before[0]?.row.content));
});
