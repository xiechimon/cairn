import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { COMPUTER_PRESENCE_LIMIT, type ComputerPresence } from '@cairn/shared';
import { z } from 'zod';
import { AGENT_BROWSER_BINARY, browserSessionName } from './browser.js';
import { executableOnPath } from './contained-spawn.js';
import { HostComputerProvider } from './host.js';
import type { ComputerInputFence, ComputerInputLease } from './input-fence.js';
import type { ComputerPresenceSource } from './presence.js';
import {
  type ComputerProcessEvent,
  type ComputerProvider,
  ComputerRefusal,
  type ScopedComputerProviders,
} from './provider.js';

export const PINNED_AGENT_BROWSER_VERSION = '0.41.2';

export function computerMachineName(scopeKey: string): string {
  if (scopeKey === '') throw new Error('Computer scope key is empty');
  return `cairn-orb-computer-${createHash('sha256').update(scopeKey).digest('hex').slice(0, 40)}`;
}

export const HOST_DESKTOP_PROGRAMS = [
  'systemd-run',
  'dbus-run-session',
  'Xvfb',
  'openbox',
  'picom',
  'plank',
  'hsetroot',
  'x11vnc',
] as const;
export const HOST_DESKTOP_BROWSERS = ['chromium', 'google-chrome-stable'] as const;
export const HOST_DESKTOP_READY_MS = 20_000;
export const HOST_DESKTOP_IDLE_STOP_MS = 10 * 60_000;
const BROWSER_COMMAND_TIMEOUT_MS = 30_000;
const PROFILE_RELEASE_MS = 10_000;
const BROWSER_PROFILE = join('.cairn', 'browser-profile');
export const OMARCHY_WALLPAPER = '.local/state/omarchy/current/background';
const UNIT_PREFIX = 'cairn-desktop-';

const DESKTOP_SCRIPT = `set -euo pipefail
unset WAYLAND_DISPLAY WAYLAND_SOCKET XDG_SESSION_TYPE XDG_CURRENT_DESKTOP XDG_SESSION_DESKTOP XDG_MENU_PREFIX
dir=$1
wallpaper=$2
config=$XDG_CONFIG_HOME
rm -f "$dir/display" "$dir/computer/view.sock" "$dir/computer/vnc.sock"
mkdir -p "$config/gtk-3.0" "$config/openbox" "$config/plank/dock1/launchers"
printf '[Settings]\\ngtk-application-prefer-dark-theme=1\\n' > "$config/gtk-3.0/settings.ini"
sed 's#</applications>#<application class="*" type="normal"><maximized>yes</maximized></application></applications>#' /etc/xdg/openbox/rc.xml > "$config/openbox/rc.xml"
printf '[PlankDockItemPreferences]\\nLauncher=file:///usr/share/applications/chromium.desktop\\n' > "$config/plank/dock1/launchers/chromium.dockitem"
display=
for n in $(seq 90 189); do
  [[ -e /tmp/.X$n-lock || -e /tmp/.X11-unix/X$n ]] && continue
  Xvfb ":$n" -screen 0 1600x1000x24 -nolisten tcp &
  xvfb=$!
  for _ in $(seq 100); do [[ -S /tmp/.X11-unix/X$n ]] && break; kill -0 "$xvfb" 2>/dev/null || break; sleep 0.1; done
  if [[ -S /tmp/.X11-unix/X$n ]] && kill -0 "$xvfb" 2>/dev/null; then display=$n; break; fi
  kill "$xvfb" 2>/dev/null || true
  wait "$xvfb" 2>/dev/null || true
done
[[ -n $display ]] || exit 1
n=$display
export DISPLAY=":$n"
[[ -n $wallpaper ]] && hsetroot -fill "$wallpaper" >/dev/null 2>&1 || hsetroot -solid '#1e1e2e' >/dev/null 2>&1
openbox &
picom &
gsettings set net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/ hide-mode none 2>/dev/null || true
plank &
x11vnc -display "$DISPLAY" -rfbport 0 -unixsock "$dir/computer/vnc.sock" -nopw -forever -shared -quiet &
x11vnc -display "$DISPLAY" -rfbport 0 -unixsock "$dir/computer/view.sock" -viewonly -nopw -forever -shared -quiet &
printf '%s\\n' "$n" > "$dir/display"
wait -n
exit 1
`;

