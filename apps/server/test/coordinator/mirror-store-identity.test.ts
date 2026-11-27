import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai';
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

test('an in-server turn stores its thinking before the reply, like a computer-run turn', () => {
  const thinkingEntry = {
    ...entry,
    model: [
      fauxAssistantMessage(
        [
          fauxThinking('Check the projects first.'),
          fauxText('Done.'),
          fauxToolCall('projects', {}),
        ],
        { stopReason: 'toolUse' },
      ),
    ],
  };
  const rows = entryRowSources('producer', [thinkingEntry], 'store_one');
  expect(rows.map(({ row }) => row.id)).toEqual([
    'native-store_one:producer-t5',
    'native-store_one:producer-e5',
    expect.stringMatching(/^native-store_one:/),
  ]);
  expect(rows[0]?.row.content).toEqual([
    { type: 'thinking', thinking: 'Check the projects first.' },
  ]);
  expect(rows.map((r) => [r.entryId, r.lastOfEntry])).toEqual([
    ['5', false],
    ['5', false],
    ['5', true],
  ]);
});

test('blank thinking stores nothing; an aborted entry keeps thinking only when it is the stopped one', () => {
  const blank = {
    ...entry,
    model: [fauxAssistantMessage([fauxThinking('  '), fauxText('Done.')])],
  };
  const aborted = {
    ...entry,
    id: 6 as EntryId,
    model: [fauxAssistantMessage([fauxThinking('Half a thought')], { stopReason: 'aborted' })],
  };
  const ids = (stopped?: EntryId) =>
    entryRowSources('producer', [blank, aborted], 'store_one', stopped).map(({ row }) => row.id);
  expect(ids()).toEqual(['native-store_one:producer-e5']);
  expect(ids(6 as EntryId)).toEqual([
    'native-store_one:producer-e5',
    'native-store_one:producer-t6',
  ]);
});
