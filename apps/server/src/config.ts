import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAND,
  CLAIM_POLL_INTERVAL_MS,
  CLAUDE_CONFIG_FILE_NAME,
  ENV_VARS,
  SKILLS_DIR_DEFAULT,
  TEAM_STREAM_PING_INTERVAL_MS,
} from '@cairn/shared';
import { z } from 'zod';

export const serverConfigSchema = z.object({
  port: z.number().int().min(0).max(65535),
  homeDir: z.string(),
  dataDir: z.string(),
  skillsDir: z.string(),
  dbPath: z.string(),
  keyfilePath: z.string(),
  pingIntervalMs: z.number().int().positive(),
  claimHoldMs: z.number().int().positive(),
  schedulerTickMs: z.number().int().positive(),
  webDir: z.string().nullable(),
  githubOauth: z.object({ clientId: z.string(), clientSecret: z.string() }).nullable(),
  authToken: z.string().nullable(),
  requireToken: z.boolean(),
  host: z.string().nullable(),
  mcpConfigPath: z.string(),
  issueIntake: z.boolean(),
});
export type ServerConfig = z.infer<typeof serverConfigSchema>;

function envPort(): number | undefined {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

function envStr(name: string): string | null {
  const raw = process.env[name];
  return raw !== undefined && raw !== '' ? raw : null;
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const lower = raw.toLowerCase();
  return raw === '1' || lower === 'true' || lower === 'yes';
}

const ANY_INTERFACE_HOSTS = new Set(['0.0.0.0', '::', '::0']);

function defaultWebDir(): string | null {
  const here = resolve(fileURLToPath(import.meta.url), '../..');
  const candidates = [join(here, '..', 'web', 'dist'), join(here, 'web')];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return resolve(candidate);
  }
  return null;
}

function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const home = process.env[ENV_VARS.home] ?? join(homedir(), BRAND.homeDirName);
  const dataDir = join(home, 'server');
  const skillsDirEnv = envStr(ENV_VARS.skillsDir);
  const skillsDir = resolve(expandHome(skillsDirEnv ?? SKILLS_DIR_DEFAULT));
  const webDirEnv = process.env[ENV_VARS.webDir];
  const oauthId = process.env[ENV_VARS.githubOauthClientId] || undefined;
  const oauthSecret = process.env[ENV_VARS.githubOauthClientSecret] || undefined;
  if ((oauthId === undefined) !== (oauthSecret === undefined)) {
    throw new Error(
      `oauth client half-configured: ${ENV_VARS.githubOauthClientId} 与 ${ENV_VARS.githubOauthClientSecret} 必须同设`,
    );
  }
  return serverConfigSchema.parse({
    port: envPort() ?? 8787,
    homeDir: home,
    dataDir,
    skillsDir,
    dbPath: join(dataDir, 'server.db'),
    keyfilePath: join(dataDir, 'secretbox.key'),
    pingIntervalMs: TEAM_STREAM_PING_INTERVAL_MS,
    claimHoldMs: CLAIM_POLL_INTERVAL_MS,
    schedulerTickMs: 15_000,
    webDir: webDirEnv !== undefined && webDirEnv !== '' ? resolve(webDirEnv) : defaultWebDir(),
    githubOauth:
      oauthId !== undefined && oauthSecret !== undefined
        ? { clientId: oauthId, clientSecret: oauthSecret }
        : null,
    authToken: envStr(ENV_VARS.token),
    requireToken: envFlag(ENV_VARS.requireToken),
    host: envStr('HOST'),
    mcpConfigPath: resolve(
      process.env[ENV_VARS.mcpConfig] || join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
    issueIntake: envFlag(ENV_VARS.issueIntake),
    ...overrides,
  });
}

export function insecureBindWarning(config: ServerConfig): string | null {
  if (config.authToken !== null) return null;
  if (config.host === null || !ANY_INTERFACE_HOSTS.has(config.host)) return null;
  return `绑定 ${config.host}（全网卡可达）且 ${ENV_VARS.token} 未设——API 面裸奔于所有网络接口；设 ${ENV_VARS.token}=<token> 开启 Bearer 鉴权，或 HOST=127.0.0.1 收回本机`;
}

export function missingRequiredTokenError(config: ServerConfig): string | null {
  if (!config.requireToken || config.authToken !== null) return null;
  return `${ENV_VARS.requireToken} 已开但 ${ENV_VARS.token} 未设或为空——拒绝启动；设 ${ENV_VARS.token}=<随机长串>（例如 openssl rand -hex 32）后重启`;
}

export function warnInsecureBind(logger: { warn(msg: string): void }, config: ServerConfig): void {
  const message = insecureBindWarning(config);
  if (message !== null) logger.warn(message);
}

export function reposDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'repos');
}

export function attachmentsDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'attachments');
}
