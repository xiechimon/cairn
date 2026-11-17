import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { totalmem } from 'node:os';
import { join, posix } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  COMPUTER_PRESENCE_LIMIT,
  type ComputerManageAction,
  type ComputerManageOutcome,
  type ComputerPresence,
  debianPackageNamesSchema,
  INSTALL_PACKAGES_TIMEOUT_MS,
} from '@cairn/shared';
import { z } from 'zod';
import { AGENT_BROWSER_BINARY, browserSessionName, isStealthBrowserCommand } from './browser.js';
import { resolveHostBrowserLocaleAndTimezone } from './cloak-browser.js';
import type { ComputerDesktops, ComputerHoldUse } from './desktops.js';
import { AsyncEventQueue, HOST_MAX_FILE_BYTES } from './host.js';
import { HOST_DESKTOP_IDLE_STOP_MS } from './host-desktop.js';
import type { ComputerInputFence, ComputerInputLease } from './input-fence.js';
import {
  type ComputerExecuteRequest,
  type ComputerFileEntry,
  type ComputerPackageInstallOptions,
  type ComputerProcessEvent,
  type ComputerProvider,
  ComputerRefusal,
  type ComputerScopeGrant,
} from './provider.js';
import { COMPUTER_IMAGE_MANIFEST, runVmCommand, type VmCommandRunner } from './vm-runtime.js';

export const COMPUTER_IMAGE_ENV = 'CAIRN_COMPUTER_IMAGE';
export const NO_CLOAK_LICENSE = 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY';
export const VM_DESKTOP_READY_MS = 30_000;
export const VM_HOME = '/home/agent';
export const VM_CONTROL_PORT = 5900;
export const VM_VIEW_PORT = 5901;
const VM_USER = '1000';
const GIB = 1024 ** 3;
const VM_MEMORY_MIN_GIB = 3;
const VM_MEMORY_MAX_GIB = 8;
const VM_MEMORY_HOST_SHARE = 0.25;

export function vmMemoryFlag(hostBytes: number): string {
  const quarter = Math.floor((hostBytes * VM_MEMORY_HOST_SHARE) / GIB);
  return `${Math.min(VM_MEMORY_MAX_GIB, Math.max(VM_MEMORY_MIN_GIB, quarter))}g`;
}
const SCOPE_LABEL = 'cairn.scope';
const VM_ROOT = '0';
const VM_DELETE_MS = 60_000;
const ROOT_KILL_GRACE_SECONDS = 5;

export const PACKAGE_INSTALL_SCRIPT = [
  'mkdir -p /var/lib/apt/lists/partial /var/cache/apt/archives/partial',
  'chown 0:0 /var/lib/apt/lists/partial /var/cache/apt/archives/partial',
  'chown -R 0:0 /var/lib/apt/lists /var/cache/apt/archives',
  'apt-get -o APT::Sandbox::User=root update && apt-get -o APT::Sandbox::User=root install -y --no-install-recommends -- "$@"',
]
  .join(' && ')
  .concat(
    '; status=$?; find / -xdev -type f -perm /6000 -exec chmod a-s {} + 2>/dev/null; exit $status',
  );
const BROWSER_COMMAND_MS = 60_000;
const KILL_GRACE_MS = 1_000;

