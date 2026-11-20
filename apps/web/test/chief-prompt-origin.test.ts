import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_758_000_000_000;

function row(
  id: string,
  role: MessageRow['role'],
  content: unknown,
  origin?: MessageRow['origin'],
): MessageRow {
  return {
    id,
    role,
    content,
    createdAt: NOW,
    ...(origin === undefined ? {} : { origin }),
  };
}

function userItems(items: ChiefStreamItem[]) {
  return items.filter((i): i is Extract<ChiefStreamItem, { kind: 'user' }> => i.kind === 'user');
}

const GREETING =
  '【新频道】用户刚打开项目「pointo」的新频道，还没有说话。用1到3句、以「xmon」称呼用户打招呼…必须先调用 suggest_replies…不要建任务。';

describe('mapChiefStream transcript prompt provenance', () => {
  test('a task-prompt echo row never renders as a user bubble (the channel greeting prompt)', () => {
    const items = mapChiefStream([
      row('user-AbCdEfGhIjKlMnOpQrStU', 'user', GREETING, 'task-prompt'),
      row('msg-a1', 'assistant', 'xmon，新频道好。'),
    ]);
    expect(userItems(items)).toHaveLength(0);
    expect(items[0]).toMatchObject({ kind: 'robot', markdown: 'xmon，新频道好。' });
  });

  test('a task-prompt echo next to a real POST row leaves the POST row as the one bubble', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '帮我写 CONTRIBUTING.md'),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '帮我写 CONTRIBUTING.md', 'task-prompt'),
      row('msg-a1', 'assistant', '已创建任务并派工'),
    ]);
    expect(userItems(items).map((u) => u.id)).toEqual(['AbCdEfGhIjKlMnOpQrStU']);
  });

  test('an explicit user row with a user-<stepId>-shaped id still renders (provenance beats the id guess)', () => {
    const items = mapChiefStream([
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', 'real owner words', 'user'),
    ]);
    expect(userItems(items).map((u) => u.text)).toEqual(['real owner words']);
  });

  test('a synthetic row never renders as a user bubble', () => {
    const items = mapChiefStream([
      row('gen-1', 'user', '任意生成文本', 'synthetic'),
    ]);
    expect(userItems(items)).toHaveLength(0);
  });

  test('a task-prompt wake echo still seals its event turn', () => {
    const items = mapChiefStream([
      row(
        'user-stepW',
        'user',
        '[wake:failed] provenance=watch:todo-1\nCheck a failure',
        'task-prompt',
      ),
      row('wake-reply', 'assistant', 'Checking the failure.'),
    ]);
    expect(items).toEqual([]);
  });

  test('an unmarked echo row still dedups against a POST twin (legacy rows predating the column)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '继续'),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '继续'),
    ]);
    expect(userItems(items).map((u) => u.id)).toEqual(['AbCdEfGhIjKlMnOpQrStU']);
  });
});
