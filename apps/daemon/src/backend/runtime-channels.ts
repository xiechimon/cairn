import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BRAND } from '@cairn/shared';
import { unsafeManagedVersion } from '@cairn/shared/managed-bin';
import { z } from 'zod';
import { childEnv } from '../child-env.js';
import { contains } from './confine.js';
import {
  createManagedRuntime,
  type ManagedRuntime,
  type ManagedRuntimeChannel,
  type ManagedRuntimeChannelContext,
  type ManagedRuntimeOptions,
  type ManagedRuntimeRelease,
  type ManagedRuntimeValidationResult,
} from './managed-runtime.js';

const exec = promisify(execFile);

const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const VALIDATE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_VERSION_LENGTH = 64;
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;
const SAFE_BINARY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CLAUDE_RELEASES_BASE_URL = 'https://downloads.claude.ai/claude-code-releases';
const DEVIN_MANIFEST_URL = 'https://static.devin.ai/cli/current/manifest.json';
const DEVIN_ARCHIVE_HOST = 'static.devin.ai';
const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const GEMINI_NPM_PACKAGE = '@google/gemini-cli';
const GEMINI_ACP_ARGS = ['--acp'] as const;

function parseReportedVersion(stdout: string): string | null {
  const match = VERSION_PATTERN.exec(stdout);
  return match ? match[0] : null;
}

function isValidReleaseVersion(version: string): boolean {
  return (
    version.length <= MAX_VERSION_LENGTH &&
    !unsafeManagedVersion(version) &&
    parseReportedVersion(version) === version
  );
}

