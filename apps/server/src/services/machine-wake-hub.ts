// 机器 wake 通道（#1130 自 machines.ts 纯提取，行为零变化）：claim 长轮询
// 等待者 + team SSE stream 订阅者 + 机器定向派发索引，按 team 分组的内存
// pub/sub。零 DB 访问，只依赖 shared wire 类型——transport 原语，供
// machines.ts / chief.ts / builds.ts / todos.ts / chief-tools.ts 等以接口
// 边界消费（不应为拿一个 transport 原语 import 协议实现模块）。

import type { MachineStreamEvent, MachineSyncCommand } from '@pacman/shared';

// —— wake 通道（claim 长轮询等待者 + SSE stream 订阅者，按 team 分组）—————————

export class MachineWakeHub {
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly streams = new Map<string, Set<(ev: MachineStreamEvent) => void>>();
  /** team → 单调递增 wake 序号（#1217）：claim 面在首个 await 前取基线，
   * waitWake 携带基线武装——检查与武装之间插入微任务后 wake 可能落在缝里
   * （武装前发 = 纯 pubsub 丢事件），基线之后的 wake 补醒，missed-wake 竞态
   * 由此在 hub 层消灭（否则 claim 醒不过 hold = 低延迟派发失守）。 */
  private readonly wakeSeqs = new Map<string, number>();
  /** 机器定向派发索引（M7 #319，08 册附录 B）：单条 SSE 流的 team key
   * 粒度不够——sync 命令须按 machineId 派发给单台机器（团队可挂多机）。订阅
   * 时同步登记到 streamsByMachine，pushSync 走此索引；streams（team key）
   * 保留用于 wake/shutdown/steer 的全团队广播语义（02 §1.2 + W3 #278）。 */
  private readonly streamsByMachine = new Map<
    string,
    { teamId: string; send: (ev: MachineStreamEvent) => void }
  >();

  /** 等待 wake；true = 被唤醒，false = 超时（长轮询节奏 ≈ timeoutMs，r3 §1.5）。
   * #1065 僵尸认领：signal = 认领请求的存活态（node-server 客户端断连即
   * abort）——断连时即刻 settle(false) 并摘除 waiter，不等 hold 到期：否则死
   * 机 waiter 会在 ≤75s 窗口内替死机抢领新步入队的 wake（waiter Set 按插入
   * 序，僵尸先注册先醒），步落死机无人执行。 */
  /** 当前 wake 序号（claim 面取基线用，同步无副作用）。 */
  wakeSeq(teamId: string): number {
    return this.wakeSeqs.get(teamId) ?? 0;
  }

  waitWake(
    teamId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    sinceSeq?: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // 请求已断：不注册等待（响应无处投递，领取即孤儿步）。
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      // #1217 基线之后已有 wake（武装晚于 wake 的缝）→ 立即补醒，不睡 hold。
      if (sinceSeq !== undefined && this.wakeSeq(teamId) > sinceSeq) {
        resolve(true);
        return;
      }
      let settled = false;
      let set = this.waiters.get(teamId);
      if (!set) {
        set = new Set();
        this.waiters.set(teamId, set);
      }
      const holder = set;
      const cleanup = () => {
        holder.delete(fn);
        if (holder.size === 0) this.waiters.delete(teamId);
        signal?.removeEventListener('abort', onAbort);
      };
      const settle = (woken: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(woken);
      };
      const fn = () => settle(true);
      const onAbort = () => settle(false);
      const timer = setTimeout(() => settle(false), timeoutMs);
      holder.add(fn);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** 新步入队 → 唤醒该团队全部等待者 + 推送 SSE wake（低延迟派发，02 §1.2）。 */
  wake(teamId: string): void {
    this.wakeSeqs.set(teamId, (this.wakeSeqs.get(teamId) ?? 0) + 1);
    for (const send of this.streams.get(teamId) ?? []) {
      try {
        send({ type: 'wake' });
      } catch {
        // 连接已死：订阅方 onAbort 自清理。
      }
    }
    for (const fn of [...(this.waiters.get(teamId) ?? [])]) fn();
  }

  subscribe(teamId: string, send: (ev: MachineStreamEvent) => void): () => void {
    let set = this.streams.get(teamId);
    if (!set) {
      set = new Set();
      this.streams.set(teamId, set);
    }
    set.add(send);
    return () => {
      set?.delete(send);
      if (set && set.size === 0) this.streams.delete(teamId);
    };
  }

  /** 机器定向订阅（M7 #319 [设计]，08 册附录 B「分支同步」）：team SSE
   * 注册 + machine 索引登记，返回两个清理句柄绑定的复合 unsubscribe。daemon
   * 一个 SSE 连接 = 一台机器，machineId 由 auth 中间件已校验，重复调用 =
   * 后注册覆盖前注册（同一 daemon 重连即重注册，连接已死前一条自动失效）。 */
  subscribeMachine(
    teamId: string,
    machineId: string,
    send: (ev: MachineStreamEvent) => void,
  ): () => void {
    const unsubscribeTeam = this.subscribe(teamId, send);
    const prev = this.streamsByMachine.get(machineId);
    if (prev) {
      try {
        prev.send({ type: 'shutdown' });
      } catch {
        // 连接已死
      }
    }
    this.streamsByMachine.set(machineId, { teamId, send });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unsubscribeTeam();
      const cur = this.streamsByMachine.get(machineId);
      if (cur && cur.send === send) this.streamsByMachine.delete(machineId);
    };
  }

  /** 机器定向派发 sync 命令（M7 #319 [设计]）：单机命中 = SSE 流在
   * → 派发 sync 事件；未命中（机器离线/SSE 断连）= false。返回 bool 取代抛
   * 错，调用方（services/branch-sync.ts）按 machine.online 校验后仍以本返回值
   * 为准——online 列 = presence 心跳面，本索引 = 实时 SSE 面，二者错位中间
   * 态由调用方处理（写 failed 行 + 推团队流）。 */
  pushSync(machineId: string, cmd: MachineSyncCommand): boolean {
    const entry = this.streamsByMachine.get(machineId);
    if (!entry) return false;
    try {
      entry.send({ type: 'sync', sync: cmd });
      return true;
    } catch {
      return false;
    }
  }

  /** 机器定向索引清理（认证 SSE 流 onAbort 时由路由显式调用，避免
   * streamsByMachine 残留）。 */
  releaseMachine(machineId: string): void {
    this.streamsByMachine.delete(machineId);
  }

  streamCount(teamId: string): number {
    return this.streams.get(teamId)?.size ?? 0;
  }

  /** steer 信号（W3 #278）：推送 SSE steer 事件（载荷只带 stepId 信号）。
   * 不触发 claim 长轮询唤醒——steer 不入队，运行中的步经
   * GET /api/machine/steer 拉取-确认（spec #277「SSE 载荷不携文本防丢」）。 */
  steerSignal(teamId: string, stepId: string): void {
    for (const send of this.streams.get(teamId) ?? []) {
      try {
        send({ type: 'steer', stepId });
      } catch {
        // 连接已死：订阅方 onAbort 自清理。
      }
    }
  }

  /** stop 信号（M7 #308）：推送 SSE stop 事件（载荷只带 stepId 信号，
   * discard 位经 GET /api/machine/stop 拉取-确认——steer 同律，SSE 载荷
   * 不携语义位防丢）。不触发 claim 长轮询唤醒。 */
  stopSignal(teamId: string, stepId: string): void {
    for (const send of this.streams.get(teamId) ?? []) {
      try {
        send({ type: 'stop', stepId });
      } catch {
        // 连接已死：订阅方 onAbort 自清理。
      }
    }
  }
}
