import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { promisify } from 'node:util';
import {
  client,
  methods,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionConfigOption,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import {
  acpThoughtLevel,
  acpThoughtLevels,
  antigravityBinaryCandidates,
  DEFAULT_ANTIGRAVITY_MODELS,
  type ThinkingLevel,
} from '@cairn/shared';
import { z } from 'zod';
import { DAEMON_VERSION } from '../version.js';

const exec = promisify(execFile);

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const LOCK_STALE_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const PROBE_INIT_TIMEOUT_MS = 10_000;
const PROBE_SESSION_TIMEOUT_MS = 5_000;

const registryAgentSchema = z.object({
  id: z.string(),
  version: z.string(),
  distribution: z
    .object({
      binary: z
        .record(
          z.string(),
          z.object({
            archive: z.string().url(),
            cmd: z.string(),
            args: z.array(z.string()).optional(),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/i)
              .optional(),
          }),
        )
        .nullish(),
    })
    .optional(),
});

const registrySchema = z.object({ agents: z.array(registryAgentSchema) });

const installMarkerSchema = z.object({
  version: z.string(),
  url: z.string(),
  archiveSha256: z.string(),
  binRelPath: z.string(),
  binSha256: z.string(),
  args: z.array(z.string()).default(['acp']),
  installedAt: z.number(),
});
type InstallMarker = z.infer<typeof installMarkerSchema>;

export interface AntigravityModel {
  id: string;
  name: string;
  thinkingLevels?: ThinkingLevel[];
  thinkingDefault?: ThinkingLevel;
}

export interface AntigravityInstall {
  version: string;
  binPath: string;
  args: string[];
  source: 'local' | 'managed';
  authenticated: boolean;
  models: AntigravityModel[];
}

export interface AntigravityManaged {
  current(): AntigravityInstall | null;
  ensure(): Promise<AntigravityInstall | null>;
  probe(): Promise<AntigravityInstall | null>;
}

export interface AntigravityManagedOptions {
  root?: string;
  home?: string;
  agyPath?: string;
  pathEnv?: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  probeBinary?: (
    binPath: string,
    args: string[],
    source: 'local' | 'managed',
    knownVersion?: string,
  ) => Promise<AntigravityInstall | null>;
}

export function antigravityInstallRoot(home = homedir()): string {
  return join(home, '.local', 'share', 'cairn', 'antigravity');
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function platformKey(platform: string, arch: string): string | null {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  return os !== null && cpu !== null ? `${os}-${cpu}` : null;
}

function markerOf(versionDir: string): InstallMarker | null {
  try {
    return installMarkerSchema.parse(
      JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')),
    );
  } catch {
    return null;
  }
}

function defaultModels(): AntigravityModel[] {
  return DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name, thinkingLevels, thinkingDefault }) => ({
    id,
    name,
    ...(thinkingLevels === undefined ? {} : { thinkingLevels }),
    ...(thinkingDefault === undefined ? {} : { thinkingDefault }),
  }));
}

function thoughtChoiceOf(
  options: readonly SessionConfigOption[],
): Pick<AntigravityModel, 'thinkingLevels' | 'thinkingDefault'> {
  const option = options.find((entry) => entry.category === 'thought_level');
  if (option?.type !== 'select') return { thinkingLevels: [] };
  const thinkingLevels = acpThoughtLevels(
    option.options.flatMap((entry) =>
      'options' in entry ? entry.options.map((item) => item.value) : [entry.value],
    ),
  );
  const thinkingDefault = acpThoughtLevel(option.currentValue);
  return thinkingDefault === undefined ? { thinkingLevels } : { thinkingLevels, thinkingDefault };
}

function within<T>(request: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    request,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), PROBE_SESSION_TIMEOUT_MS),
    ),
  ]);
}

async function withThinkingLevels(
  setModel: (configId: string, modelId: string) => Promise<SetSessionConfigOptionResponse>,
  created: NewSessionResponse,
  models: AntigravityModel[],
): Promise<AntigravityModel[]> {
  const modelOption = created.configOptions?.find((option) => option.category === 'model');
  if (modelOption?.type !== 'select') return models;
  const learned: AntigravityModel[] = [];
  for (const model of models) {
    try {
      const selected = await setModel(modelOption.id, model.id);
      learned.push({ ...model, ...thoughtChoiceOf(selected.configOptions) });
    } catch {
      learned.push(model);
    }
  }
  await setModel(modelOption.id, modelOption.currentValue).catch(() => {});
  return learned;
}

