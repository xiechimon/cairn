import { createComputerDispatcher } from '../src/computer/dispatch.js';
import type { ComputerExecuteRequest } from '../src/computer/provider.js';
import { MachineClient } from '../src/machine-client.js';

let attempted: () => void = () => {};
const firstAttempt = new Promise<void>((resolve) => {
  attempted = resolve;
});
const dispatcher = createComputerDispatcher({
  client:
    process.argv[2] === 'fetch'
      ? new MachineClient({
          serverUrl: process.argv[3] ?? '',
          fetchImpl: (input, init) => {
            attempted();
            return fetch(input, init);
          },
        })
      : {
          async computerFrames() {
            attempted();
            if (process.argv[2] === 'stalled') return new Promise<never>(() => {});
            throw new Error('offline');
          },
        },
  host: {
    async execute({ signal }: ComputerExecuteRequest) {
      return (async function* () {
        yield { kind: 'stdout' as const, text: 'started'.repeat(10000) };
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { kind: 'exit' as const, code: 130 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  },
  flushMs: 1,
  heartbeatMs: 1000,
  retryBaseMs: 10000,
  retryMaxMs: 10000,
});
const running = dispatcher.dispatch({
  callId: 'a'.repeat(64),
  stepId: 'step',
  tool: 'user_computer_shell',
  params: { command: 'true' },
  deadlineAt: Date.now() + 60000,
});
await firstAttempt;
await new Promise<void>((resolve) => setImmediate(resolve));
await dispatcher.close();
await running;
process.stdout.write('closed\n');
