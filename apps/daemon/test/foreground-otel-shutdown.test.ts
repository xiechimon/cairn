import { createServer } from 'node:http';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { expect, test, vi } from 'vitest';
import { PiStepSpanSink } from '../src/backend/otel.js';
import { runForeground } from '../src/cli.js';
import { runMachine } from '../src/machine-loop.js';
import { testTempDir } from './test-temp-dir.js';

vi.mock('../src/machine-loop.js', () => ({
  runMachine: vi.fn(async () => ({ done: Promise.resolve(), stop: vi.fn() })),
}));
vi.mock('../src/config.js', async (original) => ({
  ...(await original<typeof import('../src/config.js')>()),
  loadDaemonConfig: () => ({ home: '/tmp/synthetic-otel-foreground', workspacesDir: '/tmp' }),
}));
vi.mock('../src/log.js', () => ({
  createDaemonLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

test.each(['normal', 'control-stream', 'SIGTERM', 'SIGINT', 'failure'] as const)(
  '%s completion waits for the final SDK export',
  async (mode) => {
    let receivedResolve = () => {};
    const received = new Promise<void>((resolve) => {
      receivedResolve = resolve;
    });
    let releaseResolve = () => {};
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const server = createServer(async (request, response) => {
      request.resume();
      receivedResolve();
      await release;
      response.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing collector');
    const directory = testTempDir('foreground-otel-');
    const ctx = stepOtelContext(
      directory,
      'step',
      parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}` })!,
    );
    const sink = new PiStepSpanSink(ctx, { provider: 'synthetic', model: 'model' });
    sink.chat(Date.now(), { finishReason: 'stop' });
    await sink.flush();
    let finishMachine = () => {};
    let failMachine = (_error: Error) => {};
    const done = new Promise<void>((resolve, reject) => {
      finishMachine = resolve;
      failMachine = reject;
    });
    const stop = vi.fn(async () => {
      finishMachine();
    });
    vi.mocked(runMachine).mockResolvedValueOnce({
      machineId: 'synthetic',
      done,
      stop,
      recheckConfinement: vi.fn(),
    });
    let completed = false;
    const termListeners = process.listeners('SIGTERM');
    const intListeners = process.listeners('SIGINT');
    let failure: unknown;
    const foreground = runForeground({ workspacesDir: join(directory, 'workspaces') })
      .catch((error: unknown) => {
        failure = error;
      })
      .then(() => {
        completed = true;
      });
    try {
      await vi.waitFor(() => expect(vi.mocked(runMachine)).toHaveBeenCalled());
      await Promise.resolve();
      if (mode === 'SIGTERM' || mode === 'SIGINT') {
        const previous = mode === 'SIGTERM' ? termListeners : intListeners;
        const added = process.listeners(mode).filter((listener) => !previous.includes(listener));
        expect(added).toHaveLength(1);
        added[0]?.(mode);
        expect(stop).toHaveBeenCalledWith(mode);
      } else if (mode === 'failure') {
        failMachine(new Error('Synthetic machine completion failure'));
      } else if (mode === 'control-stream') {
        await stop();
      } else {
        finishMachine();
      }
      await received;
      await nextTurn();
      expect(completed).toBe(false);
      releaseResolve();
      await foreground;
      expect(completed).toBe(true);
      if (mode === 'failure')
        expect(failure).toEqual(new Error('Synthetic machine completion failure'));
      else expect(failure).toBeUndefined();
    } finally {
      releaseResolve();
      finishMachine();
      await foreground;
      vi.clearAllMocks();
      for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        const previous = signal === 'SIGTERM' ? termListeners : intListeners;
        for (const listener of process.listeners(signal))
          if (!previous.includes(listener)) process.off(signal, listener);
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