const FILES_SCRIPT = `
const fs = require('fs');
const path = require('path');
const [op, requested, limitText] = process.argv.slice(1);
const limit = Number(limitText);
const home = fs.realpathSync('${VM_HOME}');
const inside = (target) => target === home || target.startsWith(home + '/');
const refuse = (message) => { process.stdout.write(JSON.stringify({ refused: message })); process.exit(0); };
const text = (requested || '').trim();
const expanded = text === '' || text === '~' ? home : text.startsWith('~/') ? path.join(home, text.slice(2)) : text;
const resolved = path.resolve(home, expanded);
if (!inside(resolved)) refuse('path must be inside the home folder');
let existing = resolved;
const missing = [];
for (;;) {
  try { existing = fs.realpathSync(existing); break; } catch (error) {
    const parent = path.dirname(existing);
    if (error.code !== 'ENOENT' || parent === existing) refuse('path cannot be resolved');
    missing.unshift(path.basename(existing));
    existing = parent;
  }
}
if (!inside(existing)) refuse('path resolves outside the home folder');
const target = path.join(existing, ...missing);
if (op === 'list') {
  const entries = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    let real;
    try { real = fs.realpathSync(child); } catch { continue; }
    if (!inside(real)) continue;
    const info = fs.statSync(real);
    entries.push({ path: path.relative(home, child), kind: info.isDirectory() ? 'dir' : 'file', size: info.size, executable: info.isFile() && (info.mode & 0o100) !== 0 });
  }
  process.stdout.write(JSON.stringify({ entries }));
} else if (op === 'read') {
  let info;
  try { info = fs.statSync(target); } catch { refuse('file not found'); }
  if (!info.isFile()) refuse('path is not a regular file');
  if (info.size > limit) refuse('file exceeds ' + limit + ' bytes');
  process.stdout.write(JSON.stringify({ data: fs.readFileSync(target).toString('base64') }));
} else if (op === 'write') {
  if (target === home) refuse('path is the home folder');
  let existingInfo;
  try { existingInfo = fs.lstatSync(target); } catch {}
  if (existingInfo && !existingInfo.isFile()) refuse('path is not a regular file');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!inside(fs.realpathSync(path.dirname(target)))) refuse('path resolves outside the home folder');
  const temporary = path.join(path.dirname(target), '.cairn-write-' + process.pid + '-' + Date.now());
  fs.writeFileSync(temporary, fs.readFileSync(0), { flag: 'wx', mode: existingInfo ? existingInfo.mode & 0o777 : 0o600 });
  fs.renameSync(temporary, target);
  process.stdout.write(JSON.stringify({ written: true }));
}
`;

const KILL_SCRIPT =
  'for e in /proc/[0-9]*/environ; do if grep -qzx "CAIRN_COMPUTER_MARKER=$1" "$e" 2>/dev/null; then kill -KILL "$(basename "$(dirname "$e")")" 2>/dev/null; fi; done; exit 0';

const filesResultSchema = z.union([
  z.object({ refused: z.string() }),
  z.object({
    entries: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(['file', 'dir']),
        size: z.number(),
        executable: z.boolean(),
      }),
    ),
  }),
  z.object({ data: z.string() }),
  z.object({ written: z.literal(true) }),
]);

const vmListSchema = z.array(
  z.object({
    configuration: z.object({
      id: z.string(),
      labels: z.record(z.string(), z.string()).optional(),
      image: z
        .object({
          reference: z.string().optional(),
          descriptor: z.object({ digest: z.string().optional() }).optional(),
        })
        .optional(),
    }),
    status: z.object({
      state: z.string(),
      networks: z.array(z.object({ ipv4Address: z.string().optional() })).optional(),
    }),
  }),
);

interface VmEntry {
  name: string;
  state: string;
  address: string | undefined;
  image: { reference: string | undefined; digest: string | undefined };
}

export function runsImage(entry: VmEntry['image'], image: string): boolean {
  const pinned = /@(sha256:[0-9a-f]{64})$/.exec(image)?.[1];
  if (pinned !== undefined) return entry.digest === pinned || entry.reference === image;
  return entry.reference === image || entry.reference?.endsWith(`/${image}`) === true;
}

export function computerVmName(scopeKey: string): string {
  return `cairn-computer-${scopeHash(scopeKey).slice(0, 24)}`;
}

function scopeHash(scopeKey: string): string {
  if (scopeKey === '') throw new Error('Computer scope key is empty');
  return createHash('sha256').update(scopeKey).digest('hex');
}

export type ScreenProbe = (host: string, port: number) => Promise<boolean>;

const probeTcp: ScreenProbe = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });

export interface VmDesktopsOptions {
  root: string;
  runtime: { resolve(): Promise<string>; unsupported(): string | undefined; forget(): void };
  env?: NodeJS.ProcessEnv;
  image?: string;
  run?: VmCommandRunner;
  probe?: ScreenProbe;
  inputFence?: ComputerInputFence;
  readyMs?: number;
  idleStopMs?: number;
  now?: () => number;
  totalMemory?: () => number;
  log?: (message: string) => void;
}

interface Desktop {
  binary: string;
  name: string;
  address: string;
}

export class VmDesktops implements ComputerDesktops {
  readonly kind = 'vm';
  readonly hostRoot: string;
  private readonly run: VmCommandRunner;
  private readonly probe: ScreenProbe;
  private readonly now: () => number;
  private readonly image: string;
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
  private readonly licensed = new Map<string, string>();
  private readonly started = new Set<string>();
  private readonly running = new Set<() => Promise<void>>();

