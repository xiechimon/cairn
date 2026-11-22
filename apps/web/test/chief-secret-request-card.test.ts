import {
  REQUEST_SECRET_TOOL,
  SECRET_REQUEST_CANCELLED,
  SECRET_REQUEST_NOT_SAVED,
  secretRequestSaved,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';

const NOW = 1_758_000_000_000;
const ARGS = { name: 'ACME_API_KEY', scope: 'team', description: 'The Acme API key.' };

function secretCall(
  id: string,
  finished?: { text: string; isError?: boolean },
  args: Record<string, unknown> = ARGS,
): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name: REQUEST_SECRET_TOOL,
        arguments: args,
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

const cards = (rows: MessageRow[]) =>
  mapChiefStream(rows).filter((entry) => entry.kind === 'secret-request');

describe('request_secret in the Coordinator conversation', () => {
  test('a running request is a pending card naming the secret, its scope and purpose', () => {
    expect(cards([secretCall('m1')])).toEqual([
      {
        kind: 'secret-request',
        id: 'm1',
        name: 'ACME_API_KEY',
        scope: 'team',
        projectId: null,
        description: 'The Acme API key.',
        outcome: 'waiting',
      },
    ]);
    expect(
      cards([secretCall('m1', undefined, { ...ARGS, scope: 'project', projectId: 'p1' })])[0],
    ).toMatchObject({ scope: 'project', projectId: 'p1' });
  });

  test('the result decides saved, cancelled or failed', () => {
    const outcome = (finished: { text: string; isError?: boolean }) =>
      cards([secretCall('m1', finished)])[0];
    expect(outcome({ text: secretRequestSaved('ACME_API_KEY', 'team') })).toMatchObject({
      outcome: 'saved',
    });
    expect(outcome({ text: SECRET_REQUEST_CANCELLED })).toMatchObject({ outcome: 'cancelled' });
    for (const finished of [
      { text: SECRET_REQUEST_NOT_SAVED },
      { text: 'request_secret refused before asking: bad name' },
      { text: secretRequestSaved('ACME_API_KEY', 'team'), isError: true },
    ])
      expect(outcome(finished)).toMatchObject({ outcome: 'failed' });
  });

  test('the request is a card, not a tool pill', () => {
    const items = mapChiefStream([
      secretCall('m1'),
      {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'text', text: '好了' }],
        createdAt: NOW,
      } as MessageRow,
    ]);
    expect(JSON.stringify(items)).not.toContain(REQUEST_SECRET_TOOL);
    expect(items.filter((item) => item.kind === 'secret-request')).toHaveLength(1);
  });
});