function trustedHttpsUrl(url: string, host?: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return host === undefined || parsed.hostname === host;
  } catch {
    return false;
  }
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader !== null) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`response exceeds ${maxBytes} byte limit`);
    }
  }
  if (response.body === null) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error(`response exceeds ${maxBytes} byte limit`);
    return buf;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
  opts: { timeoutMs: number; allowedHost?: string; maxBytes: number },
): Promise<{ status: number; ok: boolean; bytes: Buffer }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!trustedHttpsUrl(current, opts.allowedHost)) {
      throw new Error(`untrusted url: ${current}`);
    }
    const response = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (response.url !== '' && !trustedHttpsUrl(response.url, opts.allowedHost)) {
      throw new Error(`untrusted redirect destination: ${response.url}`);
    }
    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      const location = response.headers.get('location');
      if (location === null) throw new Error(`redirect without location: HTTP ${response.status}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      return { status: response.status, ok: false, bytes: Buffer.alloc(0) };
    }
    const bytes = await readBoundedBytes(response, opts.maxBytes);
    return { status: response.status, ok: true, bytes };
  }
  throw new Error('too many redirects');
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  allowedHost?: string,
): Promise<unknown | null> {
  try {
    const res = await safeFetch(fetchImpl, url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...(allowedHost !== undefined ? { allowedHost } : {}),
      maxBytes: MAX_METADATA_BYTES,
    });
    if (!res.ok) return null;
    return parseJson(res.bytes.toString('utf8'));
  } catch {
    return null;
  }
}

async function fetchCachedText(
  ctx: ManagedRuntimeChannelContext,
  url: string,
  cacheName: string,
  useCache: boolean,
  allowedHost?: string,
): Promise<string | null> {
  try {
    const res = await safeFetch(ctx.fetchImpl, url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...(allowedHost !== undefined ? { allowedHost } : {}),
      maxBytes: MAX_METADATA_BYTES,
    });
    if (!res.ok) throw new Error(`${cacheName} HTTP ${res.status}`);
    const text = res.bytes.toString('utf8');
    mkdirSync(ctx.root, { recursive: true });
    writeFileSync(join(ctx.root, cacheName), text);
    return text;
  } catch {
    if (!useCache) return null;
    try {
      return readFileSync(join(ctx.root, cacheName), 'utf8');
    } catch {
      return null;
    }
  }
}

async function runVersionValidation(
  command: string,
  args: readonly string[],
  expectedVersion: string,
): Promise<ManagedRuntimeValidationResult> {
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-rt-validate-'));
  try {
    const env = childEnv({
      HOME: scratch,
      XDG_CONFIG_HOME: join(scratch, 'config'),
      XDG_DATA_HOME: join(scratch, 'data'),
      XDG_CACHE_HOME: join(scratch, 'cache'),
      XDG_STATE_HOME: join(scratch, 'state'),
      CLAUDE_CONFIG_DIR: join(scratch, 'claude'),
      GEMINI_CLI_HOME: join(scratch, 'gemini'),
      SSH_AUTH_SOCK: '',
      SSH_AGENT_PID: '',
      OTEL_SDK_DISABLED: 'true',
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    });
    const { stdout } = await exec(command, [...args], {
      timeout: VALIDATE_TIMEOUT_MS,
      encoding: 'utf8',
      env,
    });
    const reported = parseReportedVersion(stdout);
    if (reported === null) {
      return { ok: false, reason: 'version check returned no version string' };
    }
    if (reported !== expectedVersion) {
      return {
        ok: false,
        reason: `version check reported ${reported}, expected ${expectedVersion}`,
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `version check failed: ${message}` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function isMuslLinux(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function claudePlatformKey(platform: string, arch: string, musl: boolean): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `darwin-${arch}`;
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
    return musl ? `linux-${arch}-musl` : `linux-${arch}`;
  }
  if (platform === 'win32' && (arch === 'arm64' || arch === 'x64')) return `win32-${arch}`;
  return null;
}

const claudeManifestSchema = z.object({
  version: z.string(),
  platforms: z.record(
    z.string(),
    z.object({
      binary: z.string().regex(SAFE_BINARY_NAME),
      checksum: z.string().regex(/^[a-f0-9]{64}$/i),
      size: z.number().int().positive().max(MAX_DOWNLOAD_BYTES).optional(),
    }),
  ),
});

interface ClaudeRelease extends ManagedRuntimeRelease {
  binary: string;
  checksum: string;
  size?: number;
}

export interface ClaudeManagedOptions extends Omit<ManagedRuntimeOptions, 'root'> {
  root?: string;
  platform?: string;
  arch?: string;
  musl?: boolean;
  releaseBaseUrl?: string;
}

export function claudeInstallRoot(cairnHome: string): string {
  return join(cairnHome, 'tools', 'claude');
}

export function createClaudeManaged(options: ClaudeManagedOptions = {}): ManagedRuntime {
  const root = options.root ?? claudeInstallRoot(join(homedir(), BRAND.homeDirName));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const musl = options.musl ?? (options.platform === undefined ? isMuslLinux() : false);
  const releaseBaseUrl = (options.releaseBaseUrl ?? CLAUDE_RELEASES_BASE_URL).replace(/\/+$/, '');
  const trustedHost = hostOf(releaseBaseUrl);

  const channel: ManagedRuntimeChannel<ClaudeRelease> = {
    id: 'claude-code',
    defaultArgs: [],
    async resolveRelease(ctx) {
      const key = claudePlatformKey(platform, arch, musl);
      if (key === null || trustedHost === null) return null;
      let latestText: string;
      try {
        const res = await safeFetch(ctx.fetchImpl, `${releaseBaseUrl}/latest`, {
          timeoutMs: FETCH_TIMEOUT_MS,
          allowedHost: trustedHost,
          maxBytes: MAX_METADATA_BYTES,
        });
        if (!res.ok) return null;
        latestText = res.bytes.toString('utf8').trim();
      } catch {
        return null;
      }
      if (!isValidReleaseVersion(latestText)) {
        ctx.log(`claude-code release channel returned invalid version: ${latestText}`);
        return null;
      }
      const rawManifest = await fetchJson(
        ctx.fetchImpl,
        `${releaseBaseUrl}/${latestText}/manifest.json`,
        trustedHost,
      );
      const parsed = claudeManifestSchema.safeParse(rawManifest);
      if (!parsed.success) {
        ctx.log('claude-code manifest did not match the expected shape');
        return null;
      }
      if (parsed.data.version !== latestText) {
        ctx.log(`claude-code manifest version ${parsed.data.version} did not match ${latestText}`);
        return null;
      }
      const entry = parsed.data.platforms[key];
      if (entry === undefined) {
        ctx.log(`claude-code manifest has no binary for ${key}`);
        return null;
      }
      const url = `${releaseBaseUrl}/${latestText}/${key}/${entry.binary}`;
      if (!trustedHttpsUrl(url, trustedHost)) return null;
      return {
        version: latestText,
        url,
        binary: entry.binary,
        checksum: entry.checksum.toLowerCase(),
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      };
    },
    async stage(release, stagingDir, ctx) {
      if (trustedHost === null) throw new Error('claude-code release host is untrusted');
      const response = await safeFetch(ctx.fetchImpl, release.url, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        allowedHost: trustedHost,
        maxBytes: release.size ?? MAX_DOWNLOAD_BYTES,
      });
      if (!response.ok) throw new Error(`claude-code download: HTTP ${response.status}`);
      const bytes = response.bytes;
      if (release.size !== undefined && bytes.byteLength !== release.size) {
        throw new Error('claude-code binary size mismatch');
      }
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== release.checksum) {
        throw new Error('claude-code binary checksum mismatch');
      }
      const target = join(stagingDir, release.binary);
      writeFileSync(target, bytes, { mode: 0o755 });
      chmodSync(target, 0o755);
      return {
        binRelPath: release.binary,
        args: [],
        archiveSha256: digest,
      };
    },
    launchFor(binPath, args) {
      return { command: binPath, args: [...args] };
    },
    validate(staged) {
      return runVersionValidation(staged.binPath, ['--version'], staged.version);
    },
  };

  return createManagedRuntime(channel, { ...options, root });
}

const devinManifestSchema = z.object({
  version: z.string(),
  platforms: z.record(
    z.string(),
    z.object({
      url: z.string().url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    }),
  ),
});

const DEVIN_MANIFEST_TARGETS: Record<string, string> = {
  'darwin-aarch64': 'aarch64-apple-darwin',
  'darwin-x86_64': 'x86_64-apple-darwin',
  'linux-aarch64': 'aarch64-unknown-linux',
  'linux-x86_64': 'x86_64-unknown-linux',
};

function devinPlatformTarget(platform: string, arch: string): string | null {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  if (os === null || cpu === null) return null;
  return DEVIN_MANIFEST_TARGETS[`${os}-${cpu}`] ?? null;
}

interface DevinRelease extends ManagedRuntimeRelease {
  archiveSha256: string;
}

export interface DevinManagedOptions extends Omit<ManagedRuntimeOptions, 'root'> {
  root?: string;
  platform?: string;
  arch?: string;
  manifestUrl?: string;
  archiveHost?: string;
}

export function devinInstallRoot(cairnHome: string): string {
  return join(cairnHome, 'tools', 'devin');
}

export function createDevinManaged(options: DevinManagedOptions = {}): ManagedRuntime {
  const root = options.root ?? devinInstallRoot(join(homedir(), BRAND.homeDirName));
  const home = options.home ?? join(root, 'home');
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const manifestUrl = options.manifestUrl ?? DEVIN_MANIFEST_URL;
  const archiveHost = options.archiveHost ?? DEVIN_ARCHIVE_HOST;
  const manifestHost = hostOf(manifestUrl);

  const channel: ManagedRuntimeChannel<DevinRelease> = {
    id: 'devin',
    defaultArgs: ['acp'],
    async resolveRelease(ctx, opts) {
      const target = devinPlatformTarget(platform, arch);
      if (target === null || manifestHost === null) return null;
      const body = await fetchCachedText(
        ctx,
        manifestUrl,
        'manifest-cache.json',
        opts?.useCache ?? true,
        manifestHost,
      );
      if (body === null) return null;
      const parsed = devinManifestSchema.safeParse(parseJson(body));
      if (!parsed.success) {
        ctx.log('devin manifest did not match the expected shape');
        return null;
      }
      const entry = parsed.data.platforms[target];
      if (entry === undefined) {
        ctx.log(`devin manifest has no archive for ${target}`);
        return null;
      }
      if (!isValidReleaseVersion(parsed.data.version)) {
        ctx.log(`devin manifest has an unsafe version: ${parsed.data.version}`);
        return null;
      }
      if (!trustedHttpsUrl(entry.url, archiveHost)) {
        ctx.log(`devin manifest archive url is untrusted: ${entry.url}`);
        return null;
      }
      return {
        version: parsed.data.version,
        url: entry.url,
        archiveSha256: entry.sha256.toLowerCase(),
      };
    },
    async stage(release, stagingDir, ctx) {
      const response = await safeFetch(ctx.fetchImpl, release.url, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        allowedHost: archiveHost,
        maxBytes: MAX_DOWNLOAD_BYTES,
      });
      if (!response.ok) throw new Error(`devin download: HTTP ${response.status}`);
      const bytes = response.bytes;
      const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
      if (archiveSha256 !== release.archiveSha256) {
        throw new Error('devin archive checksum mismatch');
      }
      const tarball = join(stagingDir, 'devin.tar.gz');
      writeFileSync(tarball, bytes);
      await exec('tar', ['-xzf', tarball, '-C', stagingDir], { timeout: 60_000 });
      rmSync(tarball, { force: true });
      let binPath = join(stagingDir, 'bin', 'devin');
      if (!existsSync(binPath)) {
        const tops = readdirSync(stagingDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
        const top = tops[0];
        if (tops.length !== 1 || top === undefined) {
          throw new Error('devin archive layout unrecognized');
        }
        binPath = join(stagingDir, top, 'bin', 'devin');
        if (!existsSync(binPath)) throw new Error('devin archive has no binary');
      }
      if (!lstatSync(binPath).isFile()) throw new Error('devin archive binary is not a file');
      if (!contains(realpathSync(stagingDir), realpathSync(binPath))) {
        throw new Error('devin archive binary escapes the archive');
      }
      chmodSync(binPath, 0o755);
      return {
        binRelPath: binPath.slice(stagingDir.length + 1),
        args: ['acp'],
        archiveSha256,
      };
    },
    launchFor(binPath, args) {
      return { command: binPath, args: [...args] };
    },
    validate(staged) {
      return runVersionValidation(staged.binPath, ['--version'], staged.version);
    },
  };

  return createManagedRuntime(channel, { ...options, root, home });
}

const acpRegistrySchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      distribution: z
        .object({
          npx: z.object({ package: z.string(), args: z.array(z.string()).default([]) }).optional(),
        })
        .optional(),
    }),
  ),
});

const npmDistSchema = z.object({
  dist: z.object({
    tarball: z
      .string()
      .url()
      .refine((url) => url.startsWith('https://')),
    shasum: z.string().optional(),
    integrity: z.string().optional(),
  }),
});

function parseNpmPackage(spec: string): { name: string; version: string } | null {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return null;
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (name !== GEMINI_NPM_PACKAGE || !isValidReleaseVersion(version)) return null;
  return { name, version };
}

function verifyNpmTarball(bytes: Buffer, dist: { shasum?: string; integrity?: string }): boolean {
  if (typeof dist.integrity === 'string' && dist.integrity.startsWith('sha512-')) {
    const expected = Buffer.from(dist.integrity.slice('sha512-'.length), 'base64').toString('hex');
    return createHash('sha512').update(bytes).digest('hex') === expected;
  }
  if (typeof dist.shasum === 'string') {
    return createHash('sha1').update(bytes).digest('hex') === dist.shasum;
  }
  return false;
}

interface GeminiRelease extends ManagedRuntimeRelease {
  args: string[];
  shasum?: string;
  integrity?: string;
}

export interface GeminiManagedOptions extends Omit<ManagedRuntimeOptions, 'root'> {
  root?: string;
  nodePath?: string;
  registryUrl?: string;
  npmRegistryUrl?: string;
  tarballHost?: string;
}

export function geminiInstallRoot(cairnHome: string): string {
  return join(cairnHome, 'tools', 'gemini');
}

export function createGeminiManaged(options: GeminiManagedOptions = {}): ManagedRuntime {
  const root = options.root ?? geminiInstallRoot(join(homedir(), BRAND.homeDirName));
  const nodePath = options.nodePath ?? process.execPath;
  const registryUrl = options.registryUrl ?? ACP_REGISTRY_URL;
  const npmRegistryUrl = (options.npmRegistryUrl ?? NPM_REGISTRY_URL).replace(/\/+$/, '');
  const registryHost = hostOf(registryUrl);
  const npmRegistryHost = hostOf(npmRegistryUrl);
  const tarballHost = options.tarballHost ?? npmRegistryHost;

  const channel: ManagedRuntimeChannel<GeminiRelease> = {
    id: 'gemini',
    defaultArgs: GEMINI_ACP_ARGS,
    async resolveRelease(ctx) {
      if (registryHost === null || npmRegistryHost === null || tarballHost === null) return null;
      const registry = acpRegistrySchema.safeParse(
        await fetchJson(ctx.fetchImpl, registryUrl, registryHost),
      );
      if (!registry.success) {
        ctx.log('gemini ACP registry did not match the expected shape');
        return null;
      }
      const agent = registry.data.agents.find((entry) => entry.id === 'gemini');
      const pkg = agent?.distribution?.npx?.package;
      if (pkg === undefined) {
        ctx.log('gemini ACP registry has no npx distribution');
        return null;
      }
      const parsed = parseNpmPackage(pkg);
      if (parsed === null) {
        ctx.log(`gemini registry package spec is untrusted or unparseable: ${pkg}`);
        return null;
      }
      const meta = npmDistSchema.safeParse(
        await fetchJson(
          ctx.fetchImpl,
          `${npmRegistryUrl}/${encodeURIComponent(parsed.name)}/${encodeURIComponent(parsed.version)}`,
          npmRegistryHost,
        ),
      );
      if (!meta.success) {
        ctx.log(`gemini npm metadata for ${pkg} did not match the expected shape`);
        return null;
      }
      if (!trustedHttpsUrl(meta.data.dist.tarball, tarballHost)) {
        ctx.log(`gemini tarball url is untrusted: ${meta.data.dist.tarball}`);
        return null;
      }
      return {
        version: parsed.version,
        url: meta.data.dist.tarball,
        args: [...GEMINI_ACP_ARGS],
        ...(meta.data.dist.shasum !== undefined ? { shasum: meta.data.dist.shasum } : {}),
        ...(meta.data.dist.integrity !== undefined ? { integrity: meta.data.dist.integrity } : {}),
      };
    },
    async stage(release, stagingDir, ctx) {
      if (tarballHost === null) throw new Error('gemini tarball host is untrusted');
      const response = await safeFetch(ctx.fetchImpl, release.url, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        allowedHost: tarballHost,
        maxBytes: MAX_DOWNLOAD_BYTES,
      });
      if (!response.ok) throw new Error(`gemini tarball download failed: HTTP ${response.status}`);
      const bytes = response.bytes;
      if (!verifyNpmTarball(bytes, release)) {
        throw new Error('gemini tarball checksum mismatch');
      }
      const tarballPath = join(stagingDir, 'pkg.tgz');
      writeFileSync(tarballPath, bytes);
      await exec('tar', ['-xzf', tarballPath, '-C', stagingDir, 'package/bundle/gemini.js'], {
        timeout: 60_000,
      });
      rmSync(tarballPath, { force: true });
      const extracted = join(stagingDir, 'package', 'bundle', 'gemini.js');
      if (!existsSync(extracted) || !lstatSync(extracted).isFile()) {
        throw new Error('gemini tarball has no bundle/gemini.js');
      }
      if (!contains(realpathSync(stagingDir), realpathSync(extracted))) {
        throw new Error('gemini tarball bundle escapes the archive');
      }
      mkdirSync(join(stagingDir, 'bundle'), { recursive: true });
      const target = join(stagingDir, 'bundle', 'gemini.js');
      renameSync(extracted, target);
      rmSync(join(stagingDir, 'package'), { recursive: true, force: true });
      return {
        binRelPath: 'bundle/gemini.js',
        args: [...GEMINI_ACP_ARGS],
        ...(release.shasum !== undefined ? { tarballSha1: release.shasum } : {}),
      };
    },
    launchFor(binPath, args) {
      return { command: nodePath, args: [binPath, ...args] };
    },
    validate(staged) {
      return runVersionValidation(nodePath, [staged.binPath, '--version'], staged.version);
    },
  };

  return createManagedRuntime(channel, { ...options, root });
}