export interface CommandResult {
  code: number;
  stdout: string;
}

export type CommandRunner = (argv: readonly string[]) => Promise<CommandResult>;

const savedLogin = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    }),
  ),
});

const sessionList = z.object({ data: z.object({ sessions: z.array(z.string()) }) });

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function browserCommand(
  provider: HostComputerProvider,
  args: readonly string[],
): Promise<{ code: number | null; text: string }> {
  const events = await provider.execute({
    argv: [AGENT_BROWSER_BINARY, ...args],
    timeoutMs: BROWSER_COMMAND_TIMEOUT_MS,
    signal: new AbortController().signal,
  });
  let text = '';
  let code: number | null = null;
  for await (const event of events) {
    if (event.kind === 'stdout') text += event.text;
    else if (event.kind === 'exit') code = event.code;
  }
  return { code, text: text.trim() };
}

function runCommand(argv: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(argv[0] as string, argv.slice(1), { timeout: 15_000 }, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout) });
    });
  });
}

export interface HostDesktopsOptions {
  root: string;
  toolsRoot: string;
  env?: NodeJS.ProcessEnv;
  run?: CommandRunner;
  inputFence?: ComputerInputFence;
  readyMs?: number;
  idleStopMs?: number;
  now?: () => number;
}

interface Desktop {
  display: string;
  provider: HostComputerProvider;
}

