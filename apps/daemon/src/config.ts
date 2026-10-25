import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  BRAND,
  CLAUDE_CONFIG_FILE_NAME,
  ENV_VARS,
  WORKSPACE_HOOK_TIMEOUT_MS,
  WORKSPACES_DIR_GUARD_CANON,
} from '@cairn/shared';
import { z } from 'zod';

export const daemonConfigSchema = z.object({
  serverUrl: z.string(),
  apiKey: z.string().optional(),
  teamId: z.string().optional(),
  name: z.string(),
  home: z.string(),
  workspacesDir: z.string(),
  foreground: z.boolean(),
  skillsDir: z.string(),
  mcpConfigPath: z.string(),
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
  hookTimeoutMs?: number;
}

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

export class WorkspacesDirError extends Error {
  constructor(dir: string) {
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
  const explicit = input.workspacesDir !== undefined || env[ENV_VARS.workspacesDir] !== undefined;
  if (explicit && !existsSync(dirname(workspacesDir))) {
    throw new WorkspacesDirError(workspacesDir);
  }
  const apiKey = input.apiKey ?? env[ENV_VARS.apiKey];
  const teamId = input.teamId ?? env[ENV_VARS.team];
  const serverUrl = input.serverUrl ?? env[ENV_VARS.server] ?? DEFAULT_SERVER_URL;
  const skillsDir = resolve(
    input.skillsDir ?? env[ENV_VARS.skillsDir] ?? join(homedir(), '.agents', 'skills'),
  );
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
    mcpConfigPath: resolve(
      input.mcpConfigPath ?? env[ENV_VARS.mcpConfig] ?? join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
    hookTimeoutMs,
  });
}
