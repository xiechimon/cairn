import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';

function row(id: string, role: MessageRow['role'], content: unknown): MessageRow {
  return { id, role, content, createdAt: 100 };
}

describe('the runtime first line renders as the Coordinator’s own bubble', () => {
  test('a chief_ack row becomes one robot bubble with the line it stored', () => {
    const items = mapChiefStream([
      row('ack-m-1', 'system', JSON.stringify({
        kind: 'chief_ack',
        message: '我先核对「部署状态」。',
        provenance: 'user',
      })),
      row('answer', 'assistant', '部署在 f7b92a6 上运行。'),
    ]);
    expect(items).toEqual([
      { kind: 'robot', markdown: '我先核对「部署状态」。', seconds: '', id: 'ack-m-1', createdAt: 100 },
      { kind: 'robot', markdown: '部署在 f7b92a6 上运行。', seconds: '', id: 'answer', createdAt: 100 },
    ]);
  });

  test('an ack without a message is not rendered as an empty bubble', () => {
    expect(
      mapChiefStream([
        row('ack-bad', 'system', JSON.stringify({ kind: 'chief_ack', message: '' })),
      ]),
    ).toEqual([]);
  });
});
