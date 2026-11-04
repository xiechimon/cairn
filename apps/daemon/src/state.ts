import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DaemonJson,
  type DeviceJson,
  daemonJsonSchema,
  deviceJsonSchema,
  type MachineJson,
  machineJsonSchema,
} from '@cairn/shared';
import { ensurePrivateDir, writePrivateFile } from './private-fs.js';

export interface StatePaths {
  home: string;
  machineJson: string;
  deviceJson: string;
  daemonJson: string;
  daemonLog: string;
  outboxDir: string;
  chatSessionsDir: string;
  agentRuntimeDir: string;
  workspacesDir: string;
  teamSkillsCacheDir: string;
  stepAttachmentsDir: string;
  plansDir: string;
  reportsDir: string;
}

export function statePaths(home: string, workspacesDir?: string): StatePaths {
  return {
    home,
    machineJson: join(home, 'machine.json'),
    deviceJson: join(home, 'device.json'),
    daemonJson: join(home, 'daemon.json'),
    daemonLog: join(home, 'daemon.log'),
    outboxDir: join(home, 'outbox'),
    chatSessionsDir: join(home, 'chat-sessions'),
    agentRuntimeDir: join(home, 'agent-runtime'),
    workspacesDir: workspacesDir ?? join(home, 'workspaces'),
    teamSkillsCacheDir: join(home, 'team-skills'),
    stepAttachmentsDir: join(home, 'step-attachments'),
    plansDir: join(home, 'plans'),
    reportsDir: join(home, 'reports'),
  };
}

export function ensureStateDirs(paths: StatePaths): void {
  for (const dir of [
    paths.home,
    paths.outboxDir,
    paths.chatSessionsDir,
    paths.agentRuntimeDir,
    paths.workspacesDir,
  ]) {
    ensurePrivateDir(dir);
  }
}

function readJsonOr(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function loadMachineJson(paths: StatePaths): MachineJson | null {
  const raw = readJsonOr(paths.machineJson);
  if (raw === null) return null;
  const parsed = machineJsonSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function saveMachineJson(paths: StatePaths, value: MachineJson): void {
  machineJsonSchema.parse(value);
  writePrivateFile(paths.machineJson, `${JSON.stringify(value, null, 2)}\n`);
}

export function forgetMachine(paths: StatePaths): boolean {
  if (!existsSync(paths.machineJson)) return false;
  rmSync(paths.machineJson);
  return true;
}

export function loadOrCreateDeviceJson(paths: StatePaths): DeviceJson {
  const existing = readJsonOr(paths.deviceJson);
  const parsed = existing === null ? null : deviceJsonSchema.safeParse(existing);
  if (parsed?.success) return parsed.data;
  const fresh: DeviceJson = { deviceId: randomBytes(16).toString('hex') };
  writePrivateFile(paths.deviceJson, `${JSON.stringify(fresh, null, 2)}\n`);
  return fresh;
}

export function writeDaemonJson(paths: StatePaths, value: DaemonJson): void {
  daemonJsonSchema.parse(value);
  writePrivateFile(paths.daemonJson, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadDaemonJson(paths: StatePaths): DaemonJson | null {
  const raw = readJsonOr(paths.daemonJson);
  if (raw === null) return null;
  const parsed = daemonJsonSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function clearDaemonJson(paths: StatePaths): void {
  if (existsSync(paths.daemonJson)) rmSync(paths.daemonJson);
}

export type SessionIndex = Record<string, string>;

export function loadSessionIndex(paths: StatePaths): SessionIndex {
  return (readJsonOr(join(paths.chatSessionsDir, 'index.json')) as SessionIndex | null) ?? {};
}

export function saveSessionIndex(paths: StatePaths, index: SessionIndex): void {
  writePrivateFile(
    join(paths.chatSessionsDir, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  );
}

export function recordSession(paths: StatePaths, sessionId: string, sessionFile: string): void {
  const index = loadSessionIndex(paths);
  index[sessionId] = sessionFile;
  saveSessionIndex(paths, index);
}

export function resolveSessionFile(paths: StatePaths, sessionId: string): string | null {
  return loadSessionIndex(paths)[sessionId] ?? null;
}
