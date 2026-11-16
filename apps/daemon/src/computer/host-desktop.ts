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
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { COMPUTER_PRESENCE_LIMIT, type ComputerPresence } from '@cairn/shared';
import { z } from 'zod';
import { AGENT_BROWSER_BINARY, browserSessionName } from './browser.js';
import { CloakBrowser, shellQuote, writeCloakLauncher } from './cloak-browser.js';
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
export const HOST_BROWSER_PROGRAMS = ['xdotool'] as const;
export const HOST_DESKTOP_READY_MS = 20_000;
export const HOST_BROWSER_READY_MS = 10_000;
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

export type CommandRunner = (
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
) => Promise<CommandResult>;

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

function runCommand(argv: readonly string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      argv[0] as string,
      argv.slice(1),
      { timeout: 15_000, env: env ? { ...process.env, ...env } : process.env },
      (error, stdout) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout) });
      },
    );
  });
}

function desktopEntry(starter: string): string {
  const escaped = starter
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('`', '\\`')
    .replaceAll('$', '\\$')
    .replaceAll('%', '%%');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Cairn Cloak Browser',
    `Exec="${escaped}"`,
    'Icon=web-browser',
    'Terminal=false',
    '',
  ].join('\n');
}

export interface HostDesktopsOptions {
  root: string;
  toolsRoot: string;
  env?: NodeJS.ProcessEnv;
  run?: CommandRunner;
  inputFence?: ComputerInputFence;
  readyMs?: number;
  browserReadyMs?: number;
  idleStopMs?: number;
  now?: () => number;
  browser?: CloakBrowser;
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
  private readonly now: () => number;
  private readonly browser: CloakBrowser;

