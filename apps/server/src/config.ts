import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCESS_TOKEN_FILE_NAME,
  BRAND,
  CLAIM_POLL_INTERVAL_MS,
  CLAUDE_CONFIG_FILE_NAME,
  ENV_VARS,
  parseAccessTokenFile,
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
  tailscaleUsers: z.array(z.string()),
  requireToken: z.boolean(),
  host: z.string().nullable(),
  mcpConfigPath: z.string(),
  issueIntake: z.boolean(),
  trajectoryOutcomeBackfill: z.boolean(),
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

export function accessTokenFilePath(homeDir: string): string {
  return join(homeDir, ACCESS_TOKEN_FILE_NAME);
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
      `oauth client half-configured: set both ${ENV_VARS.githubOauthClientId} and ${ENV_VARS.githubOauthClientSecret}, or neither`,
    );
  }
  const envToken = envStr(ENV_VARS.token);
  let fileToken: string | null = null;
  if (envToken === null) {
    const tokenPath = accessTokenFilePath(home);
    if (existsSync(tokenPath)) {
      const parsed = parseAccessTokenFile(readFileSync(tokenPath, 'utf8'));
      if (parsed === null) {
        throw new Error(
          `token file ${tokenPath} has no usable ${ENV_VARS.token} line — fix or delete it (deleting turns auth off)`,
        );
      }
      fileToken = parsed;
    }
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
    authToken: envToken ?? fileToken,
    tailscaleUsers: (process.env[ENV_VARS.tailscaleUsers] ?? '')
      .split(',')
      .map((login) => login.trim())
      .filter((login) => login !== ''),
    requireToken: envFlag(ENV_VARS.requireToken),
    host: envStr('HOST'),
    mcpConfigPath: resolve(
      process.env[ENV_VARS.mcpConfig] || join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
    issueIntake: envFlag(ENV_VARS.issueIntake),
    trajectoryOutcomeBackfill: envFlag(ENV_VARS.trajectoryOutcomeBackfill),
    ...overrides,
  });
}

export function insecureBindWarning(config: ServerConfig): string | null {
  if (config.authToken !== null) return null;
  if (config.host === null || !ANY_INTERFACE_HOSTS.has(config.host)) return null;
  return `bound to ${config.host} (reachable on every interface) with ${ENV_VARS.token} unset — the API is open to all interfaces; set ${ENV_VARS.token}=<token> to require Bearer auth, or HOST=127.0.0.1 to keep it local`;
}

const LOOPBACK_BIND_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export function tailscaleBindWarning(config: ServerConfig): string | null {
  if (config.tailscaleUsers.length === 0) return null;
  if (config.host !== null && LOOPBACK_BIND_HOSTS.has(config.host)) return null;
  return `${ENV_VARS.tailscaleUsers} is set but HOST=${config.host ?? 'all interfaces'} is not loopback-only; set HOST=127.0.0.1 and proxy tailscale serve to http://127.0.0.1:${config.port}. Identity headers from non-loopback peers are ignored`;
}

export function missingRequiredTokenError(config: ServerConfig): string | null {
  if (!config.requireToken || config.authToken !== null) return null;
  return `${ENV_VARS.requireToken} is on but ${ENV_VARS.token} is unset or empty — refusing to start; set ${ENV_VARS.token}=<long random string> (for example openssl rand -hex 32) and restart`;
}

export function tokenAuthStartupLines(config: ServerConfig): string[] {
  if (config.authToken === null) return [];
  const source =
    envStr(ENV_VARS.token) !== null
      ? `${ENV_VARS.token} environment variable`
      : `token file ${accessTokenFilePath(config.homeDir)}`;
  if (config.requireToken) {
    return [
      `token auth enabled — token source: ${source}; manage it with \`${BRAND.cliCommandName} token\` (\`${BRAND.cliCommandName} token --rotate\` writes a new one; restart the server to apply)`,
      `container mode (${ENV_VARS.requireToken}=1): the token value and one-time login link are never written to logs (hosted log dashboards are shared) — run \`${BRAND.cliCommandName} token\` on the host machine to see the current token`,
    ];
  }
  const host = config.host;
  const display =
    host === null || host === '0.0.0.0' || host === '::'
      ? 'localhost'
      : host.includes(':')
        ? `[${host}]`
        : host;
  return [
    `token auth enabled — token source: ${source}; manage it with \`${BRAND.cliCommandName} token\` (\`${BRAND.cliCommandName} token --rotate\` writes a new one; restart the server to apply)`,
    `one-time login link: http://${display}:${config.port}/app#token=${config.authToken}`,
  ];
}

export function logTokenAuthStartup(
  logger: { info(msg: string): void },
  config: ServerConfig,
): void {
  for (const line of tokenAuthStartupLines(config)) logger.info(line);
}

export function warnInsecureBind(logger: { warn(msg: string): void }, config: ServerConfig): void {
  const message = insecureBindWarning(config);
  if (message !== null) logger.warn(message);
}

export function warnTailscaleBind(logger: { warn(msg: string): void }, config: ServerConfig): void {
  const message = tailscaleBindWarning(config);
  if (message !== null) logger.warn(message);
}

export function reposDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'repos');
}

export function attachmentsDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'attachments');
}
