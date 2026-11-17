import type { StepEvent } from '@cairn/shared';

export class EventQueue {
  private readonly items: StepEvent[] = [];
  private waiter: ((r: IteratorResult<StepEvent>) => void) | null = null;
  private ended = false;

  push(ev: StepEvent): void {
    if (this.ended) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: ev, done: false });
      return;
    }
    this.items.push(ev);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as unknown as StepEvent, done: true });
    }
  }

  next(): Promise<IteratorResult<StepEvent>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.ended) {
      return Promise.resolve({ value: undefined as unknown as StepEvent, done: true });
    }
    return new Promise<IteratorResult<StepEvent>>((resolve) => {
      this.waiter = resolve;
    });
  }

  iterable(): AsyncIterable<StepEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<StepEvent> {
        return { next: () => self.next() };
      },
    };
  }
}