  constructor(private readonly options: VmDesktopsOptions) {
    this.hostRoot = options.root;
    this.run = options.run ?? runVmCommand;
    this.probe = options.probe ?? probeTcp;
    this.now = options.now ?? Date.now;
    this.image =
      options.image ?? options.env?.[COMPUTER_IMAGE_ENV] ?? COMPUTER_IMAGE_MANIFEST.image;
  }

  missingPrograms(): string[] {
    const unsupported = this.options.runtime.unsupported();
    return unsupported ? [unsupported] : [];
  }

  offersBrowser(): boolean {
    return this.missingPrograms().length === 0;
  }

  offersStealthBrowser(): boolean {
    return this.missingPrograms().length === 0;
  }

  private scopesDirectory(): string {
    return join(this.options.root, 'scopes');
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  socketPath(scopeKey: string, kind: 'view' | 'control'): string {
    const address = this.desktops.get(scopeKey)?.address;
    if (!address) return '';
    return `${address}:${kind === 'view' ? VM_VIEW_PORT : VM_CONTROL_PORT}`;
  }

  async terminalCommand(scopeKey: string): Promise<string[]> {
    const desktop = await this.desktop(scopeKey);
    return [
      desktop.binary,
      'exec',
      '--interactive',
      '--tty',
      ...this.identity('/home/agent'),
      desktop.name,
      'bash',
      '-l',
    ];
  }

  private identity(cwd: string): string[] {
    return [
      '--uid',
      VM_USER,
      '--gid',
      VM_USER,
      '--workdir',
      cwd,
      '--env',
      `HOME=${VM_HOME}`,
      '--env',
      'USER=agent',
      '--env',
      'DISPLAY=:1',
      '--env',
      'LANG=C.UTF-8',
    ];
  }

  async ensure(scopeKey: string): Promise<string> {
    return (await this.desktop(scopeKey)).address;
  }

  async hold(scopeKey: string, use: ComputerHoldUse = 'view'): Promise<() => void> {
    this.enter(scopeKey);
    try {
      await this.desktop(scopeKey);
      if (use === 'handoff') await this.takeOver(scopeKey);
    } catch (error) {
      this.leave(scopeKey);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (use === 'handoff') this.handBack(scopeKey);
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
            if (this.licensed.has(scopeKey))
              await this.browserScript(scopeKey, ['owner', browserSessionName(scopeKey, true)]);
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

  private async browserScript(
    scopeKey: string,
    args: readonly string[],
    stdin?: string,
  ): Promise<{ code: number; stderr: string }> {
    const desktop = await this.desktop(scopeKey);
    const result = await this.run(
      [
        desktop.binary,
        'exec',
        ...(stdin === undefined ? [] : ['--interactive']),
        ...this.identity(VM_HOME),
        desktop.name,
        'cairn-browser',
        ...args,
      ],
      { timeoutMs: BROWSER_COMMAND_MS, ...(stdin === undefined ? {} : { stdin }) },
    );
    if (result.code !== 0 && args[0] !== 'prepare' && args[0] !== 'key')
      throw new ComputerRefusal(
        result.stderr.trim().split('\n').at(-1) || 'The computer browser could not be switched',
      );
    return result;
  }

  private async prepareGuestBrowser(scopeKey: string, license: string | undefined): Promise<void> {
    const fingerprint =
      license === undefined ? undefined : createHash('sha256').update(license).digest('hex');
    const current = this.licensed.get(scopeKey);
    if (fingerprint === undefined) {
      if (current !== undefined) return;
      throw new ComputerRefusal(NO_CLOAK_LICENSE);
    }
    if (current === fingerprint) return;
    const stored = await this.browserScript(scopeKey, ['key'], `${license}\n`);
    if (stored.code !== 0)
      throw new ComputerRefusal('The CloakBrowser license could not be stored');
    const { locale, timezone } = resolveHostBrowserLocaleAndTimezone(
      this.options.env ?? process.env,
    );
    const prepared = await this.browserScript(scopeKey, ['prepare', locale, timezone]);
    if (prepared.code === 3)
      throw new ComputerRefusal('CloakBrowser license denied or unavailable');
    if (prepared.code !== 0)
      throw new ComputerRefusal(
        prepared.stderr.trim().split('\n').at(-1) || 'CloakBrowser binary acquisition failed',
      );
    this.licensed.set(scopeKey, fingerprint);
  }

  private closeOwnerBrowser(scopeKey: string): Promise<void> {
    return this.handoff(scopeKey, async () => {
      if (!this.takeovers.has(scopeKey)) await this.browserScript(scopeKey, ['agent']);
    });
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

  private async list(binary: string): Promise<VmEntry[]> {
    const listed = await this.run([binary, 'list', '--all', '--format', 'json']);
    if (listed.code !== 0) {
      this.options.runtime.forget();
      throw new ComputerRefusal('The container system is not answering');
    }
    const parsed = vmListSchema.safeParse(JSON.parse(listed.stdout || '[]'));
    if (!parsed.success) throw new ComputerRefusal('The container system answered unexpectedly');
    return parsed.data.map((entry) => ({
      name: entry.configuration.id,
      state: entry.status.state,
      address: entry.status.networks
        ?.map((network) => network.ipv4Address?.split('/')[0])
        .find((address) => address !== undefined && address !== ''),
      image: {
        reference: entry.configuration.image?.reference,
        digest: entry.configuration.image?.descriptor?.digest,
      },
    }));
  }

  private async start(scopeKey: string): Promise<Desktop> {
    const unsupported = this.options.runtime.unsupported();
    if (unsupported) throw new ComputerRefusal(unsupported);
    const binary = await this.options.runtime.resolve();
    if (this.options.inputFence && !this.leases.has(scopeKey)) {
      try {
        this.leases.set(scopeKey, await this.options.inputFence.acquire(scopeKey));
      } catch (error) {
        throw new ComputerRefusal(error instanceof Error ? error.message : String(error));
      }
    }
    mkdirSync(this.scopesDirectory(), { recursive: true, mode: 0o700 });
    const name = computerVmName(scopeKey);
    writeFileSync(join(this.scopesDirectory(), name), scopeKey, { mode: 0o600 });
    const current = this.desktops.get(scopeKey);
    let entry = (await this.list(binary)).find((vm) => vm.name === name);
    if (current && entry?.state === 'running' && entry.address === current.address) return current;
    this.desktops.delete(scopeKey);
    this.licensed.delete(scopeKey);
    if (
      entry?.state === 'running' &&
      entry.address &&
      (await this.ready(binary, name, entry.address))
    )
      return this.remember(scopeKey, { binary, name, address: entry.address });
    if (entry?.state === 'running') await this.run([binary, 'stop', name], { timeoutMs: 30_000 });
    if (entry) {
      const restarted = await this.run([binary, 'start', name], { timeoutMs: 120_000 });
      if (restarted.code !== 0) {
        await this.run([binary, 'delete', '--force', name]);
        entry = undefined;
      }
    }
    const created = !entry;
    if (!entry) {
      const volume = await this.run([binary, 'volume', 'inspect', name]);
      if (volume.code !== 0) await this.run([binary, 'volume', 'create', name]);
      const hostBytes = (this.options.totalMemory ?? totalmem)();
      const memory = vmMemoryFlag(hostBytes);
      this.options.log?.(`computer VM memory ${memory} (host ${Math.round(hostBytes / GIB)} GiB)`);
      const created = await this.run(
        [
          binary,
          'run',
          '--detach',
          '--name',
          name,
          '--label',
          `${SCOPE_LABEL}=${scopeHash(scopeKey)}`,
          '--cpus',
          '2',
          '--memory',
          memory,
          '--cap-drop',
          'ALL',
          '--cap-add',
          'CAP_NET_ADMIN',
          '--cap-add',
          'CAP_SETUID',
          '--cap-add',
          'CAP_SETGID',
          '--cap-add',
          'CAP_CHOWN',
          '--tmpfs',
          '/run/cairn',
          '--volume',
          `${name}:${VM_HOME}`,
          this.image,
        ],
        { timeoutMs: 15 * 60_000 },
      );
      if (created.code !== 0) {
        await this.run([binary, 'delete', '--force', name]);
        throw new ComputerRefusal('The computer image could not be started');
      }
    }
    this.started.add(name);
    const deadline = this.now() + (this.options.readyMs ?? VM_DESKTOP_READY_MS);
    for (;;) {
      const vm = (await this.list(binary)).find((candidate) => candidate.name === name);
      if (vm?.state === 'running' && vm.address && (await this.ready(binary, name, vm.address))) {
        const desktop = { binary, name, address: vm.address };
        if (created) await this.reinstallPackages(desktop);
        return this.remember(scopeKey, desktop);
      }
      if (vm?.state !== 'running' || this.now() >= deadline) {
        await this.run([binary, 'delete', '--force', name]);
        this.started.delete(name);
        throw new ComputerRefusal('The computer did not become ready');
      }
      await sleep(200);
    }
  }

  private packagesFile(name: string): string {
    return join(this.options.root, 'packages', `${name}.json`);
  }

  private recordedPackages(name: string): string[] {
    try {
      const parsed = debianPackageNamesSchema.safeParse(
        JSON.parse(readFileSync(this.packagesFile(name), 'utf8')),
      );
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  private recordPackages(name: string, packages: readonly string[]): void {
    mkdirSync(join(this.options.root, 'packages'), { recursive: true, mode: 0o700 });
    const all = [...new Set([...this.recordedPackages(name), ...packages])].sort();
    writeFileSync(this.packagesFile(name), JSON.stringify(all), { mode: 0o600 });
  }

  private async reinstallPackages(desktop: Desktop): Promise<void> {
    const recorded = this.recordedPackages(desktop.name);
    if (recorded.length === 0) return;
    const code = await this.rootInstall(desktop, recorded, {
      timeoutMs: INSTALL_PACKAGES_TIMEOUT_MS,
      signal: new AbortController().signal,
      output: () => {},
    });
    this.options.log?.(
      code === 0
        ? `computer packages reinstalled ${recorded.join(' ')}`
        : `computer packages reinstall failed with exit ${code}: ${recorded.join(' ')}`,
    );
  }

  private rootInstall(
    desktop: Desktop,
    packages: readonly string[],
    options: ComputerPackageInstallOptions,
  ): Promise<number> {
    const seconds = Math.max(1, Math.ceil(options.timeoutMs / 1000));
    return new Promise((resolve) => {
      if (options.signal.aborted) {
        resolve(130);
        return;
      }
      const child = spawn(
        desktop.binary,
        [
          'exec',
          '--uid',
          VM_ROOT,
          '--gid',
          VM_ROOT,
          '--env',
          'DEBIAN_FRONTEND=noninteractive',
          desktop.name,
          'timeout',
          `--kill-after=${ROOT_KILL_GRACE_SECONDS}`,
          String(seconds),
          'sh',
          '-c',
          PACKAGE_INSTALL_SCRIPT,
          'sh',
          ...packages,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        options.timeoutMs + (ROOT_KILL_GRACE_SECONDS + 5) * 1000,
      );
      timer.unref();
      const abort = () => child.kill('SIGTERM');
      options.signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8').on('data', (text: string) => options.output('stdout', text));
      child.stderr.setEncoding('utf8').on('data', (text: string) => options.output('stderr', text));
      const finish = (code: number) => {
        clearTimeout(timer);
        options.signal.removeEventListener('abort', abort);
        resolve(code);
      };
      child.once('error', () => finish(127));
      child.once('close', (code) => finish(code ?? 1));
    });
  }

  async installPackages(
    scopeKey: string,
    packages: readonly string[],
    options: ComputerPackageInstallOptions,
  ): Promise<number> {
    const parsed = debianPackageNamesSchema.safeParse(packages);
    if (!parsed.success)
      throw new ComputerRefusal(parsed.error.issues[0]?.message ?? 'invalid package names');
    return this.using(scopeKey, async () => {
      const desktop = await this.desktop(scopeKey);
      const code = await this.rootInstall(desktop, parsed.data, options);
      if (code === 0) this.recordPackages(desktop.name, parsed.data);
      return code;
    });
  }

  async manage(scopeKey: string, action: ComputerManageAction): Promise<ComputerManageOutcome> {
    const unsupported = this.options.runtime.unsupported();
    if (unsupported) throw new ComputerRefusal(unsupported);
    const binary = await this.options.runtime.resolve();
    const name = computerVmName(scopeKey);
    const outcome = await this.exclusive(scopeKey, async () => {
      await this.pending.get(scopeKey)?.catch(() => {});
      const entry = (await this.list(binary)).find((vm) => vm.name === name);
      if (action === 'stop') {
        if (entry?.state !== 'running') return 'already_stopped';
        await this.stop(scopeKey, binary, name);
        return 'stopped';
      }
      if (action === 'update' && (entry === undefined || runsImage(entry.image, this.image)))
        return 'current';
      if (entry?.state === 'running' && action !== 'recover')
        await this.stop(scopeKey, binary, name).catch(() => {});
      await this.discard(scopeKey, binary, name, entry !== undefined);
      if (action === 'reset') {
        const volume = await this.run([binary, 'volume', 'delete', name], {
          timeoutMs: VM_DELETE_MS,
        });
        const kept = await this.run([binary, 'volume', 'inspect', name]);
        if (volume.code !== 0 && kept.code === 0)
          throw new ComputerRefusal('The computer home could not be deleted');
        rmSync(this.packagesFile(name), { force: true });
        return 'reset';
      }
      return action === 'update' ? 'updated' : 'recovered';
    });
    if (outcome !== 'stopped' && outcome !== 'already_stopped' && outcome !== 'current')
      await this.desktop(scopeKey);
    return outcome;
  }

  private async exclusive<T>(scopeKey: string, step: () => Promise<T>): Promise<T> {
    const previous = this.stopping.get(scopeKey) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(step);
    const settled = operation.then(
      () => {},
      () => {},
    );
    this.stopping.set(scopeKey, settled);
    try {
      return await operation;
    } finally {
      if (this.stopping.get(scopeKey) === settled) this.stopping.delete(scopeKey);
      this.notify();
    }
  }

  private async discard(
    scopeKey: string,
    binary: string,
    name: string,
    exists: boolean,
  ): Promise<void> {
    await Promise.all([...this.running].map((stop) => stop()));
    this.desktops.delete(scopeKey);
    this.licensed.delete(scopeKey);
    this.started.delete(name);
    if (!exists) return;
    const deleted = await this.run([binary, 'delete', '--force', name], {
      timeoutMs: VM_DELETE_MS,
    });
    if (deleted.code !== 0 && (await this.list(binary)).some((vm) => vm.name === name))
      throw new ComputerRefusal('The computer could not be removed');
  }

  private remember(scopeKey: string, desktop: Desktop): Desktop {
    this.desktops.set(scopeKey, desktop);
    return desktop;
  }

  private async ready(binary: string, name: string, address: string): Promise<boolean> {
    const marker = await this.run([
      binary,
      'exec',
      '--uid',
      VM_USER,
      name,
      'test',
      '-e',
      '/run/cairn/ready',
    ]);
    if (marker.code !== 0) return false;
    const ports = await Promise.all([
      this.probe(address, VM_CONTROL_PORT),
      this.probe(address, VM_VIEW_PORT),
    ]);
    return ports.every(Boolean);
  }

  private guestCwd(requested: string | undefined): string {
    const text = (requested ?? '').trim();
    if (text.includes('\0')) throw new ComputerRefusal('cwd contains a null byte');
    const expanded =
      text === '' || text === '~' ? VM_HOME : text.startsWith('~/') ? text.slice(2) : text;
    const resolved = posix.resolve(VM_HOME, expanded);
    if (resolved !== VM_HOME && !resolved.startsWith(`${VM_HOME}/`))
      throw new ComputerRefusal(
        'cwd must be inside the home folder; cd elsewhere within the command',
      );
    return resolved;
  }

  private async execute(
    desktop: Desktop,
    request: ComputerExecuteRequest,
  ): Promise<AsyncIterable<ComputerProcessEvent>> {
    const [command] = request.argv;
    if (!command) throw new ComputerRefusal('empty command');
    const cwd = this.guestCwd(request.cwd);
    const requested = Object.entries(request.env ?? {});
    for (const [name] of requested)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new ComputerRefusal(`invalid environment variable name ${name}`);
    const marker = randomBytes(12).toString('hex');
    const seconds = Math.max(1, Math.ceil(request.timeoutMs / 1000));
    const argv = [
      'exec',
      ...(request.stdin === undefined ? [] : ['--interactive']),
      ...this.identity(cwd),
      ...requested.flatMap(([name]) => ['--env', name]),
      '--env',
      `CAIRN_COMPUTER_MARKER=${marker}`,
      desktop.name,
      'timeout',
      '--kill-after=1',
      String(seconds),
      ...request.argv,
    ];
    const queue = new AsyncEventQueue();
    if (request.signal.aborted) {
      queue.push({ kind: 'stderr', text: 'command cancelled before starting\n' });
      queue.push({ kind: 'exit', code: 130, reason: 'aborted', delivery: 'not_delivered' });
      queue.end();
      return queue;
    }
    const child = spawn(desktop.binary, argv, {
      env: { ...process.env, ...Object.fromEntries(requested) },
      stdio: [request.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(request.stdin);
    let settled = false;
    let stopped: { code: number; reason: 'timeout' | 'aborted'; note: string } | undefined;
    const kill = async () => {
      await this.run([
        desktop.binary,
        'exec',
        '--uid',
        VM_USER,
        desktop.name,
        'sh',
        '-c',
        KILL_SCRIPT,
        'sh',
        marker,
      ]);
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
      child.kill('SIGTERM');
    };
    const stop = async () => {
      stopped ??= { code: 130, reason: 'aborted', note: 'command stopped' };
      await kill();
    };
    const timer = setTimeout(() => {
      stopped ??= {
        code: 124,
        reason: 'timeout',
        note: `command timed out after ${request.timeoutMs} ms; process tree killed`,
      };
      void kill();
    }, request.timeoutMs);
    timer.unref();
    const abort = () => {
      stopped ??= { code: 130, reason: 'aborted', note: 'command aborted' };
      void kill();
    };
    request.signal.addEventListener('abort', abort, { once: true });
    this.running.add(stop);
    child.stdout?.setEncoding('utf8').on('data', (text: string) => {
      if (!settled && !stopped) queue.push({ kind: 'stdout', text });
    });
    child.stderr?.setEncoding('utf8').on('data', (text: string) => {
      if (!settled && !stopped) queue.push({ kind: 'stderr', text });
    });
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      this.running.delete(stop);
      if (stopped) {
        queue.push({ kind: 'stderr', text: `${stopped.note}\n` });
        queue.push({ kind: 'exit', code: stopped.code, reason: stopped.reason });
      } else queue.push({ kind: 'exit', code: code === 124 ? 124 : code });
      queue.end();
    };
    child.once('error', (error) => {
      if (!settled) queue.push({ kind: 'stderr', text: `${error.message}\n` });
      finish(1);
    });
    child.once('close', (code) => finish(code ?? 1));
    return queue;
  }

  private async files(
    desktop: Desktop,
    op: 'list' | 'read' | 'write',
    path: string,
    content?: string,
  ): Promise<z.infer<typeof filesResultSchema>> {
    const result = await this.run(
      [
        desktop.binary,
        'exec',
        ...(content === undefined ? [] : ['--interactive']),
        ...this.identity(VM_HOME),
        desktop.name,
        'node',
        '-e',
        FILES_SCRIPT,
        op,
        path,
        String(HOST_MAX_FILE_BYTES),
      ],
      content === undefined ? {} : { stdin: content },
    );
    let parsed: z.infer<typeof filesResultSchema> | undefined;
    try {
      parsed = filesResultSchema.parse(JSON.parse(result.stdout));
    } catch {
      parsed = undefined;
    }
    if (result.code !== 0 || parsed === undefined)
      throw new ComputerRefusal(`${op} failed in the computer`);
    if ('refused' in parsed) throw new ComputerRefusal(parsed.refused);
    return parsed;
  }

  forScope(scopeKey: string, grant: ComputerScopeGrant = {}): ComputerProvider {
    const leave = () => this.leave(scopeKey);
    return {
      execute: async (request) => {
        const stealth = isStealthBrowserCommand(request.argv);
        if (this.takeovers.has(scopeKey) && request.argv[0] === AGENT_BROWSER_BINARY)
          throw new ComputerRefusal(
            'The owner has taken over this browser; wait until they hand it back',
          );
        this.enter(scopeKey);
        let events: AsyncIterable<ComputerProcessEvent>;
        try {
          const desktop = await this.desktop(scopeKey);
          if (stealth) {
            await this.prepareGuestBrowser(scopeKey, grant.browserLicense);
            await this.closeOwnerBrowser(scopeKey);
          } else await this.handoffs.get(scopeKey);
          events = await this.execute(desktop, request);
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
      listFiles: (path) =>
        this.using(scopeKey, async () => {
          const result = await this.files(await this.desktop(scopeKey), 'list', path);
          if (!('entries' in result)) throw new ComputerRefusal('list failed in the computer');
          return result.entries
            .map(
              (entry): ComputerFileEntry => ({
                path: entry.path,
                kind: entry.kind,
                size: entry.size,
                ...(entry.executable ? { executable: true as const } : {}),
              }),
            )
            .sort((a, b) => a.path.localeCompare(b.path));
        }),
      readFile: (path) =>
        this.using(scopeKey, async () => {
          const result = await this.files(await this.desktop(scopeKey), 'read', path);
          if (!('data' in result)) throw new ComputerRefusal('read failed in the computer');
          const bytes = Buffer.from(result.data, 'base64');
          if (bytes.byteLength > HOST_MAX_FILE_BYTES)
            throw new ComputerRefusal(`file exceeds ${HOST_MAX_FILE_BYTES} bytes`);
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            throw new ComputerRefusal('file is not valid UTF-8');
          }
        }),
      writeFile: (path, content) =>
        this.using(scopeKey, async () => {
          if (Buffer.byteLength(content, 'utf8') > HOST_MAX_FILE_BYTES)
            throw new ComputerRefusal(`content exceeds ${HOST_MAX_FILE_BYTES} bytes`);
          await this.files(await this.desktop(scopeKey), 'write', path, content);
        }),
      killAll: async () => {
        await Promise.all([...this.running].map((stop) => stop()));
      },
    };
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.running].map((stop) => stop()));
    const binary = [...this.desktops.values()][0]?.binary;
    if (binary === undefined) return;
    await Promise.all(
      [...this.started].map((name) => this.run([binary, 'stop', name], { timeoutMs: 30_000 })),
    );
    this.started.clear();
    this.desktops.clear();
    this.licensed.clear();
  }

  private known(): { scopeKey: string; name: string }[] {
    if (!existsSync(this.scopesDirectory())) return [];
    return readdirSync(this.scopesDirectory()).flatMap((name) => {
      try {
        const scopeKey = readFileSync(join(this.scopesDirectory(), name), 'utf8');
        return scopeKey === '' ? [] : [{ scopeKey, name }];
      } catch {
        return [];
      }
    });
  }

  async sweep(): Promise<void> {
    const known = this.known();
    if (known.length === 0 || this.options.runtime.unsupported()) return;
    const idleMs = this.options.idleStopMs ?? HOST_DESKTOP_IDLE_STOP_MS;
    const binary = await this.options.runtime.resolve();
    const states = new Map((await this.list(binary)).map((vm) => [vm.name, vm.state]));
    let failure: unknown;
    for (const { scopeKey, name } of known) {
      const now = this.now();
      if (!this.lastUsed.has(scopeKey)) this.lastUsed.set(scopeKey, now);
      if (!this.idle(scopeKey, now, idleMs) || states.get(name) !== 'running') continue;
      const stop = this.stop(scopeKey, binary, name).finally(() => {
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

  private async stop(scopeKey: string, binary: string, name: string): Promise<void> {
    await this.handoff(scopeKey, async () => {
      await this.run(
        [
          binary,
          'exec',
          ...this.identity(VM_HOME),
          name,
          'cairn-browser',
          'quit',
          browserSessionName(scopeKey, true),
        ],
        { timeoutMs: BROWSER_COMMAND_MS },
      );
    });
    await Promise.all([...this.running].map((stop) => stop()));
    this.desktops.delete(scopeKey);
    this.licensed.delete(scopeKey);
    this.lastUsed.delete(scopeKey);
    this.started.delete(name);
    const stopped = await this.run([binary, 'stop', name], { timeoutMs: 30_000 });
    if (stopped.code !== 0) throw new Error(`computer ${name} did not stop`);
  }

  async presence(): Promise<ComputerPresence[]> {
    const known = this.known();
    known.splice(COMPUTER_PRESENCE_LIMIT);
    if (known.length === 0 || this.options.runtime.unsupported()) return [];
    const binary = await this.options.runtime.resolve().catch(() => undefined);
    const states = new Map(
      binary === undefined
        ? []
        : (await this.list(binary).catch(() => [])).map((vm) => [vm.name, vm.state]),
    );
    return known.map(({ scopeKey, name }) => ({
      scopeKey,
      providerRef: name,
      state: this.pending.has(scopeKey)
        ? 'starting'
        : this.failed.has(scopeKey)
          ? 'failed'
          : states.get(name) === 'running'
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
