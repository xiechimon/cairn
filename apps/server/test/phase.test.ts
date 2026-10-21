// phase 九值流转对拍（02 §4.1 权威 + 验收「含看板列折叠映射」）。
// 列折叠映射单源 = shared boardColumnFor（#351 起单键：仅 phase，4 列）；
// 流转边集 = src/services/phase.ts PHASE_TRANSITIONS（出处逐边注记）。

import { BOARD_COLUMNS, boardColumnFor, PHASE_VALUES, type Phase } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { canTransitionPhase, PHASE_TRANSITIONS } from '../src/services/phase.js';

describe('九值权威（02 §4.1）', () => {
  test('流转表键集 = phase 九值，无外值', () => {
    expect(Object.keys(PHASE_TRANSITIONS).sort()).toEqual([...PHASE_VALUES].sort());
    for (const targets of Object.values(PHASE_TRANSITIONS)) {
      for (const to of targets) {
        expect(PHASE_VALUES).toContain(to);
      }
    }
  });

  test('主时序边（02 §4.2 全链）逐边合法', () => {
    // 创建→开始→claim 规划→confirm→确认→building→review→merge 落地→done
    const spine: [Phase, Phase][] = [
      ['todo', 'queued'],
      ['queued', 'planning'],
      ['planning', 'confirm'],
      ['confirm', 'building'],
      ['building', 'review'],
      ['review', 'done'],
    ];
    for (const [from, to] of spine) {
      expect(canTransitionPhase(from, to), `${from}->${to}`).toBe(true);
    }
  });

  test('支线边：驳回重规划 / 直执行 / 失败重跑 / close-reopen', () => {
    expect(canTransitionPhase('confirm', 'planning')).toBe(true); // 驳回→重规划（r5 §4）
    expect(canTransitionPhase('queued', 'building')).toBe(true); // withPlan=false 直执行
    expect(canTransitionPhase('failed', 'queued')).toBe(true); // 重跑新 build（r3 §3.7）
    expect(canTransitionPhase('todo', 'closed')).toBe(true); // 右键 Close（r1 §443）
    expect(canTransitionPhase('closed', 'todo')).toBe(true); // reopen [推断]
  });

  test('条件边：failed→review 恢复（#702 / #519 B-C17，仅 build 腿已交付合法）', () => {
    // 边表记「这条流转在相位机上合法」；数据闸（build 步 done 且产物在）进
    // 服务端判定（builds.ts 恢复闸 = 唯一放行点；PATCH 手动面拒收，见
    // failed-review-restore.test 失败方式 3）。failed→done 仍非法——完成只
    // 能经恢复后的 review→done 合并步落地，不许跨过审核关口直达终态。
    expect(canTransitionPhase('failed', 'review')).toBe(true);
    expect(canTransitionPhase('failed', 'done')).toBe(false);
  });

  test('定时重跑边（02 §9.2 触发→新 build 全新重跑）', () => {
    expect(canTransitionPhase('done', 'queued')).toBe(true); // done 复跑（r3 §9 实测）
    expect(canTransitionPhase('review', 'queued')).toBe(true); // 停驻轮顶替（r5 §8 Cancelled+新轮）
    expect(canTransitionPhase('confirm', 'queued')).toBe(true); // 同上（方案关口停驻轮）
  });

  test('非法边拒绝（跳跃/回退/终态出边）', () => {
    expect(canTransitionPhase('todo', 'done')).toBe(false);
    expect(canTransitionPhase('todo', 'building')).toBe(false);
    expect(canTransitionPhase('building', 'confirm')).toBe(false);
    expect(canTransitionPhase('review', 'building')).toBe(false);
    expect(canTransitionPhase('done', 'todo')).toBe(false); // done 出边仅定时/重跑 queued（r3 §9）
    expect(canTransitionPhase('done', 'building')).toBe(false);
    for (const from of PHASE_VALUES) {
      expect(canTransitionPhase(from, from)).toBe(false); // 恒恰处一个 phase，自环无意义
    }
  });
});

describe('4 列折叠映射（#351 单键）', () => {
  test('列词表 = 工作台 4 列', () => {
    expect(BOARD_COLUMNS).toHaveLength(4);
  });

  test('逐 phase 列位对拍（单键，无 hasChanges）', () => {
    // #351：todo/queued→待开始；planning/building→执行中；
    // confirm/review（含 awaitingReply）/failed→待处理；done→已完成（近 7 天）；
    // closed→不占列不变。
    expect(boardColumnFor('todo')).toBe('待开始');
    expect(boardColumnFor('queued')).toBe('执行中'); // #1447
    expect(boardColumnFor('planning')).toBe('执行中');
    expect(boardColumnFor('building')).toBe('执行中');
    expect(boardColumnFor('confirm')).toBe('待处理');
    expect(boardColumnFor('review')).toBe('待处理');
    expect(boardColumnFor('failed')).toBe('待处理');
    expect(boardColumnFor('done')).toBe('已完成');
    expect(boardColumnFor('closed')).toBe('已完成');
  });
});
