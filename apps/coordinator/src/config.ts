import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CoordinatorConfig {
  serverUrl: string;
  machineToken: string;
  storagePath: string;
  heartbeatMs: number;
  summaryModelId: string;
}

export function readMachineToken(path: string): string {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`${path} is readable by other users (mode ${mode.toString(8)}); chmod 600 it`);
  }
  const token = readFileSync(path, 'utf8').trim();
  if (token === '') throw new Error(`${path} is empty`);
  return token;
}

export function readConfig(env: NodeJS.ProcessEnv): CoordinatorConfig {
  const home = env.CAIRN_HOME ?? join(homedir(), '.cairn');
  const dir = join(home, 'coordinator');
  return {
    serverUrl: env.CAIRN_COORDINATOR_SERVER_URL ?? 'http://127.0.0.1:8787',
    machineToken: readMachineToken(env.CAIRN_COORDINATOR_TOKEN_FILE ?? join(dir, 'machine-token')),
    storagePath: env.CAIRN_COORDINATOR_STORE ?? join(dir, 'coordinator.sqlite'),
    heartbeatMs: 15_000,
    summaryModelId: env.CAIRN_COORDINATOR_SUMMARY_MODEL ?? 'claude-haiku-5-5',
  };
}
