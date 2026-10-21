// 停止投递的接收面（M7 #308；verify-step-claim F3）：停止按 run 投递，不按
// 会话句柄投递。runStep 一进门就登记自己的停止位，所以会话还没开（准备期、
// createSession 在途、两轮会话之间）收到的停止也有处可落；同一步号在本机
// 同时有两次 run 时，两次都收到。

import type { AgentSessionHandle } from '@pacman/shared';

/** 停止请求：discard = 「丢弃本轮修改」勾选位，true → 收尾 rewind 到步起点。 */
export interface StopRequest {
  discard: boolean;
}

/** 一次 runStep 的停止位。会话已开时投递即中断；未开时只记下请求，
 * runStep 开会话前查 request、开会话后 attach 兑现。中断调用抛错时请求
 * 作废：会话没真停，收尾不该按 stopped 判。 */
export class RunStop {
  private current: StopRequest | null = null;
  private session: AgentSessionHandle | null = null;

  constructor(private readonly onLeave: () => void = () => {}) {}

  get request(): StopRequest | null {
    return this.current;
  }

  deliver(req: StopRequest): Promise<void> {
    this.current = req;
    return this.interrupt();
  }

  attach(session: AgentSessionHandle): Promise<void> {
    this.session = session;
    return this.interrupt();
  }

  detach(): void {
    this.session = null;
  }

  leave(): void {
    this.session = null;
    this.onLeave();
  }

  private async interrupt(): Promise<void> {
    const session = this.session;
    if (this.current === null || session === null) return;
    try {
      await session.stop();
    } catch (err) {
      this.current = null;
      throw err;
    }
  }
}

/** 本机在跑 run 的停止位登记表（machine-loop 持有一份）。 */
export class StepStops {
  private readonly runs = new Map<string, Set<RunStop>>();

  enter(stepId: string): RunStop {
    const group = this.runs.get(stepId) ?? new Set<RunStop>();
    this.runs.set(stepId, group);
    const run = new RunStop(() => {
      group.delete(run);
      if (group.size === 0 && this.runs.get(stepId) === group) this.runs.delete(stepId);
    });
    group.add(run);
    return run;
  }

  /** 投给这一步在本机的每一次 run；返回收到的 run 数，0 = 本机没有这一步在跑。 */
  async deliver(stepId: string, req: StopRequest): Promise<number> {
    const runs = [...(this.runs.get(stepId) ?? [])];
    await Promise.all(runs.map((run) => run.deliver(req)));
    return runs.length;
  }
}
