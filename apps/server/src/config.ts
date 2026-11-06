import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCESS_TOKEN_FILE_NAME,
  BRAND,
  CLAIM_POLL_INTERVAL_MS,
  CLAUDE_CONFIG_FILE_NAME,
  ENV_VARS,
  formatAccessTokenFile,
  parseAccessTokenFile,
  routingRulesFlagOn,
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
  vapidKeysPath: z.string(),
  vapidSubject: z.string().refine((value) => {
    if (/^mailto:[^@\s]+@[^@\s]+$/.test(value)) return true;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }),
  webOrigin: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      );
    })
    .transform((value) => new URL(value).origin),
  pingIntervalMs: z.number().int().positive(),
  claimHoldMs: z.number().int().positive(),
  schedulerTickMs: z.number().int().positive(),
  webDir: z.string().nullable(),
  githubOauth: z.object({ clientId: z.string(), clientSecret: z.string() }).nullable(),
  authToken: z.string().nullable(),
  requireToken: z.boolean(),
  authOff: z.boolean(),
  host: z.string().min(1),
  mcpConfigPath: z.string(),
  issueIntake: z.boolean(),
  intakeAgentAllowlist: z.array(z.string()),
  scheduling: z.boolean(),
  coordinatorServerContext: z.boolean(),
  coordinatorMachineId: z.string().nullable(),
  routingRules: z.boolean(),
  trajectoryOutcomeBackfill: z.boolean(),
  trajectoryReflectCurate: z.boolean(),
  trajectoryReflectOpenGuardIssues: z.boolean(),
  researchIntakeProjectId: z.string().nullable(),
  pushDigestTimes: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
    .length(2)
    .refine((times) => times[0] !== times[1]),
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

const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK_BIND_HOSTS = new Set(['::1', '::ffff:127.0.0.1', 'localhost']);
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_BIND_HOSTS.has(host) || LOOPBACK_IPV4.test(host);
}

