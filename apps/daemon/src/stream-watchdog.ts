export type StreamTimeoutArm = 'first' | 'idle' | 'body' | 'duration';

export interface StreamTimeouts {
  first: number;
  idle: number;
  body: number;
}

export function streamTimeoutMessage(
  arm: StreamTimeoutArm,
  timeouts: StreamTimeouts & { durationCap: number },
): string {
  const value =
    arm === 'first'
      ? timeouts.first
      : arm === 'idle'
        ? timeouts.idle
        : arm === 'body'
          ? timeouts.body
          : timeouts.durationCap;
  const label = arm === 'duration' ? 'cap' : arm;
  return `stream timeout (arm=${arm}, ${label}=${value}ms)`;
}

export interface StreamWatchdogOptions {
  timeouts: StreamTimeouts;
  durationCapMs: number;
  durationCapIsAbsolute: boolean;
  progressExtendsDuration: boolean;
  onTrip: (arm: StreamTimeoutArm) => void;
}

export class StreamWatchdog {
  private tripped: StreamTimeoutArm | null = null;
  private readonly runningToolCalls = new Set<string>();
  private silence: NodeJS.Timeout | null = null;
  private body: NodeJS.Timeout | null = null;
  private duration: NodeJS.Timeout | null = null;

  constructor(private readonly options: StreamWatchdogOptions) {}

  get trippedArm(): StreamTimeoutArm | null {
    return this.tripped;
  }

  startPass(isFirstPass: boolean): void {
    this.runningToolCalls.clear();
    this.armSilence('first');
    this.armBody();
    if (isFirstPass) this.armDuration();
  }

  noteToolCall(id: string, running: boolean): void {
    if (running) this.runningToolCalls.add(id);
    else this.runningToolCalls.delete(id);
  }

  noteEvent(): void {
    this.armSilence('idle');
    this.armBody();
  }

  noteProgress(): void {
    if (this.options.progressExtendsDuration) this.armDuration();
  }

  keepAlive(): void {
    this.noteEvent();
    this.armDuration();
  }

  clearTrip(): void {
    this.tripped = null;
  }

  stop(): void {
    if (this.silence) clearTimeout(this.silence);
    if (this.body) clearTimeout(this.body);
    if (this.duration) clearTimeout(this.duration);
    this.silence = null;
    this.body = null;
    this.duration = null;
  }

  message(): string | null {
    if (this.tripped === null) return null;
    return streamTimeoutMessage(this.tripped, {
      ...this.options.timeouts,
      durationCap: this.options.durationCapMs,
    });
  }

  private trip(arm: StreamTimeoutArm): void {
    this.tripped = arm;
    this.options.onTrip(arm);
  }

  private armSilence(arm: 'first' | 'idle'): void {
    if (this.silence) clearTimeout(this.silence);
    this.silence = null;
    if (arm === 'idle' && this.runningToolCalls.size > 0) return;
    this.silence = setTimeout(() => this.trip(arm), this.options.timeouts[arm]);
    this.silence.unref?.();
  }

  private armBody(): void {
    if (this.body) clearTimeout(this.body);
    this.body = null;
    if (this.runningToolCalls.size > 0) return;
    this.body = setTimeout(() => this.trip('body'), this.options.timeouts.body);
    this.body.unref?.();
  }

  private armDuration(): void {
    if (this.duration && this.options.durationCapIsAbsolute) return;
    if (this.duration) clearTimeout(this.duration);
    this.duration = setTimeout(() => this.trip('duration'), this.options.durationCapMs);
    this.duration.unref?.();
  }
}
