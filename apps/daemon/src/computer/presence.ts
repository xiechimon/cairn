import type { ComputerPresence, MachinePresenceBody } from '@cairn/shared';

export interface ComputerPresenceSource {
  presence(signal?: AbortSignal): Promise<ComputerPresence[]>;
  subscribe(listener: () => void): () => void;
}

interface ComputerPresenceReporterOptions {
  source?: ComputerPresenceSource;
  body(): MachinePresenceBody;
  send(body: MachinePresenceBody, signal: AbortSignal): Promise<void>;
  timeoutMs?: number;
  probeTimeoutMs?: number;
  onError?(error: unknown): void;
  onSuccess?(): void;
  onFailure?(error: unknown): void;
}

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class ComputerPresenceReporter {
  private readonly unsubscribe: (() => void) | undefined;
  private active: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private requested = false;
  private closed = false;

  constructor(private readonly options: ComputerPresenceReporterOptions) {
    this.unsubscribe = options.source?.subscribe(() => {
      void this.send().catch((error: unknown) => options.onError?.(error));
    });
  }

  send(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Computer presence reporter is closed'));
    this.requested = true;
    if (!this.active) {
      this.active = this.drain().finally(() => {
        this.active = undefined;
      });
    }
    return this.active;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.requested = false;
    this.unsubscribe?.();
    this.controller?.abort(new Error('Computer presence reporter is closed'));
    await this.active?.catch(() => {});
  }

  private async drain(): Promise<void> {
    while (this.requested && !this.closed) {
      this.requested = false;
      const controller = new AbortController();
      this.controller = controller;
      const timeoutMs = this.options.timeoutMs ?? 20_000;
      const timer = setTimeout(() => {
        controller.abort(new Error(`Machine presence timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      try {
        const body = this.options.body();
        if (this.options.source) {
          const probe = new AbortController();
          const probeTimer = setTimeout(
            () => probe.abort(new Error('Computer presence probe timed out')),
            this.options.probeTimeoutMs ?? 3_000,
          );
          try {
            const signal = AbortSignal.any([controller.signal, probe.signal]);
            body.computers = await untilAborted(this.options.source.presence(signal), signal);
          } catch {
            controller.signal.throwIfAborted();
          } finally {
            clearTimeout(probeTimer);
          }
        }
        controller.signal.throwIfAborted();
        await untilAborted(this.options.send(body, controller.signal), controller.signal);
        this.options.onSuccess?.();
      } catch (error) {
        this.options.onFailure?.(error);
        throw error;
      } finally {
        clearTimeout(timer);
        this.controller = undefined;
      }
    }
  }
}
