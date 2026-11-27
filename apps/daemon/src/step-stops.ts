import type { AgentSessionHandle } from '@cairn/shared';
import { MachineApiError } from './machine-client.js';

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

export async function deliverStopRequest(input: {
  stepId: string;
  generation?: number | undefined;
  fetchStop: () => Promise<boolean | null>;
  stops: StepStops;
  deliveredStops: Set<string>;
  log: (line: string) => void;
}): Promise<void> {
  const { stepId, generation, fetchStop, stops, deliveredStops, log } = input;
  const deliveredKey = generation === undefined ? stepId : `${stepId}:${generation}`;
  const target = stops.get(stepId);
  if (target === undefined) {
    log(`stop dropped (no live session) step=${stepId}`);
    return;
  }
  try {
    let discard: boolean | null;
    try {
      discard = await fetchStop();
    } catch (err) {
      if (
        err instanceof MachineApiError &&
        (err.status === 404 || err.status === 409 || err.status === 410)
      ) {
        discard = false;
      } else {
        throw err;
      }
    }
    if (discard === null || deliveredStops.has(deliveredKey)) return;
    if (stops.get(stepId) !== target) {
      log(`stop dropped (session replaced) step=${stepId}`);
      return;
    }
    await target.deliver({ discard });
    deliveredStops.add(deliveredKey);
    log(`stop delivered step=${stepId}`);
  } catch (err) {
    log(`stop delivery failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
