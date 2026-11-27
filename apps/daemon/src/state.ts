import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DaemonJson,
  type DeviceJson,
  daemonJsonSchema,
  deviceJsonSchema,
  MACHINE_TOKEN_PATTERN,
  type MachineJson,
  type ModelSourceModel,
  machineJsonSchema,
  modelSourceModelSchema,
} from '@cairn/shared';
import { z } from 'zod';
import { ensurePrivateDir, sweepStalePrivateTemps, writePrivateFile } from './private-fs.js';

export interface StatePaths {
  home: string;
  machineJson: string;
  pendingTokenRotationJson: string;
  deviceJson: string;
  daemonJson: string;
  daemonLog: string;
  devinModelsJson: string;
  outboxDir: string;
  chatSessionsDir: string;
  agentRuntimeDir: string;
  workspacesDir: string;
  teamSkillsCacheDir: string;
  stepAttachmentsDir: string;
  plansDir: string;
  credsDir: string;
}

export function statePaths(home: string, workspacesDir?: string): StatePaths {
  return {
    home,
    machineJson: join(home, 'machine.json'),
    pendingTokenRotationJson: join(home, 'pending-token-rotation.json'),
    deviceJson: join(home, 'device.json'),
    daemonJson: join(home, 'daemon.json'),
    daemonLog: join(home, 'daemon.log'),
    devinModelsJson: join(home, 'devin-models.json'),
    outboxDir: join(home, 'outbox'),
    chatSessionsDir: join(home, 'chat-sessions'),
    agentRuntimeDir: join(home, 'homes', 'pi'),
    workspacesDir: workspacesDir ?? join(home, 'workspaces'),
    teamSkillsCacheDir: join(home, 'team-skills'),
    stepAttachmentsDir: join(home, 'step-attachments'),
    plansDir: join(home, 'plans'),
    credsDir: join(home, 'creds'),
  };
}

export function ensureStateDirs(paths: StatePaths): void {
  for (const dir of [
    paths.home,
    paths.outboxDir,
    paths.chatSessionsDir,
    paths.agentRuntimeDir,
    paths.workspacesDir,
    paths.credsDir,
  ]) {
    ensurePrivateDir(dir);
    sweepStalePrivateTemps(dir);
  }
  writePrivateFile(
    join(paths.home, 'workspace-root.json'),
    `${JSON.stringify({ workspacesDir: paths.workspacesDir })}\n`,
  );
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

const pendingTokenRotationSchema = z.object({
  rotationId: z.string().min(1),
  token: z.string().regex(MACHINE_TOKEN_PATTERN),
});
export type PendingTokenRotation = z.infer<typeof pendingTokenRotationSchema>;

export function loadPendingTokenRotation(paths: StatePaths): PendingTokenRotation | null {
  const raw = readJsonOr(paths.pendingTokenRotationJson);
  if (raw === null) return null;
  const parsed = pendingTokenRotationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function savePendingTokenRotation(paths: StatePaths, value: PendingTokenRotation): void {
  pendingTokenRotationSchema.parse(value);
  writePrivateFile(paths.pendingTokenRotationJson, `${JSON.stringify(value, null, 2)}\n`);
}

export function clearPendingTokenRotation(paths: StatePaths): void {
  if (existsSync(paths.pendingTokenRotationJson)) rmSync(paths.pendingTokenRotationJson);
}

export function forgetMachine(paths: StatePaths): boolean {
  clearPendingTokenRotation(paths);
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

const devinModelsFileSchema = z.object({ models: z.array(modelSourceModelSchema) });

export function loadDevinModels(paths: StatePaths): ModelSourceModel[] {
  const raw = readJsonOr(paths.devinModelsJson);
  if (raw === null) return [];
  const parsed = devinModelsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data.models : [];
}

export function saveDevinModels(paths: StatePaths, models: ModelSourceModel[]): void {
  const value = devinModelsFileSchema.parse({ models });
  writePrivateFile(paths.devinModelsJson, `${JSON.stringify(value, null, 2)}\n`);
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
