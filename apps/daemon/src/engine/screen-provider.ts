import { Duplex, PassThrough } from 'node:stream';
import type { AgentSessionHandle, EngineScreenRequest } from '@cairn/shared';
import type { EnginePty } from './engine-pty.js';
import type { EngineScreenConnection, EngineScreenProvider } from './screen-channel.js';

export interface EngineScreenProviderOptions {
  handleForStep(stepId: string): AgentSessionHandle | undefined;
  ptyForHandle(handle: AgentSessionHandle): EnginePty | undefined;
}

export function createEngineScreenProvider(
  options: EngineScreenProviderOptions,
): EngineScreenProvider {
  return {
    connectScreen(request) {
      const handle = options.handleForStep(request.stepId);
      const pty = handle === undefined ? undefined : options.ptyForHandle(handle);
      if (pty === undefined || pty.closed) {
        return Promise.reject(new Error('step has no live engine pty'));
      }
      if (request.kind === 'takeover') {
        const leaseId = request.takeoverLeaseId;
        if (leaseId === null || !pty.acquireHold(leaseId, request.takeoverFence)) {
          return Promise.reject(new Error('engine takeover hold refused'));
        }
      }
      const stream = new PassThrough();
      const detach = pty.attach((chunk) => stream.write(chunk), request.fromSeq);
      let closed = false;
      const release = () => {
        if (closed) return;
        closed = true;
        detach();
        if (request.kind === 'takeover' && request.takeoverLeaseId !== null) {
          pty.releaseHold(request.takeoverLeaseId, request.takeoverFence);
        }
        stream.destroy();
      };
      return Promise.resolve<EngineScreenConnection>({
        stream: new EngineScreenStream(stream, request, pty),
        close: release,
      });
    },
  };
}

class EngineScreenStream extends Duplex {
  constructor(
    private readonly source: PassThrough,
    private readonly request: EngineScreenRequest,
    private readonly pty: EnginePty,
  ) {
    super();
    source.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) source.pause();
    });
    source.once('end', () => this.push(null));
    source.once('close', () => this.destroy());
    source.once('error', (error) => this.destroy(error));
  }

  _read(): void {
    this.source.resume();
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const leaseId = this.request.takeoverLeaseId;
    if (this.request.kind === 'takeover' && leaseId !== null) {
      this.pty.writeOwner(leaseId, this.request.takeoverFence, bytes);
    }
    callback();
  }
}
