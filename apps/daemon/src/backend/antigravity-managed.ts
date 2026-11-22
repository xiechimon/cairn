import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
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
  BRAND,
  DEFAULT_ANTIGRAVITY_MODELS,
  type ThinkingLevel,
} from '@cairn/shared';
import {
  ANTIGRAVITY_ARCHIVE_HOST,
  ANTIGRAVITY_REGISTRY_URL,
  currentAntigravityManagedInstall,
  ensureAntigravityManagedInstall,
} from '@cairn/shared/antigravity-install';
import { DAEMON_VERSION } from '../version.js';

const PROBE_INIT_TIMEOUT_MS = 10_000;
const PROBE_SESSION_TIMEOUT_MS = 20_000;

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
  platform?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  archiveHost?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  probeBinary?: (
    binPath: string,
    args: string[],
    source: 'local' | 'managed',
    knownVersion?: string,
  ) => Promise<AntigravityInstall | null>;
}

export function antigravityInstallRoot(cairnHome: string): string {
  return join(cairnHome, 'tools', 'antigravity');
}

const PROBE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
];

function probeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of PROBE_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
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

async function probeAntigravityBinary(
  binPath: string,
  args: string[],
  source: 'local' | 'managed',
  knownVersion: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<AntigravityInstall | null> {
  const probeDir = mkdtempSync(join(tmpdir(), 'cairn-agy-probe-'));
  const logFile = join(probeDir, 'probe.log');
  const child = spawn(binPath, args, {
    cwd: probeDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  const logStream = createWriteStream(logFile);
  child.stderr.on('data', (chunk: Buffer) => logStream.write(chunk));
  child.stderr.resume();
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
    logStream.end();
    rmSync(probeDir, { recursive: true, force: true });
  }
}

export function createAntigravityManaged(
  options: AntigravityManagedOptions = {},
): AntigravityManaged {
  const root = options.root ?? antigravityInstallRoot(join(homedir(), BRAND.homeDirName));
  const env = probeEnv(options.env ?? process.env);
  const log = options.log ?? (() => {});
  const installOptions = {
    root,
    platform: options.platform,
    arch: options.arch,
    fetchImpl: options.fetchImpl,
    registryUrl: options.registryUrl ?? ANTIGRAVITY_REGISTRY_URL,
    archiveHost: options.archiveHost ?? ANTIGRAVITY_ARCHIVE_HOST,
    log,
  };
  const probeImpl =
    options.probeBinary ??
    ((binPath, args, source, knownVersion) =>
      probeAntigravityBinary(binPath, args, source, knownVersion, env));

  let cached: AntigravityInstall | null = null;
  let pendingEnsure: Promise<AntigravityInstall | null> | null = null;
  let pendingProbe: Promise<AntigravityInstall | null> | null = null;

  function cachedInstall(): AntigravityInstall | null {
    if (cached !== null && !existsSync(cached.binPath)) cached = null;
    return cached;
  }

  function current(): AntigravityInstall | null {
    const hit = cachedInstall();
    if (hit !== null) return hit;
    const managed = currentAntigravityManagedInstall(root);
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

  async function probe(): Promise<AntigravityInstall | null> {
    if (pendingProbe !== null) return pendingProbe;
    pendingProbe = (async () => {
      const managed = currentAntigravityManagedInstall(root);
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
      const managed = await ensureAntigravityManagedInstall(installOptions);
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
