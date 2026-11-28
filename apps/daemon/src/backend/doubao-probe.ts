import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  acpThoughtLevel,
  acpThoughtLevels,
  type DoubaoModel,
  type DoubaoReport,
} from '@cairn/shared';

const PROBE_COMMAND_TIMEOUT_MS = 15_000;
const MAX_PROBE_BUFFER_BYTES = 1_048_576;

export interface DoubaoBinaryResolution {
  command: string;
  source: 'native';
}

export interface DoubaoController {
  current(): DoubaoReport | null;
  refresh(): Promise<DoubaoReport>;
  invalidateAuth(): void;
}

export function isDoubaoPlatformSupported(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  return platform === 'darwin' && arch === 'arm64';
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function doubaoNativeBinaryCandidates(opts?: {
  realHome?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;
  const home = opts?.realHome ?? env.HOME ?? homedir();
  if (platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'doubao_cli', 'app', 'current', 'doubao')];
  }
  return [];
}

export function resolveDoubaoNativeBinary(opts?: {
  realHome?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  isExecutable?: (filePath: string) => boolean;
}): DoubaoBinaryResolution | null {
  const checkExec = opts?.isExecutable ?? isExecutableFile;
  for (const candidate of doubaoNativeBinaryCandidates(opts)) {
    if (checkExec(candidate)) return { command: candidate, source: 'native' };
  }
  return null;
}

export function parseDoubaoModelListOutput(stdout: string): DoubaoModel[] {
  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as {
      type?: unknown;
      subtype?: unknown;
      result?: { type?: unknown; models?: unknown } | undefined;
    };
    if (
      record.type !== 'result' ||
      record.subtype !== 'success' ||
      record.result?.type !== 'model_list' ||
      !Array.isArray(record.result.models)
    ) {
      continue;
    }
    const seen = new Set<string>();
    const models: DoubaoModel[] = [];
    for (const entry of record.result.models) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as {
        id?: unknown;
        model_id?: unknown;
        name?: unknown;
        display_name?: unknown;
        available?: unknown;
        efforts?: unknown;
        default_effort?: unknown;
      };
      if (item.available === false) continue;
      const rawId =
        typeof item.id === 'string'
          ? item.id
          : typeof item.model_id === 'string'
            ? item.model_id
            : '';
      const id = rawId.trim().slice(0, 256);
      if (id === '' || seen.has(id)) continue;
      const rawName =
        typeof item.name === 'string'
          ? item.name
          : typeof item.display_name === 'string'
            ? item.display_name
            : id;
      const name = (rawName.trim() || id).slice(0, 256);
      const rawEfforts = Array.isArray(item.efforts)
        ? item.efforts.filter((value): value is string => typeof value === 'string')
        : [];
      const thinkingLevels = rawEfforts.length > 0 ? acpThoughtLevels(rawEfforts) : undefined;
      const thinkingDefault =
        typeof item.default_effort === 'string' ? acpThoughtLevel(item.default_effort) : undefined;
      seen.add(id);
      models.push({
        id,
        name,
        ...(thinkingLevels !== undefined ? { thinkingLevels } : {}),
        ...(thinkingDefault !== undefined ? { thinkingDefault } : {}),
      });
    }
    return models;
  }
  return [];
}

export type ExecCommandFn = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

function defaultExecCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        env,
        timeout: PROBE_COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_PROBE_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout: String(stdout), stderr: String(stderr) });
          return;
        }
        const code =
          (error as NodeJS.ErrnoException & { status?: number }).status ??
          (typeof error.code === 'number' ? error.code : 1);
        resolve({ exitCode: code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function doubaoProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    DOUBAO_CLI_NO_UPDATE_CHECK: '1',
  };
}

function parseVersionString(text: string): string | undefined {
  const match = /\b(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\b/.exec(text);
  return match?.[1]?.slice(0, 64);
}

export async function probeDoubaoRuntime(opts?: {
  realHome?: string;
  command?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  isExecutable?: (filePath: string) => boolean;
  execCommand?: ExecCommandFn;
  now?: () => number;
}): Promise<DoubaoReport> {
  const now = opts?.now ?? (() => Date.now());
  const startedAt = now();
  const platform = opts?.platform ?? process.platform;
  const arch = opts?.arch ?? process.arch;
  const env = opts?.env ?? process.env;
  const platformSupported = isDoubaoPlatformSupported(platform, arch);
  const command =
    opts?.command ??
    resolveDoubaoNativeBinary({
      ...(opts?.realHome !== undefined ? { realHome: opts.realHome } : {}),
      platform,
      env,
      ...(opts?.isExecutable !== undefined ? { isExecutable: opts.isExecutable } : {}),
    })?.command ??
    null;
  if (command === null) {
    return {
      installed: false,
      authenticated: false,
      platformSupported,
      probedAt: startedAt,
    };
  }
  const execFn = opts?.execCommand ?? defaultExecCommand;
  const childEnv = doubaoProbeEnv(env);
  const [authRes, versionRes] = await Promise.all([
    execFn(command, ['auth', 'status', '--verify'], childEnv),
    execFn(command, ['--version'], childEnv),
  ]);
  const version = parseVersionString(`${versionRes.stdout}\n${versionRes.stderr}`);
  const combinedAuth = `${authRes.stdout}\n${authRes.stderr}`;
  const authenticated =
    authRes.exitCode === 0 &&
    !/not logged in|unauthenticated|authentication required|未登录|已失效/i.test(combinedAuth);
  if (!authenticated) {
    return {
      installed: true,
      authenticated: false,
      platformSupported,
      ...(version !== undefined ? { version } : {}),
      probedAt: startedAt,
    };
  }
  const modelsRes = await execFn(command, ['model', 'list', '--json'], childEnv);
  const models = modelsRes.exitCode === 0 ? parseDoubaoModelListOutput(modelsRes.stdout) : [];
  return {
    installed: true,
    authenticated: true,
    platformSupported,
    ...(version !== undefined ? { version } : {}),
    ...(models.length > 0 ? { models } : {}),
    probedAt: startedAt,
  };
}

export function createDoubaoProbeController(opts?: {
  probeFn?: () => Promise<DoubaoReport>;
  now?: () => number;
}): DoubaoController {
  const now = opts?.now ?? (() => Date.now());
  const probeFn = opts?.probeFn ?? (() => probeDoubaoRuntime({ now }));
  let cached: DoubaoReport | null = null;
  let inFlight: Promise<DoubaoReport> | null = null;
  let generation = 0;

  return {
    current: () => cached,
    refresh: () => {
      if (inFlight !== null) return inFlight;
      const myGen = generation;
      const run = probeFn()
        .then((report) => {
          const prevAt = cached?.probedAt ?? 0;
          if (myGen === generation && (cached === null || (report.probedAt ?? 0) >= prevAt)) {
            cached = report;
          }
          return cached ?? report;
        })
        .finally(() => {
          if (inFlight === run) inFlight = null;
        });
      inFlight = run;
      return run;
    },
    invalidateAuth: () => {
      generation += 1;
      inFlight = null;
      const nextAt = Math.max(now(), (cached?.probedAt ?? 0) + 1);
      cached =
        cached === null
          ? {
              installed: true,
              authenticated: false,
              platformSupported: isDoubaoPlatformSupported(),
              probedAt: nextAt,
            }
          : {
              ...cached,
              authenticated: false,
              probedAt: nextAt,
            };
    },
  };
}
