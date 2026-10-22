// provider 熔断器（#1493）：每个 provider 一个连败计数 + 半开探测，只服务
// 降级链「挑哪个备选」——open 的 provider 不被选为备选。不在主模型出事前
// 主动绕开主模型（主模型照常派发，出事才走降级链）。
//
// 状态机（PilotDeck ProviderHealthTracker 同形）：
//   healthy →（连败 3）degraded →（连败 5）open →（30s）half_open
//   half_open 一次只放一个步去试（探测位）：成功 → healthy，失败 → open
//   并重新计时。任何一次成功清零连败数。degraded 仍可选，只是提示。
//
// 计入连败的 = provider 面的事件（额度空 / 限流 / 认证失败）；模型 404 是
// 单个模型的事，走 model-liveness 的 dead 标注，不进这里。
//
// 状态只在进程内存（model-liveness 缓存同律）：server 重启 = 全部从 healthy
// 开始。可接受——重启后最坏多试一次已知坏的 provider，失败即重新计数。

export type ProviderHealthState = 'healthy' | 'degraded' | 'open' | 'half_open';

export const DEGRADED_AFTER_FAILURES = 3;
export const OPEN_AFTER_FAILURES = 5;
/** open 后多久进入半开探测。 */
export const HALF_OPEN_AFTER_MS = 30_000;
/** 半开探测位租期：拿到探测位的步迟迟不回报（机器失联、步卡死）时，租期
 * 过后探测位释放，下一个步可以再试——否则 provider 永久不可选。 */
export const PROBE_LEASE_MS = 10 * 60_000;

interface Entry {
  failures: number;
  /** 进入 open 的时刻（null = 未 open）。 */
  openedAt: number | null;
  /** 半开探测位占用时刻（null = 空闲）。 */
  probeAt: number | null;
}

export class ProviderHealthTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  state(providerId: string): ProviderHealthState {
    const e = this.entries.get(providerId);
    if (e === undefined) return 'healthy';
    if (e.openedAt !== null) {
      return this.now() - e.openedAt >= HALF_OPEN_AFTER_MS ? 'half_open' : 'open';
    }
    return e.failures >= DEGRADED_AFTER_FAILURES ? 'degraded' : 'healthy';
  }

  /** 选备选时调用：可选返回 true。half_open 时占用探测位（一次只放一个）。 */
  tryAcquire(providerId: string): boolean {
    const s = this.state(providerId);
    if (s === 'healthy' || s === 'degraded') return true;
    if (s === 'open') return false;
    const e = this.entries.get(providerId);
    if (e === undefined) return true;
    const now = this.now();
    if (e.probeAt !== null && now - e.probeAt < PROBE_LEASE_MS) return false;
    e.probeAt = now;
    return true;
  }

  recordFailure(providerId: string): void {
    const e = this.entries.get(providerId) ?? { failures: 0, openedAt: null, probeAt: null };
    e.failures += 1;
    // half_open 探测失败与连败到阈值同一出口：（重新）进入 open 并计时。
    if (e.openedAt !== null || e.failures >= OPEN_AFTER_FAILURES) {
      e.openedAt = this.now();
      e.probeAt = null;
    }
    this.entries.set(providerId, e);
  }

  recordSuccess(providerId: string): void {
    this.entries.delete(providerId);
  }

  reset(): void {
    this.entries.clear();
  }
}

/** 进程单例（server 内存态）。 */
export const providerHealth = new ProviderHealthTracker();
