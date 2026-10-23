// Issue #634 item 1: host-tool result echoes must not leak into the
// transcript as raw JSON. The daemon uploads pi's tool-result message as a
// role=system row whose content is a text block wrapping the relay tool's
// result JSON (measured in the live DB: `msg-<step>-3` rows carrying
// `{"todoId":…,"title":…,"tagIds":…}`); the mapper fell through to the
// centered `.chat-note` branch and rendered the plumbing verbatim, and the
// expanded tool group showed the same JSON a second time as an output slab.
// The reference site renders host-tool side effects as human-readable
// centered notes (`记忆已更新 · 新增 1 条`) and never shows raw JSON.
// Failure modes pinned here:
//   F1 set_task_meta echo → no row at all (the title truth lives in dhead)
//   F2 memory-write echo → human-readable note, not the result JSON
//   F3 genuine prose system notes still render (merge result, push skip)
//   F4 unpaired JSON-object system row → dropped (plumbing, no human face)
//   F5 pure-JSON tool output → no output slab in the tools group; the pill
//      stays and terminal-text outputs keep rendering (#469 law intact)

import type { ToolCallRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapTranscript, type MessageRow } from '../src/api/mappers.js';
import type { TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const META_JSON = '{"todoId":"t1","title":"测试消息，确认链路可用","tagIds":[]}';

function toolCall(name: string, resultText: string | null): ToolCallRecord {
  return {
    id: `call-${name}`,
    name,
    arguments: { title: '测试消息，确认链路可用' },
    ...(resultText === null
      ? {}
      : { result: { content: [{ type: 'text', text: resultText }] } }),
    startedAt: NOW - 5_000,
    endedAt: NOW - 4_000,
  };
}

function toolMessage(call: ToolCallRecord, at: number): MessageRow {
  return { id: call.id, role: 'assistant', content: { kind: 'toolcall', call }, createdAt: at };
}

/** pi's tool-result message, uploaded as role=system text block (live DB shape). */
function echoMessage(resultText: string, at: number, id = 'msg-echo'): MessageRow {
  return { id, role: 'system', content: [{ type: 'text', text: resultText }], createdAt: at };
}

function render(messages: MessageRow[]): TranscriptItem[] {
  return mapTranscript({
    messages,
    steps: [],
    plans: [],
    build: null,
    todo: todo(12, 'done'),
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
  });
}

function notes(items: TranscriptItem[]): string[] {
  return items.filter((i): i is Extract<TranscriptItem, { kind: 'note' }> => i.kind === 'note').map((i) => i.text);
}

test('F1: set_task_meta echo renders no row (title truth lives in the head)', () => {
  const items = render([
    toolMessage(toolCall('set_task_meta', META_JSON), NOW - 4_000),
    echoMessage(META_JSON, NOW - 3_900),
  ]);
  expect(notes(items)).toEqual([]);
  // the tool group itself stays (process disclosure law) — one pill, no JSON row
  const groups = items.filter((i): i is Extract<TranscriptItem, { kind: 'tools' }> => i.kind === 'tools');
  expect(groups).toHaveLength(1);
  expect(groups[0]?.pills).toEqual(['set_task_meta']);
});

test('F2: memory-write echo becomes a human-readable note', () => {
  const memJson = '{"id":"mem-1","name":"readme-structure"}';
  const items = render([
    toolMessage(toolCall('save_memory', memJson), NOW - 4_000),
    echoMessage(memJson, NOW - 3_900),
  ]);
  expect(notes(items)).toEqual(['记忆已更新']);
});

test('F3: genuine prose system notes keep rendering', () => {
  const items = render([
    {
      id: 'merge-1',
      role: 'system',
      content: 'git merge origin/main 结果为 "Already up to date."',
      createdAt: NOW - 2_000,
    },
  ]);
  expect(notes(items)).toEqual(['git merge origin/main 结果为 "Already up to date."']);
});

test('F4: an unpaired JSON-object system row is dropped', () => {
  const items = render([echoMessage('{"unexpected":"plumbing"}', NOW - 2_000, 'msg-stray')]);
  expect(notes(items)).toEqual([]);
});

test('F5: pure-JSON tool output hangs no slab; terminal text output stays', () => {
  const items = render([
    toolMessage(toolCall('set_task_meta', META_JSON), NOW - 6_000),
    toolMessage(toolCall('bash', 'probe ok\n'), NOW - 4_000),
  ]);
  const group = items.find((i): i is Extract<TranscriptItem, { kind: 'tools' }> => i.kind === 'tools');
  expect(group?.pills).toEqual(['set_task_meta', 'bash']);
  expect(group?.outputs).toEqual([null, 'probe ok\n']);
});
