import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
  compareVersions,
  DEFAULT_ANTIGRAVITY_MODELS,
  type ThinkingLevel,
} from '@cairn/shared';
import {
  ANTIGRAVITY_CLI_ARCHIVE_PREFIX,
  ANTIGRAVITY_CLI_MANIFEST_BASE,
  ANTIGRAVITY_CLI_MIN_VERSION,
  type AntigravityManagedBin,
  currentAntigravityManagedInstall,
  ensureAntigravityManagedInstall,
} from '@cairn/shared/antigravity-install';
import { DAEMON_VERSION } from '../version.js';

const PROBE_INIT_TIMEOUT_MS = 30_000;
const PROBE_SESSION_TIMEOUT_MS = 30_000;
const PROBE_UPDATE_IDLE_MS = 200;
const PROBE_OVERALL_TIMEOUT_MS = 35_000;

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

export type AntigravityProbeOutcome =
  | { kind: 'ok'; install: AntigravityInstall }
  | { kind: 'timeout' }
  | { kind: 'not-installed' }
  | { kind: 'error'; message: string };

export interface AntigravityManaged {
  current(): AntigravityInstall | null;
  ensure(): Promise<AntigravityInstall | null>;
  probe(): Promise<AntigravityInstall | null>;
  probeDetailed?(): Promise<AntigravityProbeOutcome>;
}

