import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_758_000_000_000;

function row(id: string, role: MessageRow['role'], content: unknown, at = NOW): MessageRow {
  return { id, role, content, createdAt: at };
}

function userItems(items: ChiefStreamItem[]) {
  return items.filter((i): i is Extract<ChiefStreamItem, { kind: 'user' }> => i.kind === 'user');
}

describe('mapChiefStream echo-row dedup (#667 F-C1..C7)', () => {
  test('F-C1 POST row + user-<stepId> echo row with same text → exactly one user bubble (canon = the POST row id)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '帮我写 CONTRIBUTING.md', NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '帮我写 CONTRIBUTING.md', NOW + 3000),
      row('msg-a1', 'assistant', '已创建任务并派工', NOW + 9000),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('帮我写 CONTRIBUTING.md');

    expect(users[0]?.id).toBe('AbCdEfGhIjKlMnOpQrStU');
  });

  test('F-C2 two turns each sending the same text → exactly two user bubbles (echoes dedup per turn, POSTs both render)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '继续', NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '继续', NOW + 100),
      row('msg-r1', 'assistant', '第一轮完成', NOW + 9000),
      row('ZxYwVuTsRqPoNmLkJiHgFe', 'user', '继续', NOW + 20000),
      row('user-MnBvCxZlKjHgFeDcSaPoN', 'user', '继续', NOW + 20100),
      row('msg-r2', 'assistant', '第二轮完成', NOW + 29000),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.id)).toEqual(['AbCdEfGhIjKlMnOpQrStU', 'ZxYwVuTsRqPoNmLkJiHgFe']);
  });

  test('F-C3 two consecutive different-content messages → each shown once (no over-dedup)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '总结项目进展', NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '总结项目进展', NOW + 100),
      row('ZxYwVuTsRqPoNmLkJiHgFe', 'user', '再查一下 token 用量', NOW + 20000),
      row('user-MnBvCxZlKjHgFeDcSaPoN', 'user', '再查一下 token 用量', NOW + 20100),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.text)).toEqual(['总结项目进展', '再查一下 token 用量']);
  });

  test('F-C4 wake echo rows (no POST twin) survive with the marker stripped — the remainder renders', () => {
    const items = mapChiefStream([
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '[wake:settle] 任务 #5「修复」已合并完成', NOW),
      row('msg-r1', 'assistant', '已确认落地', NOW + 9000),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('任务 #5「修复」已合并完成');
    expect(users[0]?.text).not.toContain('[wake:');
  });

  test('F-C5 steer same-text (two POSTs + two echoes) → exactly two (each real action renders once)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '继续', NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '继续', NOW + 100),
      row('ZxYwVuTsRqPoNmLkJiHgFe', 'user', '继续', NOW + 2000),
      row('user-MnBvCxZlKjHgFeDcSaPoN', 'user', '继续', NOW + 2100),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.id)).toEqual(['AbCdEfGhIjKlMnOpQrStU', 'ZxYwVuTsRqPoNmLkJiHgFe']);
  });

  test('F-C6 same-millisecond tie + echo row with trailing whitespace + echo row appearing first → still deduped (order-free compare, same-source trim)', () => {
    const items = mapChiefStream([
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '派一下\n', NOW),
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '派一下', NOW),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe('AbCdEfGhIjKlMnOpQrStU');
  });

  test('F-C7 two non-user- same-text rows are not deduped (the discriminator is the id prefix, not content adjacency)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '继续', NOW),
      row('ZxYwVuTsRqPoNmLkJiHgFe', 'user', '继续', NOW + 100),
    ]);
    expect(userItems(items)).toHaveLength(2);
  });
});

describe('mapChiefStream internal marker stripping (#778 F-W1..W6)', () => {
  test('F-W1 all four same-family markers (gate/settle/failed/wake) strip their leading marker', () => {
    for (const kind of ['gate', 'settle', 'failed', 'wake']) {
      const items = mapChiefStream([
        row('user-stepW', 'user', `[wake:${kind}] 任务 #5 已合并完成`, NOW),
      ]);
      const users = userItems(items);
      expect(users).toHaveLength(1);
      expect(users[0]?.text).toBe('任务 #5 已合并完成');
      expect(users[0]?.markdown).toBe('任务 #5 已合并完成');
    }
  });

  test('F-W2 pure marker rows (no remainder) do not render', () => {
    const items = mapChiefStream([
      row('user-stepW', 'user', '[wake:gate]', NOW),
      row('msg-r1', 'assistant', '已确认落地', NOW + 9000),
    ]);
    expect(userItems(items)).toHaveLength(0);
  });

  test('F-W3 in-sentence markers survive (only the leading one strips)', () => {
    const items = mapChiefStream([row('u-post-1', 'user', '任务 [wake:gate] 别动', NOW)]);
    expect(userItems(items)[0]?.text).toBe('任务 [wake:gate] 别动');
  });

  test('F-W4 POST row and wake echo row with the same remainder → exactly one (the dedup key eats the stripped text)', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '任务 #5 已合并完成', NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', '[wake:settle] 任务 #5 已合并完成', NOW + 100),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe('AbCdEfGhIjKlMnOpQrStU');
  });

  test('F-W5 assistant rows untouched (protocol tokens never pass through this face)', () => {
    const items = mapChiefStream([
      row('msg-r1', 'assistant', '[wake:gate] 是内部触发标记', NOW),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'robot',
      markdown: '[wake:gate] 是内部触发标记',
    });
  });

  test('F-W6 leading markers on POST rows strip the same way (unified user-visible boundary)', () => {
    const items = mapChiefStream([row('u-post-1', 'user', '[wake:gate] 帮我查一下', NOW)]);
    expect(userItems(items)[0]?.text).toBe('帮我查一下');
  });
});
