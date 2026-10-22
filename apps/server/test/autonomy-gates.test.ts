// #1491 后台自动任务的触发闸：纯函数 evaluateAutonomyGates。测试先于实现
// （AGENTS.md 测试规则）。每个原因一条正例 + 一条刚好放行的边界；判定顺序
// 钉住（首个不过即返回）。失败方式对位票面：
//  1 花费读不到 → 不放行（budget-unreadable）。
//  2 跨日 → 日预算按 UTC 日切。
//  3 休眠判定读失败（main 头读不到）→ 不休眠，交给后面的闸。
//  4 被拦只是本轮不开：函数无副作用，同一输入重判结果不变。

import {
  AUTONOMY_GATE_REASONS,
  type AutonomySettings,
  DEFAULT_AUTONOMY_SETTINGS,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  type AutonomyGateInput,
  evaluateAutonomyGates,
  utcDayStart,
} from '../src/services/autonomy-gates.js';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

const SETTINGS: AutonomySettings = {
  enabled: true,
  quietMinutes: 10,
  cooldownMinutes: 15,
  dailyBudgetUsd: 5,
};

/** 全部放行的输入；各用例只改一处。 */
function input(over: Partial<AutonomyGateInput> = {}): AutonomyGateInput {
  return {
    now: NOW,
    settings: SETTINGS,
    dormancy: { baselineSha: 'a'.repeat(40), currentSha: 'b'.repeat(40) },
    inFlight: 0,
    inFlightCap: 3,
    lastMemberWriteAt: null,
    lastStartedAt: null,
    spentTodayUsd: 0,
    ...over,
  };
}