export interface AntigravityManagedOptions {
  root?: string;
  platform?: string;
  arch?: string;
  musl?: boolean;
  fetchImpl?: typeof fetch;
  manifestBaseUrl?: string;
  archiveUrlPrefix?: string;
  versionProbe?: boolean;
  protectedVersions?: () => Iterable<string>;
  validateBinary?: (bin: AntigravityManagedBin) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  probeInitTimeoutMs?: number;
  probeSessionTimeoutMs?: number;
  probeOverallTimeoutMs?: number;
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

export function antigravityProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { AGY_CLI_DISABLE_AUTO_UPDATE: '1' };
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

class ProbeTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timeout`);
    this.name = 'ProbeTimeoutError';
  }
}

function within<T>(request: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return Promise.reject(new ProbeTimeoutError(label));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    request,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProbeTimeoutError(label)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function withThinkingLevels(
  setModel: (configId: string, modelId: string) => Promise<SetSessionConfigOptionResponse>,
  configOptions: readonly SessionConfigOption[] | null | undefined,
  models: AntigravityModel[],
  remainingMs: () => number,
): Promise<AntigravityModel[]> {
  const modelOption = configOptions?.find((option) => option.category === 'model');
  if (modelOption?.type !== 'select') return models;
  const learned: AntigravityModel[] = [];
  for (const model of models) {
    if (remainingMs() <= 0) {
      learned.push(model);
      continue;
    }
    try {
      const selected = await setModel(modelOption.id, model.id);
      learned.push({ ...model, ...thoughtChoiceOf(selected.configOptions) });
    } catch {
      learned.push(model);
    }
  }
  if (remainingMs() > 0) {
    await setModel(modelOption.id, modelOption.currentValue).catch(() => {});
  }
  return learned;
}

function extractModels(
  configOptions: readonly SessionConfigOption[] | null | undefined,
  response: NewSessionResponse,
): AntigravityModel[] {
  const modelOption = configOptions?.find((option) => option.category === 'model');
  if (modelOption?.type === 'select') {
    const seen = new Set<string>();
    const models: AntigravityModel[] = [];
    for (const entry of modelOption.options) {
      const items = 'options' in entry ? entry.options : [entry];
      for (const item of items) {
        if (item.value === '' || seen.has(item.value)) continue;
        seen.add(item.value);
        models.push({ id: item.value, name: item.name || item.value });
      }
    }
    if (models.length > 0) return models;
  }
  const legacy = (response as { models?: { availableModels?: unknown } }).models?.availableModels;
  if (Array.isArray(legacy)) {
    const seen = new Set<string>();
    const models: AntigravityModel[] = [];
    for (const entry of legacy) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { modelId, name } = entry as { modelId?: unknown; name?: unknown };
      if (typeof modelId !== 'string' || modelId === '' || seen.has(modelId)) continue;
      seen.add(modelId);
      models.push({ id: modelId, name: typeof name === 'string' && name !== '' ? name : modelId });
    }
    if (models.length > 0) return models;
  }
  return defaultModels();
}

function reportedVersionMatches(reported: string | undefined, expected: string): boolean {
  if (reported === undefined || reported === '') return false;
  if (compareVersions(reported, ANTIGRAVITY_CLI_MIN_VERSION) < 0) return false;
  return (
    reported === expected ||
    reported.startsWith(`${expected}-`) ||
    reported.startsWith(`${expected}+`)
  );
}

export async function validateAntigravityBinary(
  candidate: AntigravityManagedBin,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const validationDir = mkdtempSync(join(tmpdir(), 'cairn-agy-validate-'));
  const child = spawn(candidate.binPath, candidate.args, {
    cwd: validationDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...antigravityProbeEnv(baseEnv),
      HOME: validationDir,
      TMPDIR: validationDir,
    },
  });
  child.stderr.resume();
  const app = client({ name: 'cairn' });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  const connection = app.connect(stream);
  child.once('error', (error) => connection.close(error));
  child.once('exit', (code) =>
    connection.close(new Error(`antigravity validate exited (${code})`)),
  );

  try {
    const initialized = await within(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
        clientInfo: { name: 'cairn', version: DAEMON_VERSION },
      }),
      'validate initialize',
      PROBE_INIT_TIMEOUT_MS,
    );
    if (initialized.protocolVersion !== PROTOCOL_VERSION) return false;
    if (!reportedVersionMatches(initialized.agentInfo?.version, candidate.version)) return false;
    const caps = initialized.agentCapabilities;
    return caps?.loadSession === true || caps?.sessionCapabilities?.resume !== undefined;
  } catch {
    return false;
  } finally {
    connection.close();
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    killTimer.unref();
    rmSync(validationDir, { recursive: true, force: true });
  }
}

interface ProbeTimeouts {
  initMs: number;
  sessionMs: number;
  overallMs: number;
}

async function probeAntigravityBinary(
  binPath: string,
  args: string[],
  source: 'local' | 'managed',
  knownVersion: string | undefined,
  env: NodeJS.ProcessEnv,
  timeouts: ProbeTimeouts,
): Promise<AntigravityProbeOutcome> {
  const deadline = Date.now() + timeouts.overallMs;
  const remainingMs = () => deadline - Date.now();
  const probeDir = mkdtempSync(join(tmpdir(), 'cairn-agy-probe-'));
  const child = spawn(binPath, args, {
    cwd: probeDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  child.stderr.resume();
  const app = client({ name: 'cairn' });
  const bufferedUpdates = new Map<string, readonly SessionConfigOption[]>();
  let sessionId: string | undefined;
  let latestConfigOptions: readonly SessionConfigOption[] | null | undefined;
  let collectingUpdates = true;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let finishUpdates = () => {};
  let childExited = false;
  const extendUpdateWindow = () => {
    clearTimeout(updateTimer);
    const left = remainingMs();
    if (left <= 0) {
      finishUpdates();
      return;
    }
    updateTimer = setTimeout(finishUpdates, Math.min(PROBE_UPDATE_IDLE_MS, left));
  };
  app.onNotification(methods.client.session.update, ({ params }) => {
    if (!collectingUpdates || params.update.sessionUpdate !== 'config_option_update') return;
    const options = params.update.configOptions;
    if (!Array.isArray(options)) return;
    if (sessionId === undefined) {
      if (bufferedUpdates.has(params.sessionId) || bufferedUpdates.size < 16) {
        bufferedUpdates.set(params.sessionId, options);
      }
      return;
    }
    if (params.sessionId !== sessionId) return;
    latestConfigOptions = options;
    extendUpdateWindow();
  });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  const connection = app.connect(stream);
  child.once('error', (error) => {
    childExited = true;
    finishUpdates();
    connection.close(error);
  });
  child.once('exit', (code) => {
    childExited = true;
    finishUpdates();
    connection.close(new Error(`antigravity probe exited (${code})`));
  });

  try {
    const initialized = await within(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
        clientInfo: { name: 'cairn', version: DAEMON_VERSION },
      }),
      'probe initialize',
      Math.min(timeouts.initMs, remainingMs()),
    );
    const version = initialized.agentInfo?.version ?? knownVersion ?? 'unknown';
    try {
      const created = await within(
        connection.agent.request<NewSessionResponse>(methods.agent.session.new, {
          cwd: probeDir,
          mcpServers: [],
        }),
        'probe session',
        Math.min(timeouts.sessionMs, remainingMs()),
      );
      sessionId = created.sessionId;
      latestConfigOptions = bufferedUpdates.get(created.sessionId) ?? created.configOptions;
      if (!childExited && remainingMs() > 0) {
        await new Promise<void>((resolve) => {
          finishUpdates = resolve;
          extendUpdateWindow();
        });
      }
      collectingUpdates = false;
      clearTimeout(updateTimer);
      const models = await withThinkingLevels(
        (configId, value) =>
          within(
            connection.agent.request<SetSessionConfigOptionResponse>(
              methods.agent.session.setConfigOption,
              { sessionId: created.sessionId, configId, value },
            ),
            'probe model',
            Math.min(timeouts.sessionMs, remainingMs()),
          ),
        latestConfigOptions,
        extractModels(latestConfigOptions, created),
        remainingMs,
      );
      return {
        kind: 'ok',
        install: { version, binPath, args, source, authenticated: true, models },
      };
    } catch (error) {
      if (error instanceof ProbeTimeoutError) return { kind: 'timeout' };
      return {
        kind: 'ok',
        install: {
          version,
          binPath,
          args,
          source,
          authenticated: false,
          models: defaultModels(),
        },
      };
    }
  } catch (error) {
    if (error instanceof ProbeTimeoutError) return { kind: 'timeout' };
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    collectingUpdates = false;
    clearTimeout(updateTimer);
    connection.close();
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    killTimer.unref();
    rmSync(probeDir, { recursive: true, force: true });
  }
}

export function createAntigravityManaged(
  options: AntigravityManagedOptions = {},
): AntigravityManaged & { probeDetailed(): Promise<AntigravityProbeOutcome> } {
  const root = options.root ?? antigravityInstallRoot(join(homedir(), BRAND.homeDirName));
  const env = antigravityProbeEnv(options.env ?? process.env);
  const log = options.log ?? (() => {});
  const timeouts: ProbeTimeouts = {
    initMs: options.probeInitTimeoutMs ?? PROBE_INIT_TIMEOUT_MS,
    sessionMs: options.probeSessionTimeoutMs ?? PROBE_SESSION_TIMEOUT_MS,
    overallMs: options.probeOverallTimeoutMs ?? PROBE_OVERALL_TIMEOUT_MS,
  };
  const probeImpl: (
    binPath: string,
    args: string[],
    source: 'local' | 'managed',
    knownVersion?: string,
  ) => Promise<AntigravityProbeOutcome> =
    options.probeBinary !== undefined
      ? async (binPath, args, source, knownVersion) => {
          const result = await options.probeBinary?.(binPath, args, source, knownVersion);
          return result !== undefined && result !== null
            ? { kind: 'ok', install: result }
            : { kind: 'error', message: 'antigravity probe failed' };
        }
      : (binPath, args, source, knownVersion) =>
          probeAntigravityBinary(binPath, args, source, knownVersion, env, timeouts);
  const validate =
    options.validateBinary ??
    (options.probeBinary !== undefined
      ? async (candidate: AntigravityManagedBin) =>
          (await probeImpl(candidate.binPath, candidate.args, 'managed', candidate.version))
            .kind === 'ok'
      : (candidate: AntigravityManagedBin) => validateAntigravityBinary(candidate, env));
  const installOptions = {
    root,
    platform: options.platform,
    arch: options.arch,
    musl: options.musl,
    fetchImpl: options.fetchImpl,
    manifestBaseUrl: options.manifestBaseUrl ?? ANTIGRAVITY_CLI_MANIFEST_BASE,
    archiveUrlPrefix: options.archiveUrlPrefix ?? ANTIGRAVITY_CLI_ARCHIVE_PREFIX,
    versionProbe: options.versionProbe,
    validate,
    protectedVersions: options.protectedVersions,
    log,
  };

  let cached: AntigravityInstall | null = null;
  let pendingEnsure: Promise<AntigravityInstall | null> | null = null;
  let pendingProbe: Promise<AntigravityProbeOutcome> | null = null;

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

  async function probeDetailed(): Promise<AntigravityProbeOutcome> {
    if (pendingProbe !== null) return pendingProbe;
    pendingProbe = (async (): Promise<AntigravityProbeOutcome> => {
      const managed = currentAntigravityManagedInstall(root);
      if (managed === null) {
        cached = null;
        return { kind: 'not-installed' };
      }
      const outcome = await probeImpl(managed.binPath, managed.args, 'managed', managed.version);
      if (outcome.kind === 'ok') {
        cached = outcome.install;
      } else if (outcome.kind !== 'timeout') {
        cached = null;
      }
      return outcome;
    })().finally(() => {
      pendingProbe = null;
    });
    return pendingProbe;
  }

  async function probe(): Promise<AntigravityInstall | null> {
    const outcome = await probeDetailed();
    if (outcome.kind === 'ok') return outcome.install;
    if (outcome.kind === 'timeout') return cachedInstall();
    return null;
  }

  async function ensure(): Promise<AntigravityInstall | null> {
    if (pendingEnsure !== null) return pendingEnsure;
    pendingEnsure = (async () => {
      const managed = await ensureAntigravityManagedInstall(installOptions);
      if (managed === null) return current();
      const outcome = await probeImpl(managed.binPath, managed.args, 'managed', managed.version);
      if (outcome.kind === 'ok') {
        cached = outcome.install;
        return outcome.install;
      }
      return current();
    })().finally(() => {
      pendingEnsure = null;
    });
    return pendingEnsure;
  }

  return { current, ensure, probe, probeDetailed };
}