function envAuthOff(): boolean {
  const raw = envStr(ENV_VARS.auth);
  if (raw === null) return false;
  if (raw.toLowerCase() === 'off') return true;
  throw new Error(`${ENV_VARS.auth} accepts only "off" (got "${raw}") — unset it to keep auth on`);
}

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
  const joinedDataDir = join(home, 'server');
  const dataDir = existsSync(joinedDataDir) ? realpathSync(joinedDataDir) : joinedDataDir;
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
  const authOff = envAuthOff();
  const envToken = authOff ? null : envStr(ENV_VARS.token);
  let fileToken: string | null = null;
  if (!authOff && envToken === null) {
    const tokenPath = accessTokenFilePath(home);
    if (existsSync(tokenPath)) {
      const parsed = parseAccessTokenFile(readFileSync(tokenPath, 'utf8'));
      if (parsed === null) {
        throw new Error(
          `token file ${tokenPath} has no usable ${ENV_VARS.token} line — fix it or delete it to have a new token generated`,
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
    vapidKeysPath: join(dataDir, 'vapid.json'),
    vapidSubject: envStr('CAIRN_VAPID_SUBJECT') ?? 'mailto:push@cairn.dev',
    webOrigin: envStr('CAIRN_WEB_ORIGIN') ?? 'https://cairn.local',
    pingIntervalMs: TEAM_STREAM_PING_INTERVAL_MS,
    claimHoldMs: CLAIM_POLL_INTERVAL_MS,
    schedulerTickMs: 15_000,
    webDir: webDirEnv !== undefined && webDirEnv !== '' ? resolve(webDirEnv) : defaultWebDir(),
    githubOauth:
      oauthId !== undefined && oauthSecret !== undefined
        ? { clientId: oauthId, clientSecret: oauthSecret }
        : null,
    authToken: envToken ?? fileToken,
    requireToken: envFlag(ENV_VARS.requireToken),
    authOff,
    host: envStr('HOST') ?? DEFAULT_HOST,
    mcpConfigPath: resolve(
      process.env[ENV_VARS.mcpConfig] || join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
    issueIntake: envFlag(ENV_VARS.issueIntake),
    intakeAgentAllowlist: (process.env[ENV_VARS.intakeAgentAllowlist] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
    scheduling: envFlag(ENV_VARS.scheduling),
    coordinatorServerContext: envFlag(ENV_VARS.coordinatorServerContext),
    coordinatorMachineId: envStr(ENV_VARS.coordinatorMachineId),
    routingRules: routingRulesFlagOn(process.env[ENV_VARS.routingRules]),
    trajectoryOutcomeBackfill: envFlag(ENV_VARS.trajectoryOutcomeBackfill),
    trajectoryReflectCurate: envFlag(ENV_VARS.trajectoryReflectCurate),
    trajectoryReflectOpenGuardIssues: envFlag(ENV_VARS.trajectoryReflectOpenGuardIssues),
    researchIntakeProjectId: envStr(ENV_VARS.researchIntakeProjectId),
    pushDigestTimes: (() => {
      const raw = envStr('CAIRN_PUSH_DIGEST_TIMES');
      if (raw === null) return ['09:00', '18:00'];
      return raw.split(',').map((slot) => slot.trim());
    })(),
    ...overrides,
  });
}

export function insecureBindWarning(config: ServerConfig): string | null {
  if (config.authToken !== null) return null;
  if (!isLoopbackHost(config.host)) {
    return `bound to ${config.host} (reachable beyond this machine) with ${ENV_VARS.token} unset — the API is open to every network peer; set ${ENV_VARS.token}=<token> to require Bearer auth, or HOST=127.0.0.1 to keep it local`;
  }
  if (config.authOff) {
    return `${ENV_VARS.auth}=off — token auth is disabled, so every process on this machine and every web page open in a local browser can call the API; unset ${ENV_VARS.auth} to require the generated token`;
  }
  return null;
}

export function ignoredTailscaleUsersWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[ENV_VARS.tailscaleUsers];
  if (raw === undefined || raw.trim() === '') return null;
  return `${ENV_VARS.tailscaleUsers} is ignored — the Tailscale-User-Login header no longer grants access; sign in with ${ENV_VARS.token} (run \`${BRAND.cliCommandName} token\` on this machine to print it)`;
}

export function authOffRefusal(config: ServerConfig): string | null {
  if (!config.authOff) return null;
  if (!isLoopbackHost(config.host)) {
    return `${ENV_VARS.auth}=off is accepted only on a loopback bind but HOST=${config.host} — refusing to start; unset ${ENV_VARS.auth} and set ${ENV_VARS.token}=<long random string> (for example openssl rand -hex 32), or set HOST=127.0.0.1`;
  }
  if (config.requireToken) {
    return `${ENV_VARS.auth}=off contradicts ${ENV_VARS.requireToken} — refusing to start; unset one of them`;
  }
  return null;
}

export function missingRequiredTokenError(config: ServerConfig): string | null {
  if (config.authToken !== null || config.authOff) return null;
  if (config.requireToken) {
    return `${ENV_VARS.requireToken} is on but ${ENV_VARS.token} is unset or empty — refusing to start; set ${ENV_VARS.token}=<long random string> (for example openssl rand -hex 32) and restart`;
  }
  if (!isLoopbackHost(config.host)) {
    return `HOST=${config.host} is not loopback and no access token is configured — refusing to start; set ${ENV_VARS.token}=<long random string> (for example openssl rand -hex 32) or run \`${BRAND.cliCommandName} token --rotate\` to write ${accessTokenFilePath(config.homeDir)}, then restart`;
  }
  return null;
}

export function authStartupRefusal(config: ServerConfig): string | null {
  return authOffRefusal(config) ?? missingRequiredTokenError(config);
}

export function ensureAccessToken(config: ServerConfig): ServerConfig {
  if (config.authToken !== null || config.authOff || config.requireToken) return config;
  if (!isLoopbackHost(config.host)) return config;
  const tokenPath = accessTokenFilePath(config.homeDir);
  const generated = randomBytes(32).toString('hex');
  mkdirSync(config.homeDir, { recursive: true });
  try {
    writeFileSync(tokenPath, formatAccessTokenFile(generated), { mode: 0o600, flag: 'wx' });
    return { ...config, authToken: generated };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stored = parseAccessTokenFile(readFileSync(tokenPath, 'utf8'));
  if (stored === null) {
    throw new Error(
      `token file ${tokenPath} has no usable ${ENV_VARS.token} line — fix it or delete it to have a new token generated`,
    );
  }
  return { ...config, authToken: stored };
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
    host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
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

export function warnIgnoredTailscaleUsers(logger: { warn(msg: string): void }): void {
  const message = ignoredTailscaleUsersWarning();
  if (message !== null) logger.warn(message);
}

export function reposDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'repos');
}

export function backupStatusPathOf(config: Pick<ServerConfig, 'dbPath'>): string {
  return join(dirname(config.dbPath), 'backup-status.json');
}

export function deployRecordPathOf(config: Pick<ServerConfig, 'dbPath'>): string {
  return join(dirname(config.dbPath), 'deploy.json');
}

export function attachmentsDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'attachments');
}
