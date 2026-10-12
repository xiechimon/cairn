// team stream 事件 → 失效键映射（#666）单元面。失败方式清单（先列再写实现）：
//   1. todo 文档事件漏 ['plans']——相位翻到 confirm 的同一个事件必须带着
//      plan 卡收敛（CI flake 指纹：conv 流迟到/哑掉时 chip 翻了、方案卡永远
//      缺席，XMON-60 闸门恰好在 confirm 相位关闭，无人再失效 plans）。
//   2. build 文档事件漏 ['plans', buildId]——build 文档事件同样恒在 plan 行
//      落库之后（daemon 顺序：PUT plan.md → done → finishStep 发布）。
//   3. 既有键回归丢失（todos/todo/schedules/build/steps/notifications/
//      chiefThreads/machines/branchSync）——映射抽成纯函数时逐个保住。
//   4. notification 的桌面通知副作用被卷进映射——映射只回键，副作用留在
//      hook（本文件钉「映射无副作用面」：ping/未知事件回空集）。
// 事件载荷按真 wire 形状（apps/server/src/services/events.ts）铺；映射只读
// 键字段，doc 其余位不参与。

import { describe, expect, it } from 'vitest';
import { teamEventInvalidations } from '../src/api/sse-team-events.js';
import { todo } from './helpers.js';

const TEAM = 'team-1';

function keysOf(ev: Record<string, unknown>): string[] {
  return teamEventInvalidations(ev, TEAM).map((k) => k.join('/'));
}

describe('team 事件 → 失效键', () => {
  it('todo 文档事件：既有三键 + plans（#666：方案卡与相位 chip 同事件收敛）', () => {
    const doc = todo(7, 'confirm');
    const keys = keysOf({ type: 'todo', seq: 1, v: 3, doc });
    expect(keys).toContain('todos');
    expect(keys).toContain(`todo/${doc.id}`);
    expect(keys).toContain('schedules');
    expect(keys).toContain('plans');
  });

  it('build 文档事件：既有四键 + plans 按 buildId 收窄', () => {
    const keys = keysOf({
      type: 'build',
      seq: 2,
      v: 1,
      doc: { id: 'build-1', todoId: 'todo-7' },
    });
    expect(keys).toContain('build/build-1');
    expect(keys).toContain('steps/build-1');
    expect(keys).toContain('todos');
    expect(keys).toContain('todo/todo-7');
    expect(keys).toContain('plans/build-1');
  });

  it('notification：三键原样（桌面通知副作用不在映射里）', () => {
    const keys = keysOf({
      type: 'notification',
      notification: { id: 'n-1', type: 'plan_ready', entityId: 'todo-7' },
    });
    expect(keys).toEqual([`notifications/${TEAM}`, `chiefThreads/${TEAM}`, 'todos']);
  });

  it('machine_presence 带板面 todo 失效（#1257 挂起态派生）；branch_sync 原样单键', () => {
    // #1257：todo 的等机器态派生自机器 presence——上下线连带失效 todos。
    expect(keysOf({ type: 'machine_presence', machineId: 'm-1', online: true })).toEqual([
      `machines/${TEAM}`,
      'todos',
    ]);
    expect(keysOf({ type: 'branch_sync', sync: { buildId: 'build-1' } })).toEqual([
      'branchSync/build-1',
    ]);
  });

  it('ping 与未知事件：零失效', () => {
    expect(keysOf({ type: 'ping', seq: 3 })).toEqual([]);
    expect(keysOf({ type: 'wat' })).toEqual([]);
  });
});
