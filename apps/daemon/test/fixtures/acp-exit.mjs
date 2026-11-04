import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createAcpBackend } from '../../src/backend/acp.ts';

let adapterPid;
const backend = createAcpBackend({
  harness: 'codex',
  command: process.execPath,
  args: [fileURLToPath(new URL('./acp-agent.mjs', import.meta.url)), 'descendant'],
  spawnProcess: (command, args, options) => {
    const child = spawn(command, args, { ...options, stdio: 'pipe' });
    adapterPid = child.pid;
    return child;
  },
});
const session = await backend.createSession({
  cwd: process.cwd(),
  provider: { kind: 'api_key', providerId: 'openai' },
  modelId: 'stub-model',
  prompt: 'Hello',
});
const { value } = await session.events[Symbol.asyncIterator]().next();
if (value?.type !== 'text_delta') throw new Error('Missing descendant PID');
const exit = once(process, 'message');
process.send({ adapterPid, descendantPid: Number(value.text) });
await exit;
if (process.argv[2] === 'stop-exit') await session.stop();
process.exit(0);
