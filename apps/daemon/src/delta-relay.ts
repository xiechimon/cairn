export interface DeltaRelayOptions {
  flushMs: number;
  leading?: boolean;
  send: (text: string) => Promise<unknown> | undefined;
  onError: (err: unknown) => void;
}

export class DeltaRelay {
  private buffered = '';
  private timer: NodeJS.Timeout | null = null;
  private inWindow = false;
  private pending: Promise<void> | null = null;

  constructor(private readonly options: DeltaRelayOptions) {}

  push(text: string): void {
    if (
      this.options.leading === true &&
      !this.inWindow &&
      this.timer === null &&
      this.buffered === ''
    ) {
      this.inWindow = true;
      this.armTimer();
      void this.enqueue(text);
      return;
    }
    this.buffered += text;
    if (this.timer !== null) return;
    this.armTimer();
  }

  async flushNow(): Promise<void> {
    this.inWindow = false;
    const text = this.take();
    if (text !== '') {
      await this.enqueue(text);
      return;
    }
    if (this.pending !== null) await this.pending;
  }

  flush(): void {
    void this.flushNow();
  }

  discard(): void {
    this.inWindow = false;
    this.take();
  }

  private armTimer(): void {
    this.timer = setTimeout(() => {
      if (this.options.leading === true) {
        this.timer = null;
        const text = this.takeBufferOnly();
        if (text !== '') {
          this.inWindow = true;
          this.armTimer();
          void this.enqueue(text);
        } else {
          this.inWindow = false;
        }
        return;
      }
      this.flush();
    }, this.options.flushMs);
    this.timer.unref?.();
  }

  private async sendNow(text: string): Promise<void> {
    try {
      await this.options.send(text);
    } catch (err: unknown) {
      this.options.onError(err);
    }
  }

  private enqueue(text: string): Promise<void> {
    const start =
      this.pending === null ? this.sendNow(text) : this.pending.then(() => this.sendNow(text));
    const tracked = start.finally(() => {
      if (this.pending === tracked) this.pending = null;
    });
    this.pending = tracked;
    return tracked;
  }

  private takeBufferOnly(): string {
    const text = this.buffered;
    this.buffered = '';
    return text;
  }

  private take(): string {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.takeBufferOnly();
  }
}
