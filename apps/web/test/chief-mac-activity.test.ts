import { TRANSCRIPT_PROMPT_ROW_ID_PREFIX } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';

const NOW = 1_758_000_000_000;

function macCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
  finished?: { isError?: boolean },
): MessageRow {
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
        ...(finished !== undefined
          ? {
              endedAt: NOW + 1_000,
              result: [{ type: 'text', text: 'ok' }],
              ...(finished.isError !== undefined ? { isError: finished.isError } : {}),
            }
          : {}),
      },
    },
    createdAt: NOW,
  } as MessageRow;
}

const lines = (rows: MessageRow[]) =>
  mapChiefStream(rows).filter((entry) => entry.kind === 'mac-activity');

describe("the owner's Mac in the Coordinator conversation", () => {
  test('each call is one line naming what ran, running until it ends', () => {
    expect(
      lines([
        macCall('m1', 'user_computer_shell', { command: 'xcodebuild -scheme Cairn' }, {}),
        macCall('m2', 'user_computer_act', { app: 'Notes', actions: [{ kind: 'click' }] }),
        macCall('m3', 'user_computer_observe', { app: 'Finder' }, { isError: true }),
      ]),
    ).toEqual([
      {
        kind: 'mac-activity',
        id: 'm1',
        tool: 'user_computer_shell',
        summary: 'xcodebuild -scheme Cairn',
        running: false,
        error: false,
      },
      {
        kind: 'mac-activity',
        id: 'm2',
        tool: 'user_computer_act',
        summary: 'Notes: click',
        running: true,
        error: false,
      },
      {
        kind: 'mac-activity',
        id: 'm3',
        tool: 'user_computer_observe',
        summary: 'Finder',
        running: false,
        error: true,
      },
    ]);
  });

  test('a multi-line or long command shows its first line, clipped', () => {
    const heredoc = "python3 - <<'EOF'\nprint(1)\nEOF";
    const long = `echo ${'x'.repeat(400)}`;
    const [first, second] = lines([
      macCall('m1', 'user_computer_shell', { command: heredoc }, {}),
      macCall('m2', 'user_computer_shell', { command: long }, {}),
    ]);
    expect(first?.summary).toBe("python3 - <<'EOF' …");
    expect(second?.summary).toBe(`${long.slice(0, 160)} …`);
  });

  test('a routine or event turn still shows its Mac calls', () => {
    const wake = {
      id: `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}step-1`,
      role: 'user',
      content: '[wake:routine] check the nightly build',
      createdAt: NOW,
    } as MessageRow;
    expect(
      lines([wake, macCall('m1', 'user_computer_shell', { command: 'ls ~/Builds' }, {})]),
    ).toHaveLength(1);
  });
});