  constructor(private readonly options: HostDesktopsOptions) {
    this.hostRoot = options.root;
    this.env = options.env ?? process.env;
    this.run = options.run ?? runCommand;
    this.now = options.now ?? Date.now;
    this.browser = options.browser ?? new CloakBrowser(this.env);
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

  private missingBrowserPrograms(): string[] {
    return HOST_BROWSER_PROGRAMS.filter((name) => !executableOnPath(name, this.env.PATH));
  }

  async prepareBrowser(): Promise<string> {
    const missing = this.missingBrowserPrograms();
    if (missing.length > 0)
      throw new ComputerRefusal(
        `The browser needs ${missing.join(', ')} installed on this machine`,
      );
    await this.browser.prepare();
    return this.browser.version ?? 'unknown';
  }

  offersBrowser(): boolean {
    return (
      this.missingPrograms().length === 0 &&
      this.missingBrowserPrograms().length === 0 &&
      this.browser.ready &&
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
        ? this.handoff(scopeKey, async () => {
            if (this.offersBrowser()) await this.openOwnerBrowser(scopeKey);
          })
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

  private manualActive(scopeKey: string): Promise<boolean> {
    return this.run(['systemctl', '--user', 'is-active', this.ownerUnit(scopeKey)]).then(
      ({ code }) => code === 0,
    );
  }

  private closeOwnerBrowser(scopeKey: string): Promise<void> {
    return this.handoff(scopeKey, async () => {
      if (!this.takeovers.has(scopeKey)) await this.quitManualBrowser(scopeKey);
    });
  }

  private async quitManualBrowser(scopeKey: string): Promise<void> {
    if (!(await this.manualActive(scopeKey))) return;
    const unit = this.ownerUnit(scopeKey);
    const refuse = () => new ComputerRefusal('The owner browser did not close');
    const directory = this.directory(scopeKey);
    const display = readFileSync(join(directory, 'display'), 'utf8').trim();
    const shown = await this.run([
      'systemctl',
      '--user',
      'show',
      '--property=MainPID',
      '--value',
      unit,
    ]);
    const pid = Number(shown.stdout.trim());
    if (shown.code !== 0 || !Number.isInteger(pid) || pid <= 0) throw refuse();
    const env = { DISPLAY: `:${display}` };
    const found = await this.run(['xdotool', 'search', '--onlyvisible', '--pid', String(pid)], env);
    const windows = found.stdout
      .split('\n')
      .filter((line) => /^(0x[0-9a-f]+|\d+)$/i.test(line.trim()));
    if (found.code !== 0 || windows.length === 0) throw refuse();
    for (const window of windows)
      if ((await this.run(['xdotool', 'windowquit', window.trim()], env)).code !== 0)
        throw refuse();
    const deadline = this.now() + PROFILE_RELEASE_MS;
    while (await this.manualActive(scopeKey)) {
      if (this.now() >= deadline) throw refuse();
      await sleep(100);
    }
    await this.profileReleased(join(directory, 'home', BROWSER_PROFILE));
  }

  private async startManualBrowser(scopeKey: string, url?: string): Promise<void> {
    const started = await this.run([
      join(this.directory(scopeKey), 'cloak-manual'),
      ...(url ? [url] : []),
    ]);
    if (started.code !== 0) throw new ComputerRefusal('The owner browser could not be started');
  }

  private async openOwnerBrowser(scopeKey: string): Promise<void> {
    if (await this.manualActive(scopeKey)) return this.startManualBrowser(scopeKey);
    const desktop = await this.desktop(scopeKey);
    if (await this.manualActive(scopeKey)) return this.startManualBrowser(scopeKey);
    const session = browserSessionName(scopeKey);
    let url: string | undefined;
    const listed = await browserCommand(desktop.provider, ['--json', 'session', 'list'])
      .then(({ code, text }) => (code === 0 ? sessionList.safeParse(JSON.parse(text)) : undefined))
      .catch(() => undefined);
    if (!listed?.success)
      throw new ComputerRefusal('The agent browser session could not be checked');
    if (listed.data.data.sessions.includes(session)) {
      const current = await browserCommand(desktop.provider, ['--session', session, 'get', 'url']);
      const last = current.text.split('\n').at(-1)?.trim() ?? '';
      if (/^https?:\/\//i.test(last)) url = last;
      const closed = await browserCommand(desktop.provider, ['--session', session, 'close']);
      if (closed.code !== 0) throw new ComputerRefusal('The agent browser did not close');
    }
    const directory = this.directory(scopeKey);
    const profile = join(directory, 'home', BROWSER_PROFILE);
    await this.profileReleased(profile);
    await writeCloakLauncher(directory, profile, this.browser, this.proxy());
    await this.startManualBrowser(scopeKey, url);
  }

  private async profileReleased(profile: string): Promise<void> {
    const deadline = this.now() + PROFILE_RELEASE_MS;
    for (;;) {
      let owner: string;
      try {
        owner = readlinkSync(join(profile, 'SingletonLock'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw new ComputerRefusal('The browser profile lock cannot be checked');
      }
      const pid = Number(owner.slice(owner.lastIndexOf('-') + 1));
      if (!Number.isInteger(pid) || pid <= 0)
        throw new ComputerRefusal('The browser profile lock is invalid');
      if (!processAlive(pid)) return;
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
    const closed = await browserCommand(provider, ['--session', session, 'close']);
    if (closed.code !== 0) throw new ComputerRefusal('The imported browser did not close');
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
    const dock = join(home, '.config', 'plank', 'dock1', 'launchers');
    mkdirSync(dock, { recursive: true, mode: 0o700 });
    rmSync(join(dock, 'chromium.dockitem'), { force: true });
    const launcherReady =
      this.offersBrowser() &&
      (await writeCloakLauncher(
        directory,
        join(home, BROWSER_PROFILE),
        this.browser,
        this.proxy(),
      ).then(
        () => true,
        () => false,
      ));
    const starter = join(directory, 'cloak-manual');
    const entry = join(directory, 'cloak-browser.desktop');
    if (launcherReady) {
      writeFileSync(starter, this.manualStarter(scopeKey, directory, home), { mode: 0o700 });
      writeFileSync(entry, desktopEntry(starter), { mode: 0o600 });
      writeFileSync(
        join(dock, 'cloak-browser.dockitem'),
        `[PlankDockItemPreferences]\nLauncher=file://${entry}\n`,
        { mode: 0o600 },
      );
    } else {
      for (const file of [
        join(directory, 'cloak-browser'),
        starter,
        entry,
        join(dock, 'cloak-browser.dockitem'),
      ])
        rmSync(file, { force: true });
    }
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
    const socketDirectory = join(home, '.agent-browser');
    mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
    chmodSync(socketDirectory, 0o700);
    if (!(await this.manualActive(scopeKey))) {
      const profile = join(home, BROWSER_PROFILE);
      const locked = lstatSync(join(profile, 'SingletonLock'), { throwIfNoEntry: false });
      if (this.offersBrowser() || !locked) {
        if (locked)
          await browserCommand(desktop.provider, [
            '--session',
            browserSessionName(scopeKey),
            'close',
          ]);
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
      }
    }
    this.desktops.set(scopeKey, desktop);
    return desktop;
  }

  private manualStarter(scopeKey: string, directory: string, home: string): string {
    const unit = this.ownerUnit(scopeKey);
    const run = [
      'systemd-run --user --collect',
      `--unit=${unit}`,
      `--property=BindsTo=${UNIT_PREFIX}${this.id(scopeKey)}.service`,
      ...this.homeEnv(home).map(shellQuote),
      '"--setenv=DISPLAY=:$display"',
      '-- env -u WAYLAND_DISPLAY -u WAYLAND_SOCKET',
      shellQuote(join(directory, 'cloak-browser')),
      '"$@"',
    ].join(' ');
    return [
      '#!/bin/bash',
      'set -euo pipefail',
      'unset DBUS_SESSION_BUS_ADDRESS',
      `display=$(< ${shellQuote(join(directory, 'display'))})`,
      `unit=${shellQuote(unit)}`,
      'export DISPLAY=":$display"',
      `systemctl --user --quiet is-active "$unit" || ${run} || true`,
      `for _ in $(seq ${Math.ceil((this.options.browserReadyMs ?? HOST_BROWSER_READY_MS) / 100)}); do`,
      '  systemctl --user --quiet is-active "$unit" || exit 1',
      '  pid=$(systemctl --user show --property=MainPID --value "$unit")',
      '  if [[ $pid =~ ^[1-9][0-9]*$ ]] && xdotool search --onlyvisible --pid "$pid" >/dev/null 2>&1; then exit 0; fi',
      '  sleep 0.1',
      'done',
      'exit 1',
      '',
    ].join('\n');
  }

  private proxy(): string | undefined {
    return (
      this.env.https_proxy || this.env.HTTPS_PROXY || this.env.http_proxy || this.env.HTTP_PROXY
    );
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
        AGENT_BROWSER_SOCKET_DIR: '.agent-browser',
      },
      browserEnvironment: async () => {
        const profile = join(home, BROWSER_PROFILE);
        const launch = await this.browser.launch(profile);
        return {
          ...launch.env,
          AGENT_BROWSER_EXECUTABLE_PATH: launch.executable,
          AGENT_BROWSER_NO_VERSION_CHECK: '1',
          AGENT_BROWSER_PROFILE: profile,
          AGENT_BROWSER_ARGS: [
            ...launch.args,
            ...(this.proxy() ? [`--proxy-server=${this.proxy()}`] : []),
          ].join(','),
        };
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
          const current = await provider();
          if (request.argv[0] === AGENT_BROWSER_BINARY) {
            await this.closeOwnerBrowser(scopeKey);
            await this.importSavedLogin(scopeKey, join(this.directory(scopeKey), 'home'), current);
          } else await this.handoffs.get(scopeKey);
          events = await current.execute(request);
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
    let failure: unknown;
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
      await stop.catch((error: unknown) => {
        failure ??= error;
      });
    }
    if (failure !== undefined) throw failure;
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
    await this.handoff(scopeKey, () => this.quitManualBrowser(scopeKey));
    const directory = this.directory(scopeKey);
    const provider =
      this.desktops.get(scopeKey)?.provider ??
      this.provider(join(directory, 'home'), this.ready(directory) ?? '');
    await browserCommand(provider, ['--session', browserSessionName(scopeKey), 'close']).catch(
      () => {},
    );
    await provider.killAll();
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
