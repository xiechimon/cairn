// provider 熔断器状态机（#1493）：先于实现钉死状态迁移。失败方式枚举
// （AGENTS.md 测试规则 3）：
//   H1 连败不计数：额度空的 provider 一直被选为备选，降级链在同一家上空转。
//      断言 3 连败 degraded、5 连败 open，open 不可选。
//   H2 永不恢复：open 之后没有半开探测 = provider 恢复了也再不被选。断言
//      30 秒后 half_open 可选一次。
//   H3 半开放洪：half_open 一次放多个步去试 = 熔断形同虚设。断言探测位
//      被占时第二次 tryAcquire 为 false。
//   H4 探测失败不复位：half_open 失败后还停在 half_open = 每个步都去试。
//      断言失败回 open 并重新计时。
//   H5 成功不清零：中间夹一次成功仍按累计连败计 = 偶发失败把健康 provider
//      熔断。断言任何成功清零回 healthy。
//   H6 探测位泄漏：拿到探测位的步再没回报（机器失联）= provider 永久不可选。
//      断言探测租期过后探测位释放。

import { describe, expect, test } from 'vitest';
import {
  DEGRADED_AFTER_FAILURES,
  HALF_OPEN_AFTER_MS,
  OPEN_AFTER_FAILURES,
  PROBE_LEASE_MS,
  ProviderHealthTracker,
} from '../src/services/provider-health.js';

function tracker(start = 1_000_000): { t: ProviderHealthTracker; clock: { now: number } } {
  const clock = { now: start };
  return { t: new ProviderHealthTracker(() => clock.now), clock };
}

function fail(t: ProviderHealthTracker, providerId: string, n: number): void {
  for (let i = 0; i < n; i++) t.recordFailure(providerId);
}

describe('provider 熔断器（#1493）', () => {
  test('阈值常量与票面一致', () => {
    expect(DEGRADED_AFTER_FAILURES).toBe(3);
    expect(OPEN_AFTER_FAILURES).toBe(5);
    expect(HALF_OPEN_AFTER_MS).toBe(30_000);
  });

  test('未见过的 provider = healthy 且可选', () => {
    const { t } = tracker();
    expect(t.state('relay-a')).toBe('healthy');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H1：2 连败仍 healthy，3 连败 degraded（仍可选），5 连败 open（不可选）', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 2);
    expect(t.state('relay-a')).toBe('healthy');
    fail(t, 'relay-a', 1);
    expect(t.state('relay-a')).toBe('degraded');
    expect(t.tryAcquire('relay-a')).toBe(true);
    fail(t, 'relay-a', 2);
    expect(t.state('relay-a')).toBe('open');
    expect(t.tryAcquire('relay-a')).toBe(false);
  });

  test('provider 之间互不影响', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 5);
    expect(t.state('relay-a')).toBe('open');
    expect(t.state('relay-b')).toBe('healthy');
    expect(t.tryAcquire('relay-b')).toBe(true);
  });

  test('H2：open 满 30 秒 → half_open，可选一次', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS - 1;
    expect(t.state('relay-a')).toBe('open');
    expect(t.tryAcquire('relay-a')).toBe(false);
    clock.now += 1;
    expect(t.state('relay-a')).toBe('half_open');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H3：half_open 探测位被占时不再放行', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    expect(t.tryAcquire('relay-a')).toBe(true);
    expect(t.tryAcquire('relay-a')).toBe(false);
  });

  test('half_open 探测成功 → healthy，连败清零', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    t.tryAcquire('relay-a');
    t.recordSuccess('relay-a');
    expect(t.state('relay-a')).toBe('healthy');
    fail(t, 'relay-a', 2);
    expect(t.state('relay-a')).toBe('healthy');
  });

  test('H4：half_open 探测失败 → 回 open 并重新计时', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    t.tryAcquire('relay-a');
    t.recordFailure('relay-a');
    expect(t.state('relay-a')).toBe('open');
    expect(t.tryAcquire('relay-a')).toBe(false);
    clock.now += HALF_OPEN_AFTER_MS - 1;
    expect(t.state('relay-a')).toBe('open');
    clock.now += 1;
    expect(t.state('relay-a')).toBe('half_open');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H5：中间一次成功清零连败', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 4);
    expect(t.state('relay-a')).toBe('degraded');
    t.recordSuccess('relay-a');
    expect(t.state('relay-a')).toBe('healthy');
    fail(t, 'relay-a', 4);
    expect(t.state('relay-a')).toBe('degraded');
  });

  test('H6：探测位租期过后释放，下一个步可再试', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    expect(t.tryAcquire('relay-a')).toBe(true);
    clock.now += PROBE_LEASE_MS - 1;
    expect(t.tryAcquire('relay-a')).toBe(false);
    clock.now += 1;
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('reset 清空全部状态（重启语义：内存态，从 healthy 开始）', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 5);
    t.reset();
    expect(t.state('relay-a')).toBe('healthy');
  });
});
