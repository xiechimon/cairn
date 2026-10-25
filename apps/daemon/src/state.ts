// 本地状态布局（02 §5.3/r3 §1.3 实测形状；目录名品牌槽 brand.ts）：
// machine.json / device.json / daemon.json / daemon.log / outbox/ /
// chat-sessions/ / agent-runtime/ / workspaces/。
// zod 形状单源 = shared machineJsonSchema/deviceJsonSchema/daemonJsonSchema。

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DaemonJson,
  type DeviceJson,
  daemonJsonSchema,
  deviceJsonSchema,
  type MachineJson,
  machineJsonSchema,
} from '@cairn/shared';

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
  /** 团队技能物化缓存根（XMON-112 S2，spec 14）：内容寻址目录，
   * team-skills.ts 首用即建（不常驻空目录）。 */
  teamSkillsCacheDir: string;
  /** 步图片附件素材化根（#730）：worktree **外**的 CAIRN_HOME 面目录
   * （`<home>/step-attachments/<stepId>/`）——素材落这里保证步后
   * git status clean（构造性，票面失败方式 1）；resolver 首用即建。 */
  stepAttachmentsDir: string;
  /** plan 步交接物根（#1203）：`<home>/plans/<conversationId>/plan.md`——
   *  同 step-attachments 的「worktree 外 CAIRN_HOME 面目录」律：local-repo
   *  项目的 conv 工作区即 repo checkout，plan.md 落工作区根会被 agent 提交
   *  进仓库根。runner 组装交接位置注记行时首用即建。 */
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
    mkdirSync(dir, { recursive: true });
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
  writeFileSync(paths.machineJson, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** logout 只 Forget 本机；服务端机器记录保留（02 §5.2/r3 §1.2 实测）。 */
export function forgetMachine(paths: StatePaths): boolean {
  if (!existsSync(paths.machineJson)) return false;
  rmSync(paths.machineJson);
  return true;
}

/** device.json：跨机器实例的设备指纹 32hex（r3 §1.3）；不存在即生成。 */
export function loadOrCreateDeviceJson(paths: StatePaths): DeviceJson {
  const existing = readJsonOr(paths.deviceJson);
  const parsed = existing === null ? null : deviceJsonSchema.safeParse(existing);
  if (parsed?.success) return parsed.data;
  const fresh: DeviceJson = { deviceId: randomBytes(16).toString('hex') };
  writeFileSync(paths.deviceJson, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
  return fresh;
}

export function writeDaemonJson(paths: StatePaths, value: DaemonJson): void {
  daemonJsonSchema.parse(value);
  writeFileSync(paths.daemonJson, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

/** chat-sessions 索引：pi sessionId → sessionFile（continueSession 解析键，
 * 会话持久化索引宿主自持 [设计]，00/D3 durable 语义）。 */
export type SessionIndex = Record<string, string>;

export function loadSessionIndex(paths: StatePaths): SessionIndex {
  return (readJsonOr(join(paths.chatSessionsDir, 'index.json')) as SessionIndex | null) ?? {};
}

export function saveSessionIndex(paths: StatePaths, index: SessionIndex): void {
  writeFileSync(
    join(paths.chatSessionsDir, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
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
