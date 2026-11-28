import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCESS_TOKEN_FILE_NAME,
  appBotIdentity,
  BRAND,
  CLAIM_POLL_INTERVAL_MS,
  CLAUDE_CONFIG_FILE_NAME,
  CLOUD_URL_ENV,
  ENV_VARS,
  formatAccessTokenFile,
  parseAccessTokenFile,
  TEAM_STREAM_PING_INTERVAL_MS,
} from '@cairn/shared';
import { isLoopbackHost } from '@cairn/shared/loopback';
import { z } from 'zod';
import { normalizePeerAddress } from './lib/request-origin.js';

const TSNET_HOSTNAME_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export const tsnetSettingsSchema = z.object({
  enabled: z.boolean(),
  binaryPath: z.string().min(1),
  hostname: z.string().regex(TSNET_HOSTNAME_PATTERN),
  uploadLogs: z.boolean(),
  controlUrl: z.string().url().nullable(),
});
export type TsnetSettings = z.infer<typeof tsnetSettingsSchema>;

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
      const loopbackHttp =
        url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return (
        (url.protocol === 'https:' || loopbackHttp) &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      );
    })
    .transform((value) => new URL(value).origin),
  cloudUrl: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      const loopbackHttp =
        url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return (
        (url.protocol === 'https:' || loopbackHttp) &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      );
    })
    .transform((value) => new URL(value).origin)
    .nullable()
    .default(null),
  apns: z.object({
    keyPath: z.string().nullable(),
    keyId: z.string().nullable(),
    teamId: z.string().nullable(),
    bundleId: z.string().min(1),
  }),
  pingIntervalMs: z.number().int().positive(),
  claimHoldMs: z.number().int().positive(),
  schedulerTickMs: z.number().int().positive(),
  webDir: z.string().nullable(),
  githubAppTokenSocket: z.string().min(1).nullable().default(null),
  cloudflareAccess: z
    .object({
      teamDomain: z.string().regex(/^[a-z0-9-]+\.cloudflareaccess\.com$/),
      aud: z.string().min(1),
      ownerEmails: z.array(z.string().email()).min(1),
    })
    .nullable()
    .default(null),
  clerkAuth: z
    .object({
      publishableKey: z.string().min(1),
      issuer: z
        .string()
        .url()
        .refine((value) => new URL(value).protocol === 'https:'),
      jwksUrl: z
        .string()
        .url()
        .refine((value) => new URL(value).protocol === 'https:'),
      ownerSubs: z.array(z.string().min(1)),
      ownerEmails: z.array(z.string().email()),
      authorizedParties: z.array(z.string().url()).default([]),
    })
    .refine((value) => value.ownerSubs.length > 0 || value.ownerEmails.length > 0)
    .nullable()
    .default(null),
  disableExternalConnectors: z.boolean().default(false),
  githubAppIdentity: z.object({ name: z.string(), email: z.string() }).nullable().default(null),
  githubOauth: z.object({ clientId: z.string(), clientSecret: z.string() }).nullable(),
  authToken: z.string().nullable(),
  requireToken: z.boolean(),
  authOff: z.boolean(),
  host: z.string().min(1),
  trustedProxies: z.array(z.string().min(1)).default([]),
  tsnet: tsnetSettingsSchema,
  mcpConfigPath: z.string(),
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

export function envStr(name: string): string | null {
  const raw = process.env[name];
  return raw !== undefined && raw !== '' ? raw : null;
}

const ACCESS_ENV = ['CAIRN_ACCESS_TEAM_DOMAIN', 'CAIRN_ACCESS_AUD', 'CAIRN_ACCESS_OWNER_EMAILS'];

function envCloudflareAccess(): { teamDomain: string; aud: string; ownerEmails: string[] } | null {
  const [teamDomain, aud, emails] = ACCESS_ENV.map(envStr);
  if (teamDomain == null && aud == null && emails == null) return null;
  const missing = ACCESS_ENV.filter((name) => envStr(name) === null);
  if (missing.length > 0 || teamDomain == null || aud == null || emails == null) {
    throw new Error(
      `Cloudflare Access identity needs all of ${ACCESS_ENV.join(', ')}; missing ${missing.join(', ')}`,
    );
  }
  return {
    teamDomain: teamDomain.trim().toLowerCase(),
    aud: aud.trim(),
    ownerEmails: emails
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email !== ''),
  };
}

