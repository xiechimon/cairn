import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConfinementCause, ConfinementReport, MachineCapabilities } from '@cairn/shared';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';
import {
  ConfinementExitedError,
  ConfinementOwnerError,
  launchConfined,
  reconcileConfinement,
} from './confine.js';
import { runSeatbeltProbe, SeatbeltProbeError } from './confine-seatbelt.js';

const MOUNTINFO_ESCAPES: Record<string, string> = {
  '\\040': ' ',
  '\\011': '\t',
  '\\012': '\n',
  '\\134': '\\',
};

export function fuseMountUnder(mountinfo: string, home: string): string | undefined {
  for (const line of mountinfo.split('\n')) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    const fstype = fields[separator + 1];
    const encoded = fields[4];
    if (separator < 6 || fstype === undefined || encoded === undefined) continue;
    if (!fstype.startsWith('fuse')) continue;
    const mountPoint = encoded.replace(
      /\\(040|011|012|134)/g,
      (code) => MOUNTINFO_ESCAPES[code] ?? code,
    );
    if (mountPoint === home || mountPoint.startsWith(`${home}/`)) return mountPoint;
  }
  return undefined;
}

export function confinementCauseOf(
  error: unknown,
  inspect: { mountinfo(): string; home(): string },
): ConfinementCause | undefined {
  if (error instanceof ConfinementOwnerError) return { kind: 'not-own-unit' };
  if (!(error instanceof ConfinementExitedError)) return undefined;
  if (/^Failed to find executable bwrap\b/m.test(error.stderrTail))
    return { kind: 'bwrap-missing' };
  if (/^bwrap: Unknown option --(overlay-src|tmp-overlay)\b/m.test(error.stderrTail))
    return { kind: 'bwrap-too-old' };
  if (
    /^bwrap: (setting up uid map: Permission denied|No permissions to creat(ing|e a) new namespace)/m.test(
      error.stderrTail,
    )
  )
    return { kind: 'userns-denied' };
  if (!/^bwrap: Can't make overlay mount\b/m.test(error.stderrTail)) return undefined;
  let mountPoint: string | undefined;
  try {
    mountPoint = fuseMountUnder(inspect.mountinfo(), inspect.home());
  } catch {}
  return mountPoint === undefined
    ? { kind: 'home-overlay-failed' }
    : { kind: 'home-overlay-failed', mountPoint };
}

export class ConfinementAvailability {
  report: ConfinementReport | undefined;
  cause: ConfinementCause | undefined;
  private accepted = false;
  private running: Promise<void> | undefined;

  constructor(
    private readonly options: {
      home: string;
      platform?: string;
      owner?: string;
      invocationId?: string;
      me(): Promise<{ capabilities?: MachineCapabilities | null }>;
      send(): Promise<void>;
      seatbeltProbe?: (directory: string) => Promise<void>;
      launch?: typeof launchConfined;
      reconcile?: typeof reconcileConfinement;
      mountinfo?: () => string;
      userHome?: () => string;
    },
  ) {}

  get ready(): boolean {
    return (
      this.accepted && (this.report?.state === 'ready' || this.report?.state === 'not-applicable')
    );
  }

  get recoverable(): boolean {
    if (this.cause?.kind !== 'not-own-unit') return true;
    const invocation = this.options.invocationId ?? process.env.INVOCATION_ID;
    return Boolean(invocation) && this.owner().endsWith('.service');
  }

  settled(): Promise<void> {
    return (this.running ?? Promise.resolve()).catch(() => {});
  }

  private owner(): string {
    if (this.options.owner !== undefined) return this.options.owner;
    try {
      return readFileSync('/proc/self/cgroup', 'utf8').trim().split('/').at(-1) ?? '';
    } catch {
      return '';
    }
  }

  invalidate(): void {
    this.accepted = false;
  }

  observation(): ConfinementReport | undefined {
    if (this.report) this.report = { ...this.report, revision: this.report.revision + 1 };
    return this.report;
  }

  recheck(): Promise<void> {
    this.running ??= this.check().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async check(): Promise<void> {
    this.accepted = false;
    this.report = undefined;
    this.cause = undefined;
    const previous = (await this.options.me()).capabilities?.confinement;
    this.report = {
      state: 'checking',
      invocation: randomUUID(),
      generation: (previous?.generation ?? 0) + 1,
      revision: 1,
    };
    await this.options.send();
    const acknowledged = (await this.options.me()).capabilities?.confinement;
    if (
      acknowledged?.invocation !== this.report.invocation ||
      acknowledged.generation !== this.report.generation ||
      acknowledged.state !== 'checking'
    )
      throw new Error('Confinement generation was not acknowledged');
    const platform = this.options.platform ?? process.platform;
    if (platform === 'darwin') {
      try {
        const directory = join(this.options.home, 'confinement');
        ensurePrivateDir(directory);
        await (this.options.seatbeltProbe ?? runSeatbeltProbe)(directory);
        this.report = { ...this.report, state: 'ready' };
      } catch (error) {
        this.report = { ...this.report, state: 'unavailable', reason: 'startup-failed' };
        this.cause = {
          kind: error instanceof SeatbeltProbeError ? error.kind : 'seatbelt-probe-failed',
        };
      }
      await this.options.send();
      this.accepted = true;
      return;
    }
    if (platform !== 'linux') {
      this.report = { ...this.report, state: 'not-applicable' };
      await this.options.send();
      this.accepted = true;
      return;
    }
    const directory = join(this.options.home, 'confinement');
    ensurePrivateDir(directory);
    const file = join(directory, 'reservation.json');
    let cleanup = existsSync(file);
    let scratch: string | undefined;
    try {
      if (cleanup) {
        const reservation = JSON.parse(readFileSync(file, 'utf8')) as {
          unit: string;
          eventsPath: string;
          scratch: string;
        };
        if (
          !reservation.scratch.startsWith(`${directory}/probe-`) ||
          reservation.scratch.includes('..')
        )
          throw new Error('Invalid confinement scratch');
        await (this.options.reconcile ?? reconcileConfinement)(reservation);
        rmSync(reservation.scratch, { recursive: true });
        rmSync(file);
      }
      cleanup = false;
      scratch = mkdtempSync(join(directory, 'probe-'));
      const launched = await (this.options.launch ?? launchConfined)({
        owner: this.owner(),
        policy: {
          home: homedir(),
          daemonHome: this.options.home,
          workspace: scratch,
          taskTemp: scratch,
          gitDirectories: [],
          state: [],
          caches: [],
        },
        released: () => rmSync(file, { force: true }),
        command: [process.execPath, '-e', 'process.exit(0)'],
        environment: {},
        signal: AbortSignal.timeout(10000),
        reserve: (reservation) => {
          writePrivateFile(`${file}.tmp`, JSON.stringify({ ...reservation, scratch }));
          renameSync(`${file}.tmp`, file);
        },
      });
      cleanup = true;
      launched.process.stdout.resume();
      launched.process.stderr.resume();
      const exit = new Promise<number | null>((resolve, reject) => {
        launched.process.once('error', reject);
        launched.process.once('close', resolve);
      });
      launched.process.stdin.end();
      await launched.completed;
      cleanup = false;
      rmSync(scratch, { recursive: true });
      rmSync(file, { force: true });
      if ((await exit) !== 0) throw new Error('Confinement probe failed');
      this.report = { ...this.report, state: 'ready' };
    } catch (error) {
      if (!cleanup && !existsSync(file) && scratch)
        rmSync(scratch, { recursive: true, force: true });
      const reason = cleanup || existsSync(file) ? 'cleanup-failed' : 'startup-failed';
      this.report = { ...this.report, state: 'unavailable', reason };
      if (reason === 'startup-failed')
        this.cause = confinementCauseOf(error, {
          mountinfo: this.options.mountinfo ?? (() => readFileSync('/proc/self/mountinfo', 'utf8')),
          home: this.options.userHome ?? (() => realpathSync(homedir())),
        });
    }
    await this.options.send();
    this.accepted = true;
  }
}
