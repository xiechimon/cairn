import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';

function row(id: string, content: unknown, createdAt = 100): MessageRow {
  return { id, role: 'system', content, createdAt };
}

const OFFLINE = {
  kind: 'runner_offline',
  machineId: 'machine-1',
  machineName: 'omarchy',
  lastSeenAt: 10_000,
  todos: [{ id: 'todo-1', seqNum: 9, title: 'Repair board counts', state: 'waiting' }],
  alternative: null,
  backAt: null,
  recoveredAt: null,
};

describe('runner_offline system rows map to one structured stream item each', () => {
  test('an offline row maps with its notice payload untouched', () => {
    const items = mapChiefStream([
      row('runner-offline-machine-1', JSON.stringify(OFFLINE)),
    ]);
    expect(items).toEqual([
      { kind: 'runner-offline', id: 'runner-offline-machine-1', notice: OFFLINE },
    ]);
  });

  test('malformed rows are ignored', () => {
    expect(
      mapChiefStream([
        row('bad-1', JSON.stringify({ ...OFFLINE, kind: 'other' })),
        row('bad-2', JSON.stringify({ ...OFFLINE, machineId: 3 })),
        row('bad-3', '{"kind":"runner_offline"'),
      ]),
    ).toEqual([]);
  });
});

describe('the runner-back text renders through i18n in the owner language', () => {
  const source = '{name} 已恢复，{n} 个任务已开工。';

  test('zh renders the Chinese source', () => {
    expect(translate('zh', EN, source, { name: 'omarchy', n: 1 })).toBe(
      'omarchy 已恢复，1 个任务已开工。',
    );
  });

  test('en renders the dictionary entry with the task plural', () => {
    expect(translate('en', EN, source, { name: 'omarchy', n: 1 })).toBe(
      'omarchy is back. 1 task started.',
    );
    expect(translate('en', EN, source, { name: 'omarchy', n: 3 })).toBe(
      'omarchy is back. 3 tasks started.',
    );
  });

  test('the stored notice carries no prose for the row to bypass t()', () => {
    expect(OFFLINE).not.toHaveProperty('message');
    expect(OFFLINE).not.toHaveProperty('text');
  });
});
