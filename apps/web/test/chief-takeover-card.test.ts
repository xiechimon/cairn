import { TAKEOVER_HANDED_BACK } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';

const NOW = 1_758_000_000_000;
const REASON = '手机号已填写，请勾选协议并输入验证码';

function takeover(id: string, finished?: { text: string; isError?: boolean }): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name: 'request_takeover',
        arguments: { reason: REASON },
        startedAt: NOW,
        ...(finished !== undefined
          ? {
              endedAt: NOW + 60_000,
              result: [{ type: 'text', text: finished.text }],
              ...(finished.isError !== undefined ? { isError: finished.isError } : {}),
            }
          : {}),
      },
    },
    createdAt: NOW,
  } as MessageRow;
}

describe('request_takeover in the Coordinator conversation', () => {
  test('a running takeover is a waiting card with its reason and start time', () => {
    expect(mapChiefStream([takeover('m1')])).toContainEqual({
      kind: 'takeover',
      id: 'm1',
      reason: REASON,
      startedAt: NOW,
      endedAt: null,
      outcome: 'waiting',
    });
  });

  test('a takeover the owner handed back is a handed-back card', () => {
    const [item] = mapChiefStream([takeover('m1', { text: TAKEOVER_HANDED_BACK })]).filter(
      (entry) => entry.kind === 'takeover',
    );
    expect(item).toMatchObject({ outcome: 'handed-back', endedAt: NOW + 60_000 });
  });

  test('a takeover that timed out or was stopped is a not-done card', () => {
    for (const finished of [
      { text: 'The owner did not finish. This step is not done. Stop and tell the owner.' },
      { text: TAKEOVER_HANDED_BACK, isError: true },
    ]) {
      const [item] = mapChiefStream([takeover('m1', finished)]).filter(
        (entry) => entry.kind === 'takeover',
      );
      expect(item).toMatchObject({ outcome: 'not-done' });
    }
  });

  test('the takeover is a card, not a tool pill', () => {
    const items = mapChiefStream([
      takeover('m1'),
      { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '好了' }], createdAt: NOW } as MessageRow,
    ]);
    expect(JSON.stringify(items)).not.toContain('request_takeover');
    expect(items.filter((item) => item.kind === 'takeover')).toHaveLength(1);
  });
});
