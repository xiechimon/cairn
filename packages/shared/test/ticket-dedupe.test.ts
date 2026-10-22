// 票去重键（#1492，供 #1407 纠错票 / 园丁票开票前查重）。外部行为 = 「同一
// 类问题不重复开票，不同问题不被合成一张」。失败方式先于实现固化：
//   1. 同类别 + 同路径集合 → 同一个键（路径顺序、重复、前导 ./ 与大小写
//      不同的类别写法都不影响）。
//   2. 同类别、不同路径 → 不同键（撞车会把两个问题合成一张）。
//   3. 键能写进 issue body 并原样读回；查重只认 open 票里的标记。
//   4. 正文里只提到同名文字、没有标记的票不算重复。

import { describe, expect, test } from 'vitest';
import {
  findDuplicateTicket,
  parseTicketDedupeKey,
  ticketDedupeKey,
  ticketDedupeMarker,
} from '../src/records/ticket-dedupe.js';

describe('ticketDedupeKey', () => {
  test('失败方式 1：路径顺序 / 重复 / ./ 前缀 / 类别大小写不影响键', () => {
    const a = ticketDedupeKey({ category: 'Missing-Test', paths: ['b/y.ts', 'a/x.ts'] });
    const b = ticketDedupeKey({
      category: 'missing-test',
      paths: ['./a/x.ts', 'b/y.ts', 'a/x.ts'],
    });
    expect(a).toBe(b);
  });

  test('失败方式 2：同类别不同路径 → 不同键', () => {
    const a = ticketDedupeKey({ category: 'missing-test', paths: ['apps/server/src/a.ts'] });
    const b = ticketDedupeKey({ category: 'missing-test', paths: ['apps/web/src/b.ts'] });
    expect(a).not.toBe(b);
  });

  test('不同类别同路径 → 不同键', () => {
    const a = ticketDedupeKey({ category: 'missing-test', paths: ['a.ts'] });
    const b = ticketDedupeKey({ category: 'stale-doc', paths: ['a.ts'] });
    expect(a).not.toBe(b);
  });

  test('类别不能为空', () => {
    expect(() => ticketDedupeKey({ category: '  ', paths: ['a.ts'] })).toThrow();
  });
});

describe('findDuplicateTicket', () => {
  const key = ticketDedupeKey({ category: 'missing-test', paths: ['apps/server/src/a.ts'] });
  const other = ticketDedupeKey({ category: 'missing-test', paths: ['apps/web/src/b.ts'] });

  test('失败方式 3：标记写进 body 能原样读回', () => {
    const body = `问题描述……\n\n${ticketDedupeMarker(key)}\n`;
    expect(parseTicketDedupeKey(body)).toBe(key);
    expect(parseTicketDedupeKey('没有标记')).toBeNull();
  });

  test('open 票里有同键标记 → 返回那张票；两个不同问题互不命中', () => {
    const issues = [
      { number: 10, state: 'open', body: `x\n${ticketDedupeMarker(other)}` },
      { number: 11, state: 'open', body: `y\n${ticketDedupeMarker(key)}` },
    ];
    expect(findDuplicateTicket(key, issues)?.number).toBe(11);
    expect(findDuplicateTicket(other, issues)?.number).toBe(10);
  });

  test('已关闭的同键票不算重复（问题复发要重新开）', () => {
    const issues = [{ number: 12, state: 'closed', body: ticketDedupeMarker(key) }];
    expect(findDuplicateTicket(key, issues)).toBeNull();
  });

  test('失败方式 4：正文只提到同样的文字、没有标记 → 不算重复', () => {
    const issues = [
      { number: 13, state: 'open', body: `missing-test apps/server/src/a.ts ${key}` },
    ];
    expect(findDuplicateTicket(key, issues)).toBeNull();
  });
});
