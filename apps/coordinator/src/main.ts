import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { readConfig } from './config.js';
import { claimLoop } from './loop.js';
import { httpMachineApi } from './machine-api.js';
import { startRuntime } from './runtime/start.js';
import { acquireStoreLock } from './store-lock.js';

const config = readConfig(process.env);
mkdirSync(config.storageDir, { recursive: true, mode: 0o700 });
const releaseStoreLock = acquireStoreLock(config.storageDir);
const api = httpMachineApi(config.serverUrl, config.machineToken);
const log = (line: string) => console.log(`${new Date().toISOString()} [coordinator] ${line}`);
const runtime = await startRuntime(config, api);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    log(`${signal}: closing after the current turn`);
  });
}
log(`storage ${config.storageDir}, server ${config.serverUrl}`);
await claimLoop({
  api,
  runTurn: runtime.runTurn,
  sleep: (ms) => sleep(ms),
  log,
  stopped: () => stopping,
});
await runtime.close();
releaseStoreLock();
