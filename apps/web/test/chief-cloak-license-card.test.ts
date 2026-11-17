import {
  CLOAK_LICENSE_NOT_SAVED,
  CLOAK_LICENSE_SAVED,
  REQUEST_CLOAK_LICENSE_TOOL,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';

const NOW = 1_758_000_000_000;
const REASON = 'CloakBrowser license denied or unavailable';

function licenseCall(id: string, finished?: { text: string; isError?: boolean }): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name: REQUEST_CLOAK_LICENSE_TOOL,
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

const cards = (rows: MessageRow[]) =>
  mapChiefStream(rows).filter((entry) => entry.kind === 'cloak-license');

describe('request_cloak_license in the Coordinator conversation', () => {
  test('a running request is a waiting card with its reason', () => {
    expect(cards([licenseCall('m1')])).toEqual([
      { kind: 'cloak-license', id: 'm1', reason: REASON, outcome: 'waiting' },
    ]);
  });

  test('a request the owner answered is a saved card', () => {
    expect(cards([licenseCall('m1', { text: CLOAK_LICENSE_SAVED })])[0]).toMatchObject({
      outcome: 'saved',
    });
  });

  test('a request that expired, stopped or failed is a not-saved card', () => {
    for (const finished of [
      { text: CLOAK_LICENSE_NOT_SAVED },
      { text: CLOAK_LICENSE_SAVED, isError: true },
    ]) {
      expect(cards([licenseCall('m1', finished)])[0]).toMatchObject({ outcome: 'not-saved' });
    }
  });

  test('the request is a card, not a tool pill', () => {
    const items = mapChiefStream([
      licenseCall('m1'),
      {
        id: 'm2',
        role: 'assistant',
        content: [{ type: 'text', text: '好了' }],
        createdAt: NOW,
      } as MessageRow,
    ]);
    expect(JSON.stringify(items)).not.toContain(REQUEST_CLOAK_LICENSE_TOOL);
    expect(items.filter((item) => item.kind === 'cloak-license')).toHaveLength(1);
  });
});
