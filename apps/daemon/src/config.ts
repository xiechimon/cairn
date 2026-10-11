// Settings 缝（01 §3 五缝之一）的 daemon 最小层：优先级 = 显式入参 > env >
// 默认值（承旧 Settings 纪律；.env/配置文件层与 zod 全量 schema 随后续票）。
// env 词表 = ENV_VARS 五件（r3 §1.1 实测 TDS_*；品牌槽 brand.ts）。

import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  BRAND,
  CLAUDE_CONFIG_FILE_NAME,
  ENV_VARS,
  WORKSPACE_HOOK_TIMEOUT_MS,
  WORKSPACES_DIR_GUARD_CANON,
} from '@pacman/shared';
import { z } from 'zod';

export const daemonConfigSchema = z.object({
  serverUrl: z.string(),
  apiKey: z.string().optional(),
  teamId: z.string().optional(),
  /** --name 默认 hostname（r3 §1.1）。 */
  name: z.string(),
  /** PACMAN_HOME 默认 ~/.pacman（02 §5.3 布局根；r3 §1.1 实测原名 TDS_HOME）。 */
  home: z.string(),
  /** 持久工作区根（02 §5.5 baseRepo/任务目录的父层）。 */
  workspacesDir: z.string(),
  foreground: z.boolean(),
  /** skills 扫描根（spec 14/#371）：PACMAN_SKILLS_DIR 缺省 ~/.agents/skills；
   * 目录不存在 = 空 skills 集，非致命（扫描层降级，config 不校验存在性）。 */
  skillsDir: z.string(),
  /** 本机 MCP config（spec 13/#368）：claim slug 列表在此解析成执行端点。
   * 默认 ~/.claude.json；PACMAN_MCP_CONFIG 覆盖。执行机各读各机——stdio
   * 命令在真正的执行机上起，密钥值从不跨 wire。 */
  mcpConfigPath: z.string(),
  /** #1149 环境钩子超时 ms（缺省 WORKSPACE_HOOK_TIMEOUT_MS 20min；
   * PACMAN_HOOK_TIMEOUT_MS 覆写，非正整数 = 忽略用缺省）。 */
  hookTimeoutMs: z.number().int().positive(),
});
export type DaemonConfig = z.infer<typeof daemonConfigSchema>;

export interface DaemonConfigInput {
  serverUrl?: string;
  apiKey?: string;
  teamId?: string;
  name?: string;
  home?: string;
  workspacesDir?: string;
  foreground?: boolean;
  mcpConfigPath?: string;
  skillsDir?: string;
  /** #1149 环境钩子超时 ms 覆写（env PACMAN_HOOK_TIMEOUT_MS 同位）。 */
  hookTimeoutMs?: number;
}

/** 默认 server URL [设计]（官方默认不可观测——todos.dev 云常量；复刻
 * self-host 本机默认 = server 默认端口，01 §4.2）。 */
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

export class WorkspacesDirError extends Error {
  constructor(dir: string) {
    // 护栏 canon（r3 §1.1 help 原话语义，WORKSPACES_DIR_GUARD_CANON）：
    // 父目录必须已存在，防误落启动盘。
    super(`workspaces dir parent does not exist: ${dirname(dir)} (${WORKSPACES_DIR_GUARD_CANON})`);
    this.name = 'WorkspacesDirError';
  }
}

export function loadDaemonConfig(
  input: DaemonConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): DaemonConfig {
  const home = resolve(input.home ?? env[ENV_VARS.home] ?? join(homedir(), BRAND.homeDirName));
  const workspacesDir = resolve(
    input.workspacesDir ?? env[ENV_VARS.workspacesDir] ?? join(home, 'workspaces'),
  );
  // 显式/env 指定的 workspaces-dir：父目录必须已存在（一次性覆盖不持久，
  // r3 §1.1 TDS_WORKSPACES_DIR 语义）。
  const explicit = input.workspacesDir !== undefined || env[ENV_VARS.workspacesDir] !== undefined;
  if (explicit && !existsSync(dirname(workspacesDir))) {
    throw new WorkspacesDirError(workspacesDir);
  }
  const apiKey = input.apiKey ?? env[ENV_VARS.apiKey];
  const teamId = input.teamId ?? env[ENV_VARS.team];
  const serverUrl = input.serverUrl ?? env[ENV_VARS.server] ?? DEFAULT_SERVER_URL;
  // skills 扫描根（spec 14/#371）：默认 ~/.agents/skills 是跨工具 agents 目录
  // [设计]（非 BRAND 槽——pacman 与用户其它 agent 工具共享同一 skills 正本）。
  const skillsDir = resolve(
    input.skillsDir ?? env[ENV_VARS.skillsDir] ?? join(homedir(), '.agents', 'skills'),
  );
  // #1149 环境钩子超时（优先级同律：显式入参 > env > 默认 20min）。env 值
  // 非正整数 = 忽略（静默回缺省——config 层不抛，钩子超时不是启动护栏面）。
  const hookTimeoutRaw = input.hookTimeoutMs ?? env[ENV_VARS.hookTimeoutMs];
  const hookTimeoutParsed = Number(hookTimeoutRaw);
  const hookTimeoutMs =
    input.hookTimeoutMs ??
    (Number.isInteger(hookTimeoutParsed) && hookTimeoutParsed > 0
      ? hookTimeoutParsed
      : WORKSPACE_HOOK_TIMEOUT_MS);
  return daemonConfigSchema.parse({
    serverUrl: serverUrl.replace(/\/$/, ''),
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(teamId !== undefined ? { teamId } : {}),
    name: input.name ?? hostname(),
    home,
    workspacesDir,
    foreground: input.foreground ?? false,
    skillsDir,
    // Settings 缝优先级同律：显式入参 > env > 默认（~/.claude.json）。
    mcpConfigPath: resolve(
      input.mcpConfigPath ?? env[ENV_VARS.mcpConfig] ?? join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
    hookTimeoutMs,
  });
}
