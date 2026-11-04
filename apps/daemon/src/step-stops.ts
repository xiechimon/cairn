import type { AgentSessionHandle } from '@cairn/shared';

export interface StopRequest {
  discard: boolean;
}

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