export class HostDesktops implements ScopedComputerProviders, ComputerPresenceSource {
  readonly hostRoot: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly run: CommandRunner;
  private readonly desktops = new Map<string, Desktop>();
  private readonly pending = new Map<string, Promise<Desktop>>();
  private readonly failed = new Set<string>();
  private readonly leases = new Map<string, ComputerInputLease>();
  private readonly listeners = new Set<() => void>();
  private readonly lastUsed = new Map<string, number>();
  private readonly busy = new Map<string, number>();
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly takeovers = new Map<string, number>();
  private readonly handoffs = new Map<string, Promise<void>>();
  private readonly ownerBrowsers = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: HostDesktopsOptions) {
    this.hostRoot = options.root;
    this.env = options.env ?? process.env;
    this.run = options.run ?? runCommand;
    this.now = options.now ?? Date.now;
  }

  private get path(): string | undefined {
    const agentBrowser = join(
      this.options.toolsRoot,
      'agent-browser',
      PINNED_AGENT_BROWSER_VERSION,
      'node_modules',
      '.bin',
    );
    return this.env.PATH ? `${agentBrowser}:${this.env.PATH}` : agentBrowser;
  }

  missingPrograms(): string[] {
    return HOST_DESKTOP_PROGRAMS.filter((name) => !executableOnPath(name, this.env.PATH));
  }

  private browserExecutable(): string | undefined {
    for (const name of HOST_DESKTOP_BROWSERS) {
      const found = executableOnPath(name, this.env.PATH);
      if (found) return found;
    }
    return undefined;
  }

  offersBrowser(): boolean {
    return (
      this.missingPrograms().length === 0 &&
      this.browserExecutable() !== undefined &&
      executableOnPath('agent-browser', this.path) !== undefined
    );
  }

  private wallpaper(): string {
    if (!this.env.HOME) return '';
    const path = join(this.env.HOME, OMARCHY_WALLPAPER);
    return existsSync(path) ? path : '';
  }

  private id(scopeKey: string): string {
    if (scopeKey === '') throw new Error('Computer scope key is empty');
    return createHash('sha256').update(scopeKey).digest('hex').slice(0, 16);
  }

  private directory(scopeKey: string): string {
    return join(this.options.root, this.id(scopeKey));
  }

  private ownerUnit(scopeKey: string): string {
    return `${UNIT_PREFIX}${this.id(scopeKey)}-browser.service`;
  }

  private homeEnv(home: string): string[] {
    return [
      `--setenv=PATH=${this.env.PATH ?? ''}`,
      `--setenv=HOME=${home}`,
      `--setenv=XDG_CONFIG_HOME=${join(home, '.config')}`,
      `--setenv=XDG_DATA_HOME=${join(home, '.local', 'share')}`,
      `--setenv=XDG_CACHE_HOME=${join(home, '.cache')}`,
      `--setenv=XDG_STATE_HOME=${join(home, '.local', 'state')}`,
    ];
  }

  socketPath(scopeKey: string, kind: 'view' | 'control'): string {
    return join(this.directory(scopeKey), 'computer', kind === 'view' ? 'view.sock' : 'vnc.sock');
  }

  private ready(directory: string): string | undefined {
    try {
      const display = readFileSync(join(directory, 'display'), 'utf8').trim();
      const sockets = ['view.sock', 'vnc.sock'].every((name) =>
        lstatSync(join(directory, 'computer', name)).isSocket(),
      );
      return display !== '' && sockets ? `:${display}` : undefined;
    } catch {
      return undefined;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  async ensure(scopeKey: string): Promise<string> {
    return (await this.desktop(scopeKey)).display;
  }

  async hold(scopeKey: string, kind: 'view' | 'control' = 'view'): Promise<() => void> {
    this.enter(scopeKey);
    try {
      await this.desktop(scopeKey);
      if (kind === 'control') await this.takeOver(scopeKey);
    } catch (error) {
      this.leave(scopeKey);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (kind === 'control') this.handBack(scopeKey);
      this.leave(scopeKey);
    };
  }

  private handoff(scopeKey: string, step: () => Promise<void>): Promise<void> {
    const next = (this.handoffs.get(scopeKey) ?? Promise.resolve()).then(step);
    this.handoffs.set(
      scopeKey,
      next.catch(() => {}),
    );
    return next;
  }

  private async takeOver(scopeKey: string): Promise<void> {
    const count = this.takeovers.get(scopeKey) ?? 0;
    this.takeovers.set(scopeKey, count + 1);
    try {
      await (count === 0
        ? this.handoff(scopeKey, () => this.openOwnerBrowser(scopeKey))
        : this.handoffs.get(scopeKey));
    } catch (error) {
      this.handBack(scopeKey);
      throw error;
    }
  }

  private handBack(scopeKey: string): void {
    const count = (this.takeovers.get(scopeKey) ?? 1) - 1;
    if (count > 0) this.takeovers.set(scopeKey, count);
    else this.takeovers.delete(scopeKey);
  }

  private closeOwnerBrowser(scopeKey: string): Promise<void> {
    if (!this.ownerBrowsers.has(scopeKey)) return this.handoffs.get(scopeKey) ?? Promise.resolve();
    return this.handoff(scopeKey, async () => {
      if (this.takeovers.has(scopeKey) || !this.ownerBrowsers.has(scopeKey)) return;
      await this.run(['systemctl', '--user', 'stop', this.ownerUnit(scopeKey)]);
      this.ownerBrowsers.delete(scopeKey);
    });
  }

  private async openOwnerBrowser(scopeKey: string): Promise<void> {
    const unit = this.ownerUnit(scopeKey);
    if (
      this.ownerBrowsers.has(scopeKey) &&
      (await this.run(['systemctl', '--user', 'is-active', unit])).code === 0
    )
      return;
    const desktop = await this.desktop(scopeKey);
    const session = browserSessionName(scopeKey);
    let url: string | undefined;
    const listed = await browserCommand(desktop.provider, ['--json', 'session', 'list'])
      .then(({ text }) => sessionList.safeParse(JSON.parse(text)))
      .catch(() => undefined);
    if (listed?.success && listed.data.data.sessions.includes(session)) {
      const current = await browserCommand(desktop.provider, ['--session', session, 'get', 'url']);
      const last = current.text.split('\n').at(-1)?.trim() ?? '';
      if (/^https?:\/\//i.test(last)) url = last;
      await browserCommand(desktop.provider, ['--session', session, 'close']);
    }
    const directory = this.directory(scopeKey);
    const home = join(directory, 'home');
    const profile = join(home, BROWSER_PROFILE);
    await this.profileReleased(profile);
    const browser = this.browserExecutable();
    if (browser === undefined) throw new ComputerRefusal('This machine has no Chromium installed');
    await this.run(['systemctl', '--user', 'stop', unit]);
    await this.run(['systemctl', '--user', 'reset-failed', unit]);
    const proxy =
      this.env.https_proxy || this.env.HTTPS_PROXY || this.env.http_proxy || this.env.HTTP_PROXY;
    const started = await this.run([
      'systemd-run',
      '--user',
      '--collect',
      `--unit=${unit}`,
      `--property=BindsTo=${UNIT_PREFIX}${this.id(scopeKey)}.service`,
      ...this.homeEnv(home),
      `--setenv=DISPLAY=${desktop.display}`,
      '--',
      'env',
      '-u',
      'WAYLAND_DISPLAY',
      '-u',
      'WAYLAND_SOCKET',
      browser,
      `--user-data-dir=${profile}`,
      '--ozone-platform=x11',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      ...(proxy ? [`--proxy-server=${proxy}`] : []),
      url ?? '--restore-last-session',
    ]);
    if (started.code !== 0) throw new ComputerRefusal('The owner browser could not be started');
    this.ownerBrowsers.add(scopeKey);
  }

  private async profileReleased(profile: string): Promise<void> {
    const deadline = this.now() + PROFILE_RELEASE_MS;
    for (;;) {
      let owner: string;
      try {
        owner = readlinkSync(join(profile, 'SingletonLock'));
      } catch {
        return;
      }
      const pid = Number(owner.slice(owner.lastIndexOf('-') + 1));
      if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return;
      if (this.now() >= deadline) throw new ComputerRefusal('The agent browser did not close');
      await sleep(100);
    }
  }

  private async importSavedLogin(scopeKey: string, home: string, provider: HostComputerProvider) {
    const session = browserSessionName(scopeKey);
    const saved = join(home, '.agent-browser', 'sessions', `${session}-${session}.json`);
    if (!existsSync(saved)) return;
    const parsed = savedLogin.safeParse(JSON.parse(readFileSync(saved, 'utf8')));
    for (const cookie of parsed.success ? parsed.data.cookies : []) {
      if (cookie.name === '') continue;
      await browserCommand(provider, [
        '--session',
        session,
        'cookies',
        'set',
        cookie.name,
        cookie.value,
        '--domain',
        cookie.domain,
        '--path',
        cookie.path,
        ...(cookie.httpOnly ? ['--http-only'] : []),
        ...(cookie.secure ? ['--secure'] : []),
        ...(cookie.sameSite ? ['--same-site', cookie.sameSite] : []),
        ...(cookie.expires !== undefined && cookie.expires > 0
          ? ['--expires', String(Math.floor(cookie.expires))]
          : []),
      ]);
    }
    await browserCommand(provider, ['--session', session, 'close']);
    renameSync(saved, `${saved}.imported`);
  }

  private enter(scopeKey: string): void {
    this.busy.set(scopeKey, (this.busy.get(scopeKey) ?? 0) + 1);
    this.lastUsed.set(scopeKey, this.now());
  }

  private leave(scopeKey: string): void {
    const count = (this.busy.get(scopeKey) ?? 1) - 1;
    if (count > 0) this.busy.set(scopeKey, count);
    else this.busy.delete(scopeKey);
    this.lastUsed.set(scopeKey, this.now());
  }

  private async using<T>(scopeKey: string, run: () => Promise<T>): Promise<T> {
    this.enter(scopeKey);
    try {
      return await run();
    } finally {
      this.leave(scopeKey);
    }
  }

  private desktop(scopeKey: string): Promise<Desktop> {
    const running = this.pending.get(scopeKey);
    if (running) return running;
    this.failed.delete(scopeKey);
    const operation = (this.stopping.get(scopeKey) ?? Promise.resolve())
      .then(() => this.start(scopeKey))
      .then(
        (desktop) => {
          this.pending.delete(scopeKey);
          this.notify();
          return desktop;
        },
        (error: unknown) => {
          this.pending.delete(scopeKey);
          this.failed.add(scopeKey);
          this.notify();
          throw error;
        },
      );
    this.pending.set(scopeKey, operation);
    this.notify();
    return operation;
  }

  private async start(scopeKey: string): Promise<Desktop> {
    const missing = this.missingPrograms();
    if (missing.length > 0)
      throw new ComputerRefusal(
        `The host desktop needs ${missing.join(', ')} installed on this machine`,
      );
    if (this.options.inputFence && !this.leases.has(scopeKey)) {
      try {
        this.leases.set(scopeKey, await this.options.inputFence.acquire(scopeKey));
      } catch (error) {
        throw new ComputerRefusal(error instanceof Error ? error.message : String(error));
      }
    }
    const directory = this.directory(scopeKey);
    const home = join(directory, 'home');
    for (const path of [this.options.root, directory, join(directory, 'computer'), home])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, 'scope'), scopeKey, { mode: 0o600 });
    const unit = `${UNIT_PREFIX}${this.id(scopeKey)}.service`;
    const active = (await this.run(['systemctl', '--user', 'is-active', unit])).code === 0;
    let display = active ? this.ready(directory) : undefined;
    if (display === undefined) {
      await this.run(['systemctl', '--user', 'stop', unit]);
      await this.run(['systemctl', '--user', 'reset-failed', unit]);
      const started = await this.run([
        'systemd-run',
        '--user',
        '--collect',
        `--unit=${unit}`,
        ...this.homeEnv(home),
        '--',
        'dbus-run-session',
        '--',
        'bash',
        '-c',
        DESKTOP_SCRIPT,
        'cairn-desktop',
        directory,
        this.wallpaper(),
      ]);
      if (started.code !== 0) throw new ComputerRefusal('The host desktop could not be started');
      const deadline = Date.now() + (this.options.readyMs ?? HOST_DESKTOP_READY_MS);
      display = this.ready(directory);
      while (display === undefined) {
        if (Date.now() >= deadline) {
          await this.run(['systemctl', '--user', 'stop', unit]);
          throw new ComputerRefusal('The host desktop did not become ready');
        }
        await sleep(100);
        display = this.ready(directory);
      }
    }
    const current = this.desktops.get(scopeKey);
    if (current?.display === display) return current;
    const desktop = { display, provider: this.provider(home, display) };
    if (!this.takeovers.has(scopeKey)) {
      await this.run(['systemctl', '--user', 'stop', this.ownerUnit(scopeKey)]);
      this.ownerBrowsers.delete(scopeKey);
    }
    const socketDirectory = join(home, '.agent-browser');
    mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
    chmodSync(socketDirectory, 0o700);
    const profile = join(home, BROWSER_PROFILE);
    if (lstatSync(join(profile, 'SingletonLock'), { throwIfNoEntry: false }))
      await browserCommand(desktop.provider, ['--session', browserSessionName(scopeKey), 'close']);
    await this.profileReleased(profile);
    const preferencesPath = join(profile, 'Default', 'Preferences');
    const preferences = existsSync(preferencesPath)
      ? (JSON.parse(readFileSync(preferencesPath, 'utf8')) as Record<string, unknown>)
      : {};
    mkdirSync(join(profile, 'Default'), { recursive: true, mode: 0o700 });
    writeFileSync(
      preferencesPath,
      JSON.stringify({
        ...preferences,
        credentials_enable_service: false,
        profile: {
          ...(preferences.profile as Record<string, unknown> | undefined),
          password_manager_enabled: false,
        },
      }),
      { mode: 0o600 },
    );
    await this.importSavedLogin(scopeKey, home, desktop.provider).catch(() => {});
    this.desktops.set(scopeKey, desktop);
    return desktop;
  }

  private provider(home: string, display: string): HostComputerProvider {
    const { WAYLAND_DISPLAY: _wayland, SSH_AUTH_SOCK: _agent, ...inherited } = this.env;
    return new HostComputerProvider({
      home,
      env: {
        ...inherited,
        HOME: home,
        DISPLAY: display,
        PATH: this.path,
        AGENT_BROWSER_EXECUTABLE_PATH: this.browserExecutable(),
        AGENT_BROWSER_NO_VERSION_CHECK: '1',
        AGENT_BROWSER_PROFILE: join(home, BROWSER_PROFILE),
        AGENT_BROWSER_SOCKET_DIR: '.agent-browser',
        AGENT_BROWSER_ARGS: '--hide-crash-restore-bubble',
      },
    });
  }

  forScope(scopeKey: string): ComputerProvider {
    const provider = async () => (await this.desktop(scopeKey)).provider;
    const leave = () => this.leave(scopeKey);
    return {
      execute: async (request) => {
        if (this.takeovers.has(scopeKey) && request.argv[0] === AGENT_BROWSER_BINARY)
          throw new ComputerRefusal(
            'The owner has taken over this browser; wait until they hand it back',
          );
        this.enter(scopeKey);
        let events: AsyncIterable<ComputerProcessEvent>;
        try {
          if (request.argv[0] === AGENT_BROWSER_BINARY) await this.closeOwnerBrowser(scopeKey);
          else await this.handoffs.get(scopeKey);
          events = await (await provider()).execute(request);
        } catch (error) {
          leave();
          throw error;
        }
        return (async function* () {
          try {
            yield* events;
          } finally {
            leave();
          }
        })();
      },
      listFiles: (path) => this.using(scopeKey, async () => (await provider()).listFiles(path)),
      readFile: (path) => this.using(scopeKey, async () => (await provider()).readFile(path)),
      writeFile: (path, content) =>
        this.using(scopeKey, async () => (await provider()).writeFile(path, content)),
      killAll: async () => this.desktops.get(scopeKey)?.provider.killAll(),
    };
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.desktops.values()].map((desktop) => desktop.provider.killAll()));
  }

  private known(): { scopeKey: string; unit: string }[] {
    if (!existsSync(this.options.root)) return [];
    return readdirSync(this.options.root).flatMap((name) => {
      try {
        const scopeKey = readFileSync(join(this.options.root, name, 'scope'), 'utf8');
        return scopeKey === '' ? [] : [{ scopeKey, unit: `${UNIT_PREFIX}${name}.service` }];
      } catch {
        return [];
      }
    });
  }

  async sweep(): Promise<void> {
    const idleMs = this.options.idleStopMs ?? HOST_DESKTOP_IDLE_STOP_MS;
    for (const { scopeKey, unit } of this.known()) {
      const now = this.now();
      if (!this.lastUsed.has(scopeKey)) this.lastUsed.set(scopeKey, now);
      if (!this.idle(scopeKey, now, idleMs)) continue;
      if ((await this.run(['systemctl', '--user', 'is-active', unit])).code !== 0) continue;
      if (!this.idle(scopeKey, this.now(), idleMs)) continue;
      const stop = this.stop(scopeKey, unit).finally(() => {
        this.stopping.delete(scopeKey);
        this.notify();
      });
      this.stopping.set(scopeKey, stop);
      await stop;
    }
  }

  private idle(scopeKey: string, now: number, idleMs: number): boolean {
    return (
      !this.busy.has(scopeKey) &&
      !this.pending.has(scopeKey) &&
      !this.stopping.has(scopeKey) &&
      now - (this.lastUsed.get(scopeKey) ?? now) >= idleMs
    );
  }

  private async stop(scopeKey: string, unit: string): Promise<void> {
    const directory = this.directory(scopeKey);
    const provider =
      this.desktops.get(scopeKey)?.provider ??
      this.provider(join(directory, 'home'), this.ready(directory) ?? '');
    await browserCommand(provider, ['--session', browserSessionName(scopeKey), 'close']).catch(
      () => {},
    );
    await provider.killAll();
    this.ownerBrowsers.delete(scopeKey);
    this.desktops.delete(scopeKey);
    this.lastUsed.delete(scopeKey);
    await this.run(['systemctl', '--user', 'stop', unit]);
  }

  async presence(): Promise<ComputerPresence[]> {
    const known = this.known();
    known.splice(COMPUTER_PRESENCE_LIMIT);
    if (known.length === 0) return [];
    const states = (
      await this.run(['systemctl', '--user', 'is-active', ...known.map((entry) => entry.unit)])
    ).stdout.split('\n');
    return known.map(({ scopeKey }, index) => ({
      scopeKey,
      providerRef: computerMachineName(scopeKey),
      state: this.pending.has(scopeKey)
        ? 'starting'
        : this.failed.has(scopeKey)
          ? 'failed'
          : states[index]?.trim() === 'active'
            ? 'running'
            : 'stopped',
    }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
  }
}