function extractModels(response: NewSessionResponse): AntigravityModel[] {
  const modelOption = response.configOptions?.find((option) => option.category === 'model');
  if (modelOption?.type !== 'select') {
    return defaultModels();
  }
  const models: AntigravityModel[] = [];
  for (const entry of modelOption.options) {
    if ('options' in entry) {
      for (const item of entry.options) models.push({ id: item.value, name: item.name });
    } else {
      models.push({ id: entry.value, name: entry.name });
    }
  }
  return models.length > 0 ? models : defaultModels();
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function probeAntigravityBinary(
  binPath: string,
  args: string[],
  source: 'local' | 'managed',
  knownVersion: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<AntigravityInstall | null> {
  const probeDir = mkdtempSync(join(tmpdir(), 'cairn-agy-probe-'));
  const logFile = join(probeDir, 'probe.log');
  const spawnArgs = basename(binPath).startsWith('agy')
    ? [...args, '--log-file', logFile]
    : [...args];
  const child = spawn(binPath, spawnArgs, {
    cwd: probeDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  const app = client({ name: 'cairn' });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  const connection = app.connect(stream);
  child.once('error', (error) => connection.close(error));
  child.once('exit', (code) => connection.close(new Error(`antigravity probe exited (${code})`)));

  try {
    const initialized = await Promise.race([
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
        clientInfo: { name: 'cairn', version: DAEMON_VERSION },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('probe initialize timeout')), PROBE_INIT_TIMEOUT_MS),
      ),
    ]);
    const version = initialized.agentInfo?.version ?? knownVersion ?? 'unknown';
    try {
      const created = await Promise.race([
        connection.agent.request<NewSessionResponse>(methods.agent.session.new, {
          cwd: probeDir,
          mcpServers: [],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('probe session timeout')), PROBE_SESSION_TIMEOUT_MS),
        ),
      ]);
      const models = await withThinkingLevels(
        (configId, value) =>
          within(
            connection.agent.request<SetSessionConfigOptionResponse>(
              methods.agent.session.setConfigOption,
              { sessionId: created.sessionId, configId, value },
            ),
            'probe model',
          ),
        created,
        extractModels(created),
      );
      return { version, binPath, args, source, authenticated: true, models };
    } catch {
      return {
        version,
        binPath,
        args,
        source,
        authenticated: false,
        models: defaultModels(),
      };
    }
  } catch {
    return null;
  } finally {
    connection.close();
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    killTimer.unref();
    rmSync(probeDir, { recursive: true, force: true });
  }
}