function splitCsv(raw: string | null): string[] {
  if (raw === null) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function envTrustedProxies(): string[] {
  const entries = splitCsv(envStr('CAIRN_TRUSTED_PROXIES'));
  const normalized: string[] = [];
  for (const entry of entries) {
    const ip = normalizePeerAddress(entry);
    if (isIP(ip) === 0) {
      throw new Error(`CAIRN_TRUSTED_PROXIES contains an invalid IP address: "${entry}"`);
    }
    normalized.push(ip);
  }
  return normalized;
}

function envClerkAuth(explicitWebOrigin: string | null): {
  publishableKey: string;
  issuer: string;
  jwksUrl: string;
  ownerSubs: string[];
  ownerEmails: string[];
  authorizedParties: string[];
} | null {
  const publishableKey = envStr('CAIRN_CLERK_PUBLISHABLE_KEY');
  const rawIssuer = envStr('CAIRN_CLERK_ISSUER');
  const rawJwksUrl = envStr('CAIRN_CLERK_JWKS_URL');
  const rawSubs = envStr('CAIRN_CLERK_OWNER_SUBS');
  const rawEmails = envStr('CAIRN_CLERK_OWNER_EMAILS');
  const rawAuthorizedParties = envStr('CAIRN_CLERK_AUTHORIZED_PARTIES');
  if (
    publishableKey === null &&
    rawIssuer === null &&
    rawJwksUrl === null &&
    rawSubs === null &&
    rawEmails === null &&
    rawAuthorizedParties === null
  ) {
    return null;
  }
  const ownerSubs = splitCsv(rawSubs);
  const ownerEmails = splitCsv(rawEmails);
  const missing: string[] = [];
  if (publishableKey === null) missing.push('CAIRN_CLERK_PUBLISHABLE_KEY');
  if (rawIssuer === null) missing.push('CAIRN_CLERK_ISSUER');
  if (ownerSubs.length === 0 && ownerEmails.length === 0) {
    missing.push('CAIRN_CLERK_OWNER_SUBS or CAIRN_CLERK_OWNER_EMAILS');
  }
  if (missing.length > 0 || publishableKey === null || rawIssuer === null) {
    throw new Error(`Clerk auth needs ${missing.join(', ')}`);
  }
  const issuer = rawIssuer.trim().replace(/(?<!\/)\/+$/, '');
  const jwksUrl = rawJwksUrl === null ? `${issuer}/.well-known/jwks.json` : rawJwksUrl.trim();
  const explicitParties = splitCsv(rawAuthorizedParties).map((entry) =>
    entry.replace(/(?<!\/)\/+$/, ''),
  );
  const authorizedParties =
    explicitParties.length > 0
      ? explicitParties
      : explicitWebOrigin !== null
        ? [explicitWebOrigin.trim().replace(/(?<!\/)\/+$/, '')]
        : [];
  return {
    publishableKey: publishableKey.trim(),
    issuer,
    jwksUrl,
    ownerSubs,
    ownerEmails,
    authorizedParties,
  };
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const lower = raw.toLowerCase();
  return raw === '1' || lower === 'true' || lower === 'yes';
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TSNET_HOSTNAME = 'cairn';

const GOOS = process.platform === 'win32' ? 'windows' : process.platform;
const GOARCH = process.arch === 'x64' ? 'amd64' : process.arch;

function bundledTsnetBinaries(): string[] {
  const sidecar = process.platform === 'win32' ? 'tsnet-sidecar.exe' : 'tsnet-sidecar';
  const serverDir = resolve(fileURLToPath(import.meta.url), '..');
  const staged = `tsnet-sidecar-${GOOS}-${GOARCH}`;
  return [
    join(serverDir, '..', staged),
    join(serverDir, staged),
    join(serverDir, '..', sidecar),
    join(serverDir, sidecar),
  ];
}

function defaultTsnetBinaryPath(home: string): string {
  const fallback = join(
    home,
    'bin',
    process.platform === 'win32' ? 'tsnet-sidecar.exe' : 'tsnet-sidecar',
  );
  return (
    [...bundledTsnetBinaries(), fallback].find((candidate) => existsSync(candidate)) ?? fallback
  );
}

export { isLoopbackHost };

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

function envGithubAppIdentity(tokenSocket: string | null) {
  const slug = envStr('CAIRN_GITHUB_APP_SLUG');
  const botId = envStr('CAIRN_GITHUB_APP_BOT_ID');
  if (slug === null && botId === null) {
    if (tokenSocket !== null)
      throw new Error(
        'CAIRN_APP_TOKEN_SOCKET requires the App commit identity: set CAIRN_GITHUB_APP_SLUG and CAIRN_GITHUB_APP_BOT_ID',
      );
    return null;
  }
  if (slug === null || botId === null || !/^[1-9]\d*$/.test(botId))
    throw new Error(
      'App commit identity half-configured: set CAIRN_GITHUB_APP_SLUG and a numeric CAIRN_GITHUB_APP_BOT_ID, or neither',
    );
  return appBotIdentity(slug, Number(botId));
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const home = process.env[ENV_VARS.home] ?? join(homedir(), BRAND.homeDirName);
  const joinedDataDir = join(home, 'server');
  const dataDir = existsSync(joinedDataDir) ? realpathSync(joinedDataDir) : joinedDataDir;
  const skillsDirEnv = envStr(ENV_VARS.skillsDir);
  const skillsDir =
    skillsDirEnv === null ? resolve(home, 'skills') : resolve(expandHome(skillsDirEnv));
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
  const githubAppTokenSocket = envStr('CAIRN_APP_TOKEN_SOCKET');
  const explicitWebOrigin = envStr('CAIRN_WEB_ORIGIN');
  const rawCloudUrl = envStr(CLOUD_URL_ENV);
  const disabledCloudValues = new Set(['off', 'false', 'none', '0']);
  const explicitCloudUrl =
    rawCloudUrl === null || disabledCloudValues.has(rawCloudUrl.trim().toLowerCase())
      ? null
      : rawCloudUrl.trim();
  return serverConfigSchema.parse({
    port: envPort() ?? 8787,
    homeDir: home,
    dataDir,
    skillsDir,
    dbPath: join(dataDir, 'server.db'),
    keyfilePath: join(dataDir, 'secretbox.key'),
    vapidKeysPath: join(dataDir, 'vapid.json'),
    vapidSubject: envStr('CAIRN_VAPID_SUBJECT') ?? 'mailto:push@cairn.dev',
    webOrigin: explicitWebOrigin ?? 'https://cairn.local',
    cloudUrl: explicitCloudUrl,
    apns: {
      keyPath: envStr('CAIRN_APNS_KEY_PATH'),
      keyId: envStr('CAIRN_APNS_KEY_ID'),
      teamId: envStr('CAIRN_APNS_TEAM_ID'),
      bundleId: envStr('CAIRN_APNS_BUNDLE_ID') ?? 'dev.cairn.ios',
    },
    pingIntervalMs: TEAM_STREAM_PING_INTERVAL_MS,
    claimHoldMs: CLAIM_POLL_INTERVAL_MS,
    schedulerTickMs: 15_000,
    webDir: webDirEnv !== undefined && webDirEnv !== '' ? resolve(webDirEnv) : defaultWebDir(),
    githubAppTokenSocket,
    cloudflareAccess: envCloudflareAccess(),
    clerkAuth: envClerkAuth(explicitWebOrigin),
    disableExternalConnectors: envFlag('CAIRN_DISABLE_EXTERNAL_CONNECTORS'),
    githubAppIdentity: envGithubAppIdentity(githubAppTokenSocket),
    githubOauth:
      oauthId !== undefined && oauthSecret !== undefined
        ? { clientId: oauthId, clientSecret: oauthSecret }
        : null,
    authToken: envToken ?? fileToken,
    requireToken: envFlag(ENV_VARS.requireToken),
    authOff,
    host: envStr('HOST') ?? DEFAULT_HOST,
    trustedProxies: envTrustedProxies(),
    tsnet: {
      enabled: envFlag(ENV_VARS.tsnet),
      binaryPath: envStr(ENV_VARS.tsnetBinary) ?? defaultTsnetBinaryPath(home),
      hostname: envStr(ENV_VARS.tsnetHostname) ?? DEFAULT_TSNET_HOSTNAME,
      uploadLogs: envFlag(ENV_VARS.tsnetUploadLogs),
      controlUrl: envStr(ENV_VARS.tsnetControlUrl),
    },
    mcpConfigPath: resolve(
      process.env[ENV_VARS.mcpConfig] || join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
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
      `container mode (${ENV_VARS.requireToken}=1): the token value is never written to logs (hosted log dashboards are shared) — run \`${BRAND.cliCommandName} token\` on the host machine to see the current token`,
    ];
  }
  return [
    `token auth enabled — token source: ${source}; manage it with \`${BRAND.cliCommandName} token\` (\`${BRAND.cliCommandName} token --rotate\` writes a new one; restart the server to apply)`,
    `token auth enabled — run \`${BRAND.cliCommandName} token\` on this machine to print the owner token; other devices use a pairing code`,
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
