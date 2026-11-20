import type { DesignPageRecord, DesignVersionRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { designPageOfAttachment } from '../src/board/design/design-route.js';
import { attachmentOpener, type DesignPageTarget } from '../src/board/file-pane.js';

function version(fileName: string, seq: number, attachmentId: string): DesignVersionRecord {
  return {
    id: `${fileName}-${seq}`,
    todoId: 'todo-1',
    fileName,
    seq,
    attachmentId,
    sizeBytes: 100,
    source: 'agent',
    restoredFromSeq: null,
    createdAt: seq,
  };
}

const pages: DesignPageRecord[] = [
  {
    fileName: 'index.html',
    current: version('index.html', 1, 'att-index'),
    versionCount: 1,
    openComments: 0,
    shareToken: null,
  },
  {
    fileName: 'pricing.html',
    current: version('pricing.html', 2, 'att-v2'),
    versionCount: 2,
    openComments: 0,
    shareToken: null,
  },
];

const versionsOf = async (fileName: string) =>
  fileName === 'pricing.html'
    ? [version('pricing.html', 2, 'att-v2'), version('pricing.html', 1, 'att-v1')]
    : [version('index.html', 1, 'att-index')];

test('a page attached with a caption opens its own page in the design view', async () => {
  const opened: DesignPageTarget[] = [];
  const opener = attachmentOpener(
    { file: () => opened.push({ name: 'file pane', attachmentId: '' }), designPage: (t) => opened.push(t) },
    [],
    '第一版定价页',
    'team/att-v1.html',
  );
  opener.onOpen?.();
  expect(opened).toEqual([{ name: '第一版定价页', attachmentId: 'att-v1' }]);
  const target = opened[0];
  if (target === undefined) throw new Error('nothing opened');
  expect(await designPageOfAttachment(target, pages, versionsOf)).toBe('pricing.html');
  expect(
    await designPageOfAttachment({ name: 'x', attachmentId: 'att-v2' }, pages, versionsOf),
  ).toBe('pricing.html');
});