export function createAntigravityManaged(
  options: AntigravityManagedOptions = {},
): AntigravityManaged {
  const home = options.home ?? homedir();
  const root = options.root ?? antigravityInstallRoot(home);
  const env = options.env ?? process.env;
  const pathEnv = options.pathEnv ?? env.PATH;
  const agyPath = options.agyPath ?? env.CAIRN_AGY_PATH;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const registryUrl = options.registryUrl ?? REGISTRY_URL;
  const log = options.log ?? (() => {});
  const key = platformKey(platform, arch);
  const probeImpl =
    options.probeBinary ??
    ((binPath, args, source, knownVersion) =>
      probeAntigravityBinary(binPath, args, source, knownVersion, env));

  let cached: AntigravityInstall | null = null;
  let pendingEnsure: Promise<AntigravityInstall | null> | null = null;
  let pendingProbe: Promise<AntigravityInstall | null> | null = null;

  function resolveLocalCandidate(): { binPath: string; args: string[] } | null {
    const managedPrefix = join(root, 'versions');
    for (const candidate of antigravityBinaryCandidates({
      home,
      pathEnv,
      managedVersions: [],
      explicitPath: agyPath,
    })) {
      if (candidate.startsWith(managedPrefix)) continue;
      if (isExecutableFile(candidate)) return { binPath: candidate, args: ['acp'] };
    }
    return null;
  }

  function managedInstallFromDir(
    versionDir: string,
  ): { version: string; binPath: string; args: string[] } | null {
    const marker = markerOf(versionDir);
    if (marker === null) return null;
    const binPath = join(versionDir, marker.binRelPath);
    try {
      if (!existsSync(binPath) || sha256File(binPath) !== marker.binSha256) return null;
    } catch {
      return null;
    }
    return { version: marker.version, binPath, args: marker.args };
  }

  function currentManaged(): { version: string; binPath: string; args: string[] } | null {
    try {
      const currentJson = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof currentJson.version === 'string') {
        const found = managedInstallFromDir(join(root, 'versions', currentJson.version));
        if (found !== null) return found;
      }
    } catch {}
    const versions = join(root, 'versions');
    try {
      for (const entry of readdirSync(versions).sort().reverse()) {
        const found = managedInstallFromDir(join(versions, entry));
        if (found !== null) return found;
      }
    } catch {}
    return null;
  }

  function cachedInstall(): AntigravityInstall | null {
    if (cached !== null && !existsSync(cached.binPath)) cached = null;
    return cached;
  }

  function current(): AntigravityInstall | null {
    const hit = cachedInstall();
    if (hit !== null) return hit;
    const local = resolveLocalCandidate();
    if (local !== null) {
      return {
        version: 'local',
        binPath: local.binPath,
        args: local.args,
        source: 'local',
        authenticated: false,
        models: defaultModels(),
      };
    }
    const managed = currentManaged();
    if (managed !== null) {
      return {
        version: managed.version,
        binPath: managed.binPath,
        args: managed.args,
        source: 'managed',
        authenticated: false,
        models: defaultModels(),
      };
    }
    return null;
  }

  async function fetchCachedRegistry(): Promise<string | null> {
    try {
      const response = await fetchImpl(registryUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`antigravity registry HTTP ${response.status}`);
      const text = await response.text();
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'registry-cache.json'), text);
      return text;
    } catch {
      try {
        return readFileSync(join(root, 'registry-cache.json'), 'utf8');
      } catch {
        return null;
      }
    }
  }

  async function installFromRegistry(): Promise<{
    version: string;
    binPath: string;
    args: string[];
  } | null> {
    if (key === null) return null;
    const body = await fetchCachedRegistry();
    if (body === null) return null;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return null;
    }
    const parsed = registrySchema.safeParse(parsedJson);
    if (!parsed.success) {
      log('antigravity registry did not match the expected shape');
      return null;
    }
    const agent = parsed.data.agents.find(
      (entry) => entry.id === 'antigravity-acp' || entry.id === 'antigravity',
    );
    const binary = agent?.distribution?.binary?.[key];
    if (agent === undefined || binary === undefined) {
      log(`antigravity registry has no binary entry for ${key}`);
      return null;
    }
    const versionDir = join(root, 'versions', agent.version);
    const existing = managedInstallFromDir(versionDir);
    if (existing !== null) return existing;

    const lock = join(root, '.install.lock');
    mkdirSync(root, { recursive: true });
    try {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true });
      } catch {}
      mkdirSync(lock);
    } catch {
      return currentManaged();
    }

    const staging = mkdtempSync(join(root, '.staging-'));
    try {
      log(`downloading antigravity ${agent.version}…`);
      const response = await fetchImpl(binary.archive, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`antigravity download: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
      if (binary.sha256 !== undefined && archiveSha256 !== binary.sha256.toLowerCase()) {
        throw new Error('antigravity archive checksum mismatch');
      }
      const isZip = binary.archive.toLowerCase().endsWith('.zip');
      const archivePath = join(staging, isZip ? 'antigravity.zip' : 'antigravity.tar.gz');
      writeFileSync(archivePath, bytes);
      if (isZip) {
        await exec('unzip', ['-o', '-q', archivePath, '-d', staging], { timeout: 60_000 });
      } else {
        await exec('tar', ['-xzf', archivePath, '-C', staging], { timeout: 60_000 });
      }
      rmSync(archivePath, { force: true });

      const binRelPath = binary.cmd.replace(/^\.[/\\]/, '').replaceAll('\\', '/');
      let binPath = join(staging, binRelPath);
      if (!existsSync(binPath)) {
        const tops = readdirSync(staging).filter((entry) =>
          statSync(join(staging, entry)).isDirectory(),
        );
        const top = tops[0];
        if (tops.length !== 1 || top === undefined) {
          throw new Error('antigravity archive layout unrecognized');
        }
        binPath = join(staging, top, binRelPath);
        if (!existsSync(binPath)) throw new Error('antigravity archive has no binary');
      }
      const marker: InstallMarker = {
        version: agent.version,
        url: binary.archive,
        archiveSha256,
        binRelPath: binPath.slice(staging.length + 1),
        binSha256: sha256File(binPath),
        args: binary.args ?? ['acp'],
        installedAt: Date.now(),
      };
      writeFileSync(join(staging, '.install-complete'), JSON.stringify(marker));
      rmSync(versionDir, { recursive: true, force: true });
      mkdirSync(join(root, 'versions'), { recursive: true });
      renameSync(staging, versionDir);
      writeFileSync(join(root, 'current.json'), JSON.stringify({ version: agent.version }));
      log(`antigravity ${agent.version} installed`);
      return managedInstallFromDir(versionDir);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      log(`antigravity install failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      try {
        rmSync(lock, { recursive: true, force: true });
      } catch {}
    }
  }

  async function probe(): Promise<AntigravityInstall | null> {
    if (pendingProbe !== null) return pendingProbe;
    pendingProbe = (async () => {
      const local = resolveLocalCandidate();
      if (local !== null) {
        const probed = await probeImpl(local.binPath, local.args, 'local');
        if (probed !== null) {
          cached = probed;
          return probed;
        }
      }
      const managed = currentManaged();
      if (managed !== null) {
        const probed = await probeImpl(managed.binPath, managed.args, 'managed', managed.version);
        if (probed !== null) {
          cached = probed;
          return probed;
        }
      }
      return current();
    })().finally(() => {
      pendingProbe = null;
    });
    return pendingProbe;
  }

  async function ensure(): Promise<AntigravityInstall | null> {
    if (pendingEnsure !== null) return pendingEnsure;
    pendingEnsure = (async () => {
      const local = resolveLocalCandidate();
      if (local !== null) {
        const probed = await probeImpl(local.binPath, local.args, 'local');
        if (probed !== null) {
          cached = probed;
          return probed;
        }
      }
      const managed = currentManaged() ?? (await installFromRegistry());
      if (managed === null) return current();
      const probed = await probeImpl(managed.binPath, managed.args, 'managed', managed.version);
      if (probed !== null) {
        cached = probed;
        return probed;
      }
      return current();
    })().finally(() => {
      pendingEnsure = null;
    });
    return pendingEnsure;
  }

  return { current, ensure, probe };
}
