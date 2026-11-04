import type { ComputerFrame } from '@cairn/shared';
import { COMPUTER_FRAME_TEXT_MAX_CHARS, COMPUTER_FRAMES_PER_POST_MAX } from '@cairn/shared';
import { type MachineApi, MachineApiError } from '../machine-client.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ComputerFrameBody = DistributiveOmit<ComputerFrame, 'seq'>;

export const OUTPUT_TRUNCATED_MARKER = '[output truncated]\n';

export interface FramePosterOptions {
  client: Pick<MachineApi, 'computerFrames'>;
  callId: string;
  deadlineAt: number;
  flushMs: number;
  heartbeatMs: number;
  outputCapChars: number;
  retryBaseMs: number;
  retryMaxMs: number;
  now: () => number;
  onStop: (reason: 'cancelled' | 'unreachable') => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalPostError(error: unknown): boolean {
  if (!(error instanceof MachineApiError)) return false;
  const retryable = [401, 408, 425, 429];
  return error.status >= 400 && error.status < 500 && !retryable.includes(error.status);
}

function splitPoint(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

export class FramePoster {
  private nextSeq = 1;
  private queue: ComputerFrame[] = [];
  private buffer = '';
  private bufferStream: 'stdout' | 'stderr' = 'stdout';
  private forwarded = 0;
  private truncated = false;
  private sending: Promise<void> | undefined;
  private lastActivity: number;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly heartbeatTimer: NodeJS.Timeout;
  private finished = false;
  private gaveUp = false;

  constructor(private readonly options: FramePosterOptions) {
    this.lastActivity = options.now();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), options.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  get abandoned(): boolean {
    return this.gaveUp;
  }

  output(stream: 'stdout' | 'stderr', text: string): void {
    if (this.finished || this.gaveUp || text === '') return;
    if (this.truncated) return;
    const room = this.options.outputCapChars - this.forwarded;
    let kept = text;
    if (text.length > room) {
      kept = text.slice(0, splitPoint(text, Math.max(room, 0)));
      this.truncated = true;
    }
    if (kept !== '') {
      if (this.buffer !== '' && stream !== this.bufferStream) this.flushBuffer();
      this.bufferStream = stream;
      this.buffer += kept;
      this.forwarded += kept.length;
    }
    if (this.truncated) {
      if (this.buffer !== '' && this.bufferStream !== 'stderr') this.flushBuffer();
      this.bufferStream = 'stderr';
      this.buffer += OUTPUT_TRUNCATED_MARKER;
      this.flushBuffer();
      return;
    }
    if (this.buffer.length >= COMPUTER_FRAME_TEXT_MAX_CHARS) this.flushBuffer();
    else if (this.buffer !== '' && !this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushBuffer(), this.options.flushMs);
      this.flushTimer.unref();
    }
  }

  async finish(final: ComputerFrameBody): Promise<void> {
    if (this.finished) return;
    this.flushBuffer();
    this.finished = true;
    clearInterval(this.heartbeatTimer);
    this.enqueue(final);
    while (!this.gaveUp && (this.sending || this.queue.length > 0)) {
      this.kick();
      await this.sending;
    }
  }

  private flushBuffer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    while (this.buffer !== '') {
      const cut = splitPoint(this.buffer, COMPUTER_FRAME_TEXT_MAX_CHARS);
      const text = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      this.enqueue({ kind: 'output', stream: this.bufferStream, text });
    }
  }

  private heartbeat(): void {
    if (this.finished || this.gaveUp || this.queue.length > 0 || this.sending) return;
    if (this.options.now() - this.lastActivity < this.options.heartbeatMs) return;
    this.enqueue({ kind: 'heartbeat' });
  }

  private enqueue(body: ComputerFrameBody): void {
    if (this.gaveUp) return;
    this.queue.push({ ...body, seq: this.nextSeq++ } as ComputerFrame);
    this.lastActivity = this.options.now();
    this.kick();
  }

  private kick(): void {
    if (this.sending || this.gaveUp || this.queue.length === 0) return;
    this.sending = this.pump().finally(() => {
      this.sending = undefined;
      this.kick();
    });
  }

  private giveUp(): void {
    this.gaveUp = true;
    this.queue = [];
    clearInterval(this.heartbeatTimer);
    this.options.onStop('unreachable');
  }

  private async pump(): Promise<void> {
    let backoff = this.options.retryBaseMs;
    while (this.queue.length > 0 && !this.gaveUp) {
      const batch = this.queue.slice(0, COMPUTER_FRAMES_PER_POST_MAX);
      try {
        const response = await this.options.client.computerFrames?.(this.options.callId, {
          frames: batch,
        });
        if (!response) return this.giveUp();
        this.queue.splice(0, batch.length);
        this.lastActivity = this.options.now();
        backoff = this.options.retryBaseMs;
        if (response.cancelled) this.options.onStop('cancelled');
      } catch (error) {
        const remaining = this.options.deadlineAt - this.options.now();
        if (isTerminalPostError(error) || remaining <= 0) return this.giveUp();
        await sleep(Math.min(backoff, remaining));
        backoff = Math.min(backoff * 2, this.options.retryMaxMs);
      }
    }
  }
}
