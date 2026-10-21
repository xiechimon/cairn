import type { AgentSessionHandle } from '@pacman/shared';

/** 停止请求：discard = 「丢弃本轮修改」勾选位，true → 收尾 rewind 到步起点。 */
export interface StopRequest {
  discard: boolean;
}

/** 一次 runStep 的停止位。会话未开时只记下请求，runStep 开会话前查 request、
 * 开会话后 attach 兑现；收尾读取时 settle，此后再来的停止不再接收。中断调用
 * 抛错时请求作废：会话没真停，收尾不该按 stopped 判。 */
export class RunStop {
  private current: StopRequest | null = null;
  private session: AgentSessionHandle | null = null;
  private settled = false;

  constructor(private readonly onLeave: () => void = () => {}) {}

  get request(): StopRequest | null {
    return this.current;
  }

  /** 记下请求（同步）；已 settle 返回 false。 */
  accept(req: StopRequest): boolean {
    if (this.settled) return false;
    this.current = req;
    return true;
  }

  attach(session: AgentSessionHandle): Promise<void> {
    this.session = session;
    return this.interrupt();
  }

  detach(): void {
    this.session = null;
  }

  settle(): StopRequest | null {
    this.settled = true;
    this.session = null;
    return this.current;
  }

  leave(): void {
    this.settle();
    this.onLeave();
  }

  /** 会话已开且有请求则中断。 */
  async interrupt(): Promise<void> {
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

/** 本机在跑 run 的停止位登记表，按步号分组：同一步号可能同时有两次 run。 */
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

  /** 把请求记到这一步在本机每一次还没收尾的 run 上（同步）；返回接收的 run。 */
  accept(stepId: string, req: StopRequest): RunStop[] {
    return [...(this.runs.get(stepId) ?? [])].filter((run) => run.accept(req));
  }

  /** accept + 中断；返回接收的 run 数，0 = 本机没有这一步在跑。 */
  async deliver(stepId: string, req: StopRequest): Promise<number> {
    const runs = this.accept(stepId, req);
    await Promise.all(runs.map((run) => run.interrupt()));
    return runs.length;
  }
}
