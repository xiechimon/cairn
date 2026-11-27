import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createManagedRuntime, type ManagedRuntimeChannel } from '../backend/managed-runtime.js';
import { ensurePrivateDir } from '../private-fs.js';
import { AGENT_BROWSER_BINARY, browserProfileKeyOfSession } from './browser.js';
import { HostComputerProvider } from './host.js';
import { browserProxyArgs } from './host-desktop.js';
import { REAL_BROWSER_ENV, writeBrowserLauncher } from './mac-browser-launcher.js';
import { createBrowserPortSlots } from './mac-browser-ports.js';
import {
  type ComputerExecuteRequest,
  type ComputerProvider,
  ComputerRefusal,
  type LazyBrowser,
} from './provider.js';

export const MAC_AGENT_BROWSER_ENV = 'CAIRN_AGENT_BROWSER';
export const MAC_BROWSER_DOWNLOAD_WAIT_MS = 45_000;
export const NO_STEALTH_BROWSER_NOTE =
  '[This Mac has no stealth browser; this ran in the standard one. If the site blocks it, tell the owner; Browser MCP in Settings lets Cairn use their own signed-in Chrome.]';
export const MAC_BROWSER_FIRST_USE_NOTE =
  '[第一次使用浏览器：这台 Mac 没有 Google Chrome，Cairn 刚下载好了自己的浏览器组件（约 100 MB，只下载这一次）。]';

const BROWSER_RUN_HEADROOM_MS = 10_000;
const VERSION_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 2_000;
const STREAM_DISABLE_TIMEOUT_MS = 5_000;
const SHELL_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_SHELL_ARCHIVE_BYTES = 256 * 1024 * 1024;
const SOCKET_DIR = '.agent-browser';
const IDLE_TIMEOUT_MS = 30 * 60_000;
const SHELL_ID = 'chrome-headless-shell';
const CHROME_BINARY = 'Google Chrome.app/Contents/MacOS/Google Chrome';
const MANAGED_CHROME_POLICY = '/Library/Managed Preferences/com.google.Chrome.plist';
const CHROME_ARGS = [
  '--use-mock-keychain',
  '--password-store=basic',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
];

export interface HeadlessShellRelease {
  version: string;
  url: string;
  sha256: string;
}

export type HeadlessShellReleases = Partial<Record<string, HeadlessShellRelease>>;

const SHELL_VERSION = '158.0.8127.88';
const SHELL_BASE = `https://storage.googleapis.com/chrome-for-testing-public/${SHELL_VERSION}`;

export const HEADLESS_SHELL_RELEASES: HeadlessShellReleases = {
  arm64: {
    version: SHELL_VERSION,
    url: `${SHELL_BASE}/mac-arm64/chrome-headless-shell-mac-arm64.zip`,
    sha256: '69320f6869c4defbbdac8b8fa83aef65dc63975e83bbd06899b75dbea5c464b3',
  },
  x64: {
    version: SHELL_VERSION,
    url: `${SHELL_BASE}/mac-x64/chrome-headless-shell-mac-x64.zip`,
    sha256: 'dc1ac31965cb2ec7794aed8c66127aceea304ae15353cd56fc4b8bde44091548',
  },
};

const run = promisify(execFile);

const GOOGLE_CHROME_REQUIREMENT =
  '(identifier "com.google.Chrome" or identifier "com.google.Chrome.beta" or identifier "com.google.Chrome.dev" or identifier "com.google.Chrome.canary") and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = "EQHXZ8M8AV"';

export async function verifyGoogleChrome(
  appPath: string,
  runImpl: typeof run = run,
): Promise<boolean> {
  const verified = await runImpl(
    '/usr/bin/codesign',
    ['--verify', `-R=${GOOGLE_CHROME_REQUIREMENT}`, appPath],
    { timeout: VERSION_TIMEOUT_MS },
  ).catch(() => null);
  return verified !== null;
}

export interface ChromeLookup {
  applications?: string;
  verify?: (appPath: string) => Promise<boolean>;
}

export async function findInstalledChrome(
  _userHome: string,
  lookup: ChromeLookup = {},
): Promise<string | null> {
  if (existsSync(MANAGED_CHROME_POLICY)) return null;
  const applications = lookup.applications ?? '/Applications';
  const binary = join(applications, CHROME_BINARY);
  if (!existsSync(binary)) return null;
  const verify = lookup.verify ?? ((appPath: string) => verifyGoogleChrome(appPath));
  return (await verify(join(applications, 'Google Chrome.app'))) ? binary : null;
}

