import { TRANSCRIPT_PROMPT_ROW_ID_PREFIX } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';
import { CHIEF_ROW_CLASS, chiefRowRenders } from '../src/chief/chief-row-kinds.js';

const NOW = 1_758_000_000_000;

function macCall(id: string, name: string, args: Record<string, unknown>): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name,
        arguments: args,
        startedAt: NOW,
        endedAt: NOW + 1_000,
        result: [{ type: 'text', text: 'ok' }],
      },
    },
    createdAt: NOW,
  } as MessageRow;
}

const MAC_CALLS = [
  macCall('m1', 'user_computer_shell', {
    command: 'cd ~/Library/Application\\ Support/Cairn/4f0c2a9e && git status -sb',
  }),
  macCall('m2', 'user_computer_act', { app: 'Notes', actions: [{ kind: 'click' }] }),
  macCall('m3', 'user_computer_observe', { app: 'Finder' }),
];

describe("the owner's Mac in the Coordinator conversation", () => {
  test('Mac calls leave no row; the reply around them still shows', () => {
    const stream = mapChiefStream([
      { id: 'u1', role: 'user', content: 'check the repo', createdAt: NOW } as MessageRow,
      ...MAC_CALLS,
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'The repo is clean.' }],
        createdAt: NOW + 2_000,
      } as MessageRow,
    ]);
    expect(JSON.stringify(stream)).not.toMatch(/git status|Library|Notes|Finder|user_computer/);
    expect(stream.map((item) => item.kind)).toEqual(['user', 'robot']);
  });

  test('a routine turn adds no Mac rows either', () => {
    const wake = {
      id: `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}step-1`,
      role: 'user',
      content: '[wake:routine] check the nightly build',
      createdAt: NOW,
    } as MessageRow;
    expect(JSON.stringify(mapChiefStream([wake, ...MAC_CALLS]))).not.toMatch(/user_computer|Finder/);
  });
});

describe('Coordinator chat row allow-list', () => {
  test('every row kind is a message, card, alert or status, or never renders', () => {
    for (const rowClass of Object.values(CHIEF_ROW_CLASS))
      expect(['message', 'card', 'exception-alert', 'status', 'hidden']).toContain(rowClass);
  });

  test('a kind outside the allow-list does not render', () => {
    expect(chiefRowRenders('mac-activity')).toBe(false);
    expect(chiefRowRenders('work')).toBe(false);
    expect(chiefRowRenders('report-ack')).toBe(false);
    expect(chiefRowRenders('robot')).toBe(true);
  });
});