describe('evaluateAutonomyGates', () => {
  test('all gates pass → ok', () => {
    expect(evaluateAutonomyGates(input())).toEqual({ ok: true });
  });

  test('disabled: project has autonomy off', () => {
    expect(evaluateAutonomyGates(input({ settings: { ...SETTINGS, enabled: false } }))).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  describe('dormant', () => {
    test('main head unchanged since the last run of this kind → dormant', () => {
      const sha = 'c'.repeat(40);
      expect(
        evaluateAutonomyGates(input({ dormancy: { baselineSha: sha, currentSha: sha } })),
      ).toEqual({ ok: false, reason: 'dormant' });
    });

    test('a new commit on main → not dormant', () => {
      expect(evaluateAutonomyGates(input()).ok).toBe(true);
    });

    test('never ran before (no baseline) → not dormant', () => {
      expect(
        evaluateAutonomyGates(
          input({ dormancy: { baselineSha: null, currentSha: 'c'.repeat(40) } }),
        ).ok,
      ).toBe(true);
    });

    test('failure mode 3: main head unreadable → not dormant, later gates decide', () => {
      const sha = 'c'.repeat(40);
      expect(
        evaluateAutonomyGates(input({ dormancy: { baselineSha: sha, currentSha: null } })).ok,
      ).toBe(true);
      // 交给后面的闸：冷却仍会拦。
      expect(
        evaluateAutonomyGates(
          input({ dormancy: { baselineSha: sha, currentSha: null }, lastStartedAt: NOW - MIN }),
        ),
      ).toEqual({ ok: false, reason: 'cooldown' });
    });

    test('a kind without a dormancy signal (dormancy omitted) skips the gate', () => {
      expect(evaluateAutonomyGates(input({ dormancy: undefined })).ok).toBe(true);
    });
  });

  describe('in-flight cap', () => {
    test('in flight reached the cap → blocked', () => {
      expect(evaluateAutonomyGates(input({ inFlight: 3 }))).toEqual({
        ok: false,
        reason: 'in-flight-cap',
      });
    });

    test('one below the cap → passes', () => {
      expect(evaluateAutonomyGates(input({ inFlight: 2 })).ok).toBe(true);
    });
  });

  describe('member active', () => {
    test('a member wrote 1 ms inside the quiet window → yield', () => {
      expect(evaluateAutonomyGates(input({ lastMemberWriteAt: NOW - 10 * MIN + 1 }))).toEqual({
        ok: false,
        reason: 'member-active',
      });
    });

    test('exactly quietMinutes ago → passes', () => {
      expect(evaluateAutonomyGates(input({ lastMemberWriteAt: NOW - 10 * MIN })).ok).toBe(true);
    });

    test('quietMinutes 0 turns the gate off', () => {
      expect(
        evaluateAutonomyGates(
          input({ settings: { ...SETTINGS, quietMinutes: 0 }, lastMemberWriteAt: NOW }),
        ).ok,
      ).toBe(true);
    });

    test('clock moved back (member write is in the future) → still yields', () => {
      expect(evaluateAutonomyGates(input({ lastMemberWriteAt: NOW + 5 * MIN }))).toEqual({
        ok: false,
        reason: 'member-active',
      });
    });
  });

  describe('cooldown', () => {
    test('last run of this kind 1 ms inside the cooldown → blocked', () => {
      expect(evaluateAutonomyGates(input({ lastStartedAt: NOW - 15 * MIN + 1 }))).toEqual({
        ok: false,
        reason: 'cooldown',
      });
    });

    test('exactly cooldownMinutes ago → passes', () => {
      expect(evaluateAutonomyGates(input({ lastStartedAt: NOW - 15 * MIN })).ok).toBe(true);
    });

    test('cooldownMinutes 0 turns the gate off', () => {
      expect(
        evaluateAutonomyGates(
          input({ settings: { ...SETTINGS, cooldownMinutes: 0 }, lastStartedAt: NOW }),
        ).ok,
      ).toBe(true);
    });

    test('clock moved back (last run is in the future) → still cooling down', () => {
      expect(evaluateAutonomyGates(input({ lastStartedAt: NOW + MIN }))).toEqual({
        ok: false,
        reason: 'cooldown',
      });
    });
  });

  describe('daily budget', () => {
    test('spent reached the budget → blocked', () => {
      expect(evaluateAutonomyGates(input({ spentTodayUsd: 5 }))).toEqual({
        ok: false,
        reason: 'budget',
      });
    });

    test('just under the budget → passes', () => {
      expect(evaluateAutonomyGates(input({ spentTodayUsd: 4.99 })).ok).toBe(true);
    });

    test('failure mode 1: spend unreadable → not let through', () => {
      expect(evaluateAutonomyGates(input({ spentTodayUsd: null }))).toEqual({
        ok: false,
        reason: 'budget-unreadable',
      });
    });

    test('dailyBudgetUsd 0 turns the gate off, unreadable spend included', () => {
      const off = { ...SETTINGS, dailyBudgetUsd: 0 };
      expect(evaluateAutonomyGates(input({ settings: off, spentTodayUsd: 999 })).ok).toBe(true);
      expect(evaluateAutonomyGates(input({ settings: off, spentTodayUsd: null })).ok).toBe(true);
    });
  });

  test('order: the first failing gate wins', () => {
    const sha = 'c'.repeat(40);
    const allFail = input({
      settings: { ...SETTINGS, enabled: false },
      dormancy: { baselineSha: sha, currentSha: sha },
      inFlight: 3,
      lastMemberWriteAt: NOW,
      lastStartedAt: NOW,
      spentTodayUsd: null,
    });
    const seen: string[] = [];
    // 逐个把最前面那道放开，原因按固定顺序往后走。
    let cur = allFail;
    const unblock: Array<(i: AutonomyGateInput) => AutonomyGateInput> = [
      (i) => ({ ...i, settings: { ...i.settings, enabled: true } }),
      (i) => ({ ...i, dormancy: undefined }),
      (i) => ({ ...i, inFlight: 0 }),
      (i) => ({ ...i, lastMemberWriteAt: null }),
      (i) => ({ ...i, lastStartedAt: null }),
      (i) => ({ ...i, spentTodayUsd: 10 }),
      (i) => ({ ...i, spentTodayUsd: 0 }),
    ];
    for (const step of unblock) {
      const r = evaluateAutonomyGates(cur);
      if (!r.ok) seen.push(r.reason);
      cur = step(cur);
    }
    expect(seen).toEqual([
      'disabled',
      'dormant',
      'in-flight-cap',
      'member-active',
      'cooldown',
      'budget-unreadable',
      'budget',
    ]);
    expect(new Set(seen)).toEqual(new Set(AUTONOMY_GATE_REASONS));
    expect(evaluateAutonomyGates(cur)).toEqual({ ok: true });
  });

  test('failure mode 4: pure — the same input gives the same verdict', () => {
    const i = input({ lastStartedAt: NOW - MIN });
    expect(evaluateAutonomyGates(i)).toEqual(evaluateAutonomyGates(i));
  });

  test('defaults are on with conservative non-zero thresholds', () => {
    expect(DEFAULT_AUTONOMY_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_AUTONOMY_SETTINGS.quietMinutes).toBeGreaterThan(0);
    expect(DEFAULT_AUTONOMY_SETTINGS.cooldownMinutes).toBeGreaterThan(0);
    expect(DEFAULT_AUTONOMY_SETTINGS.dailyBudgetUsd).toBeGreaterThan(0);
  });
});

describe('utcDayStart (failure mode 2: daily budget cuts at UTC midnight)', () => {
  test('one ms before and at UTC midnight fall on different days', () => {
    const midnight = Date.UTC(2026, 9, 23, 0, 0, 0);
    expect(utcDayStart(midnight - 1)).toBe(Date.UTC(2026, 9, 22));
    expect(utcDayStart(midnight)).toBe(midnight);
  });
});