export function bundledAgentBrowser(env: NodeJS.ProcessEnv): string | null {
  const binary = env[MAC_AGENT_BROWSER_ENV]?.trim();
  if (!binary) return null;
  try {
    accessSync(binary, constants.X_OK);
    return statSync(binary).isFile() ? binary : null;
  } catch {
    return null;
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function majorVersion(executable: string): Promise<string | null> {
  const answer = await run(executable, ['--version'], { timeout: VERSION_TIMEOUT_MS }).catch(
    () => null,
  );
  return /(\d+)\.\d+\.\d+\.\d+/.exec(String(answer?.stdout ?? ''))?.[1] ?? null;
}

function userAgent(major: string): string {
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export interface MacBrowserOptions {
  root: string;
  toolsRoot: string;
  agentBrowser: string;
  arch: string;
  env: NodeJS.ProcessEnv;
  chrome?: () => Promise<string | null>;
  shellReleases?: HeadlessShellReleases;
  fetchImpl?: typeof fetch;
  waitMs?: number;
  maxArchiveBytes?: number;
  log?: (message: string) => void;
}

interface Executable {
  kind: 'chrome' | 'shell';
  path: string;
  major: string;
}

export function createMacBrowser(options: MacBrowserOptions): LazyBrowser {
  const releases = options.shellReleases ?? HEADLESS_SHELL_RELEASES;
  const release = releases[options.arch];
  const maxArchiveBytes = options.maxArchiveBytes ?? MAX_SHELL_ARCHIVE_BYTES;
  const lookForChrome =
    options.chrome ?? (() => findInstalledChrome(options.env.HOME ?? '/var/empty'));
  const progress = { received: 0, total: 0 };
  let failure: string | null = null;
  let downloading: Promise<string | null> | null = null;
  let downloadController: AbortController | null = null;
  const versions = new Map<string, string>();
  const portsFor = createBrowserPortSlots();
  const providers = new Map<string, ComputerProvider>();
  const sessions = new Map<string, ComputerProvider>();

  const channel: ManagedRuntimeChannel = {
    id: SHELL_ID,
    defaultArgs: [],
    resolveRelease: async () => release ?? null,
    async stage(wanted, stagingDir, ctx) {
      const expected = releases[options.arch]?.sha256;
      const timeoutSignal = AbortSignal.timeout(SHELL_DOWNLOAD_TIMEOUT_MS);
      const signal =
        downloadController === null
          ? timeoutSignal
          : AbortSignal.any([downloadController.signal, timeoutSignal]);
      const response = await ctx.fetchImpl(wanted.url, { signal });
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      progress.received = 0;
      progress.total = Number(response.headers.get('content-length') ?? 0);
      if (progress.total > maxArchiveBytes) throw new Error('下载的文件大小超出限制');
      const archive = join(stagingDir, 'shell.zip');
      const hash = createHash('sha256');
      const file = await open(archive, 'wx', 0o600);
      try {
        for await (const chunk of response.body) {
          if (progress.received + chunk.byteLength > maxArchiveBytes) {
            throw new Error('下载的文件大小超出限制');
          }
          hash.update(chunk);
          await file.write(chunk);
          progress.received += chunk.byteLength;
        }
      } finally {
        await file.close();
      }
      const actual = hash.digest('hex');
      if (actual !== expected) throw new Error('下载的文件校验不通过');
      await run('/usr/bin/unzip', ['-q', archive, '-d', stagingDir]);
      await rm(archive);
      return {
        binRelPath: join(`chrome-headless-shell-mac-${options.arch}`, 'chrome-headless-shell'),
        args: [],
        archiveSha256: actual,
      };
    },
    launchFor: (binPath, args) => ({ command: binPath, args: [...args] }),
    async validate(staged) {
      return (await majorVersion(staged.binPath)) === null
        ? { ok: false, reason: '下载的浏览器组件在这台 Mac 上启动不了' }
        : { ok: true };
    },
  };
  const shell = createManagedRuntime(
    {
      ...channel,
      async stage(...args) {
        return channel.stage(...args).catch((error: unknown) => {
          failure = error instanceof Error ? error.message : String(error);
          throw error;
        });
      },
      async validate(...args) {
        const checked = await channel.validate(...args);
        if (!checked.ok) failure = checked.reason;
        return checked;
      },
    },
    {
      root: join(options.toolsRoot, SHELL_ID),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.log ? { log: options.log } : {}),
    },
  );

  async function majorOf(path: string): Promise<string | null> {
    const key = `${path}\u0000${statSync(path).mtimeMs}`;
    const known = versions.get(key);
    if (known !== undefined) return known;
    const major = await majorVersion(path);
    if (major !== null) versions.set(key, major);
    return major;
  }

  async function ready(): Promise<Executable | null> {
    const chrome = await lookForChrome();
    if (chrome !== null) {
      const major = await majorOf(chrome);
      if (major !== null) return { kind: 'chrome', path: chrome, major };
    }
    const installed = shell.current();
    if (installed === null || installed.version !== release?.version) return null;
    const major = await majorOf(installed.binPath);
    return major === null ? null : { kind: 'shell', path: installed.binPath, major };
  }

  function download(): Promise<string | null> {
    downloading ??= (async () => {
      failure = null;
      progress.received = 0;
      progress.total = 0;
      downloadController = new AbortController();
      if (shell.current() !== null)
        await rm(join(options.toolsRoot, SHELL_ID, 'versions'), { recursive: true, force: true });
      const installed = await shell.update().catch((error: unknown) => {
        failure = error instanceof Error ? error.message : String(error);
        return null;
      });
      if (installed !== null) return null;
      return failure ?? '另一次下载还占着安装目录，最多 15 分钟后可以重试';
    })().finally(() => {
      downloading = null;
      downloadController = null;
    });
    return downloading;
  }

  function browserControlEnv(): Record<string, string> {
    const env: Record<string, string> = {
      ...options.env,
      HOME: options.root,
      AGENT_BROWSER_SOCKET_DIR: SOCKET_DIR,
      AGENT_BROWSER_NO_VERSION_CHECK: '1',
    };
    for (const name of Object.keys(env)) {
      if (name.toUpperCase().startsWith('AI_GATEWAY_')) delete env[name];
    }
    return env;
  }

  const streamDisabledPids = new Set<string>();

  function sessionFile(session: string, suffix: string): string {
    return join(options.root, SOCKET_DIR, `${session}.${suffix}`);
  }

  function daemonPid(session: string): string | null {
    try {
      const pid = readFileSync(sessionFile(session, 'pid'), 'utf8').trim();
      return pid === '' ? null : pid;
    } catch {
      return null;
    }
  }

  async function disableStream(session: string): Promise<'off' | 'retry'> {
    const outcome = await run(options.agentBrowser, ['--session', session, 'stream', 'disable'], {
      cwd: options.root,
      env: browserControlEnv(),
      timeout: STREAM_DISABLE_TIMEOUT_MS,
    }).then(
      () => '',
      (error: unknown) => {
        const failed = error as { stderr?: unknown; message?: unknown };
        return `${String(failed.stderr ?? '')}\n${String(failed.message ?? error)}`;
      },
    );
    return outcome.includes('Streaming is not enabled') || outcome === '' ? 'off' : 'retry';
  }

  async function ensureStreamDisabled(
    session: string,
    pidBefore: string | null,
    startedAt: number,
  ): Promise<void> {
    const pidAfter = daemonPid(session);
    const hasStreamFile = existsSync(sessionFile(session, 'stream'));
    const launchedNewDaemon = pidAfter !== null && pidAfter !== pidBefore;
    if (!hasStreamFile && !launchedNewDaemon) return;
    if (
      !hasStreamFile &&
      pidAfter !== null &&
      streamDisabledPids.has(`${session}\u0000${pidAfter}`)
    ) {
      return;
    }
    let outcome = await disableStream(session);
    if (outcome !== 'off') {
      await sleep(100);
      outcome = await disableStream(session);
    }
    if (outcome === 'off') {
      if (pidAfter !== null) streamDisabledPids.add(`${session}\u0000${pidAfter}`);
      options.log?.(`agent-browser stream for ${session} off after ${Date.now() - startedAt} ms`);
      return;
    }
    options.log?.(`agent-browser stream for ${session} was not confirmed off`);
  }

  function providerFor(executable: Executable): ComputerProvider {
    const key = `${executable.kind}\u0000${executable.path}\u0000${executable.major}`;
    const known = providers.get(key);
    if (known !== undefined) return known;
    ensurePrivateDir(options.root);
    const launcher = writeBrowserLauncher(options.root);
    const inner = new HostComputerProvider({
      home: options.root,
      env: { ...options.env, HOME: options.root },
      agentBrowserBinary: options.agentBrowser,
      browserEnvironment: async (argv) => {
        const session = argv[argv.indexOf('--session') + 1] ?? '';
        sessions.set(session, wrapped);
        const profile = join(
          options.root,
          'profiles',
          browserProfileKeyOfSession(session) ?? session,
          executable.kind,
        );
        ensurePrivateDir(profile);
        const ports = await portsFor(session);
        return {
          AGENT_BROWSER_EXECUTABLE_PATH: launcher,
          [REAL_BROWSER_ENV]: executable.path,
          AGENT_BROWSER_STREAM_PORT: String(ports.stream),
          AGENT_BROWSER_PROFILE: profile,
          AGENT_BROWSER_USER_AGENT: userAgent(executable.major),
          AGENT_BROWSER_ARGS: [
            ...CHROME_ARGS,
            ...browserProxyArgs(options.env),
            `--remote-debugging-port=${ports.debug}`,
          ].join(','),
          AGENT_BROWSER_SOCKET_DIR: SOCKET_DIR,
          AGENT_BROWSER_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
          AGENT_BROWSER_NO_VERSION_CHECK: '1',
        };
      },
    });
    const wrapped: ComputerProvider = {
      listFiles: (path) => inner.listFiles(path),
      readFile: (path) => inner.readFile(path),
      writeFile: (path, content) => inner.writeFile(path, content),
      killAll: () => inner.killAll(),
      async execute(request: ComputerExecuteRequest) {
        const isBrowser = request.argv[0] === AGENT_BROWSER_BINARY;
        const sessionIndex = isBrowser ? request.argv.indexOf('--session') : -1;
        const session = sessionIndex >= 0 ? (request.argv[sessionIndex + 1] ?? '') : '';
        const isShutdown =
          isBrowser && (request.argv.includes('close') || request.argv.includes('stream'));
        const watchSession = session !== '' && !isShutdown;
        const pidBefore = watchSession ? daemonPid(session) : null;
        const startedAt = Date.now();
        const events = await inner.execute(request);
        if (!watchSession) return events;
        return (async function* () {
          let checked = false;
          try {
            for await (const event of events) {
              if (event.kind === 'exit') {
                checked = true;
                await ensureStreamDisabled(session, pidBefore, startedAt);
              }
              yield event;
            }
          } finally {
            if (!checked) {
              const pidAfter = daemonPid(session);
              if (
                existsSync(sessionFile(session, 'stream')) ||
                (pidAfter !== null && pidAfter !== pidBefore)
              ) {
                await ensureStreamDisabled(session, pidBefore, startedAt);
              }
            }
          }
        })();
      },
    };
    providers.set(key, wrapped);
    return wrapped;
  }

  return {
    async open({ signal, deadlineAt }) {
      const now = await ready();
      if (now !== null) return { provider: providerFor(now), note: null };
      const waitMs = Math.max(
        0,
        Math.min(
          options.waitMs ?? MAC_BROWSER_DOWNLOAD_WAIT_MS,
          deadlineAt - Date.now() - BROWSER_RUN_HEADROOM_MS,
        ),
      );
      const waiting = new AbortController();
      const outcome = await Promise.race([
        download().then((error) => ({ finished: true as const, error })),
        sleep(waitMs, undefined, { signal: AbortSignal.any([signal, waiting.signal]) }).then(
          () => ({ finished: false as const }),
          () => ({ finished: false as const }),
        ),
      ]);
      waiting.abort();
      signal.throwIfAborted();
      if (!outcome.finished) {
        const percent =
          progress.total > 0
            ? Math.min(99, Math.floor((progress.received / progress.total) * 100))
            : 0;
        throw new ComputerRefusal(
          `浏览器组件还在下载（已完成 ${percent}%），下载会在后台继续；请过一两分钟再让我打开一次。`,
        );
      }
      const installed = outcome.error === null ? await ready() : null;
      if (installed === null)
        throw new ComputerRefusal(
          `浏览器组件下载失败：${oneLine(outcome.error ?? '安装后启动不了')}。请再让我打开一次，会重新下载。`,
        );
      return { provider: providerFor(installed), note: MAC_BROWSER_FIRST_USE_NOTE };
    },
    async installed() {
      const now = await ready();
      return now === null ? null : providerFor(now);
    },
    async killAll() {
      downloadController?.abort('shutdown');
      await Promise.all(
        [...sessions].map(async ([session, provider]) => {
          const events = await provider.execute({
            argv: [AGENT_BROWSER_BINARY, '--session', session, 'close'],
            timeoutMs: CLOSE_TIMEOUT_MS,
            signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
          });
          for await (const _ of events);
        }),
      ).catch(() => {});
      sessions.clear();
      await Promise.all([...providers.values()].map((provider) => provider.killAll()));
    },
  };
}
