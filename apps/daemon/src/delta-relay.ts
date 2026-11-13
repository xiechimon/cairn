export interface DeltaRelayOptions {
  flushMs: number;
  send: (text: string) => Promise<unknown> | undefined;
  onError: (err: unknown) => void;
}

export class DeltaRelay {
  private buffered = '';
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: DeltaRelayOptions) {}

  push(text: string): void {
    this.buffered += text;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), this.options.flushMs);
    this.timer.unref?.();
  }

  async flushNow(): Promise<void> {
    const text = this.take();
    if (text === '') return;
    try {
      await this.options.send(text);
    } catch (err: unknown) {
      this.options.onError(err);
    }
  }

  flush(): void {
    void this.flushNow();
  }

  discard(): void {
    this.take();
  }

  private take(): string {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const text = this.buffered;
    this.buffered = '';
    return text;
  }
}
