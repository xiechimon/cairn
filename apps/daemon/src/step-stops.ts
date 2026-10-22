import type { AgentSessionHandle } from '@pacman/shared';

/** 停止请求：discard = 「丢弃本轮修改」勾选位，true → 收尾 rewind 到步起点。 */
export interface StopRequest {
  discard: boolean;
}

/** 一次 runStep 的停止位。会话未开时只记下请求，runStep 开会话前查 request、
 * 开会话后 attach 兑现；收尾读取时 settle 并注销，此后再来的停止找不到它。
 * 请求随记随落盘（persist），中断调用抛错时作废并抹掉：会话没真停，收尾与
 * 重启都不该按 stopped 判。 */
export class RunStop {
  private current: StopRequest | null = null;
  private session: AgentSessionHandle | null = null;

  constructor(
    private readonly persist: (req: StopRequest | null) => void,
    private readonly unregister: () => void,
  ) {}

  get request(): StopRequest | null {
    return this.current;
  }

  accept(req: StopRequest): void {
    this.current = req;
    this.persist(req);
  }

  async deliver(req: StopRequest): Promise<void> {
    this.accept(req);
    await this.interrupt();
  }

  attach(session: AgentSessionHandle): Promise<void> {
    this.session = session;
    return this.interrupt();
  }

  detach(): void {
    this.session = null;
  }

  settle(): StopRequest | null {
    this.unregister();
    return this.current;
  }

  private async interrupt(): Promise<void> {
    const session = this.session;
    if (this.current === null || session === null) return;
    try {
      await session.stop();
    } catch (err) {
      this.current = null;
      this.persist(null);
      throw err;
    }
  }
}

/** 本机在跑 run 的停止位登记表（machine-loop 持有一份）。同一步号在本机只有
 * 一次 run（#1473 领取循环不起第二次）。 */
export class StepStops {
  private readonly runs = new Map<string, RunStop>();

  enter(stepId: string, persist: (req: StopRequest | null) => void = () => {}): RunStop {
    const run = new RunStop(persist, () => {
      if (this.runs.get(stepId) === run) this.runs.delete(stepId);
    });
    this.runs.set(stepId, run);
    return run;
  }

  get(stepId: string): RunStop | undefined {
    return this.runs.get(stepId);
  }
}
