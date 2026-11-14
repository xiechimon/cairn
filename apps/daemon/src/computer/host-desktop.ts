import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { COMPUTER_PRESENCE_LIMIT, type ComputerPresence } from '@cairn/shared';
import { PINNED_AGENT_BROWSER_VERSION } from '../orb/computer.js';
import { executableOnPath } from './contained-spawn.js';
import { HostComputerProvider } from './host.js';
import type { ComputerInputFence, ComputerInputLease } from './input-fence.js';
import type { ComputerPresenceSource } from './presence.js';
import {
  type ComputerProvider,
  ComputerRefusal,
  type ScopedComputerProviders,
} from './provider.js';

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
}

interface Desktop {
  display: string;
  provider: HostComputerProvider;
}

export class HostDesktops implements ScopedComputerProviders, ComputerPresenceSource {
  readonly onHost = true;
  private readonly env: NodeJS.ProcessEnv;
  private readonly run: CommandRunner;
  private readonly desktops = new Map<string, Desktop>();
  private readonly pending = new Map<string, Promise<Desktop>>();
  private readonly failed = new Set<string>();
  private readonly leases = new Map<string, ComputerInputLease>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: HostDesktopsOptions) {
    this.env = options.env ?? process.env;
    this.run = options.run ?? runCommand;
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

  private desktop(scopeKey: string): Promise<Desktop> {
    const running = this.pending.get(scopeKey);
    if (running) return running;
    this.failed.delete(scopeKey);
    const operation = this.start(scopeKey).then(
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
        `--setenv=PATH=${this.env.PATH ?? ''}`,
        `--setenv=HOME=${home}`,
        `--setenv=XDG_CONFIG_HOME=${join(home, '.config')}`,
        `--setenv=XDG_DATA_HOME=${join(home, '.local', 'share')}`,
        `--setenv=XDG_CACHE_HOME=${join(home, '.cache')}`,
        `--setenv=XDG_STATE_HOME=${join(home, '.local', 'state')}`,
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
    const { WAYLAND_DISPLAY: _wayland, SSH_AUTH_SOCK: _agent, ...inherited } = this.env;
    const desktop = {
      display,
      provider: new HostComputerProvider({
        home,
        env: {
          ...inherited,
          HOME: home,
          DISPLAY: display,
          PATH: this.path,
          AGENT_BROWSER_EXECUTABLE_PATH: this.browserExecutable(),
          AGENT_BROWSER_NO_VERSION_CHECK: '1',
        },
      }),
    };
    this.desktops.set(scopeKey, desktop);
    return desktop;
  }

  forScope(scopeKey: string): ComputerProvider {
    const provider = async () => (await this.desktop(scopeKey)).provider;
    return {
      execute: async (request) => (await provider()).execute(request),
      listFiles: async (path) => (await provider()).listFiles(path),
      readFile: async (path) => (await provider()).readFile(path),
      writeFile: async (path, content) => (await provider()).writeFile(path, content),
      killAll: async () => this.desktops.get(scopeKey)?.provider.killAll(),
    };
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.desktops.values()].map((desktop) => desktop.provider.killAll()));
  }

  async presence(): Promise<ComputerPresence[]> {
    if (!existsSync(this.options.root)) return [];
    const known = readdirSync(this.options.root).flatMap((name) => {
      try {
        const scopeKey = readFileSync(join(this.options.root, name, 'scope'), 'utf8');
        return scopeKey === '' ? [] : [{ scopeKey, unit: `${UNIT_PREFIX}${name}.service` }];
      } catch {
        return [];
      }
    });
    known.splice(COMPUTER_PRESENCE_LIMIT);
    if (known.length === 0) return [];
    const states = (
      await this.run(['systemctl', '--user', 'is-active', ...known.map((entry) => entry.unit)])
    ).stdout.split('\n');
    return known.map(({ scopeKey, unit }, index) => ({
      scopeKey,
      providerRef: unit,
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
