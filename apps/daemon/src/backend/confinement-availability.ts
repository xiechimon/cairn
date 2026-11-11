import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConfinementReport, MachineCapabilities } from '@cairn/shared';
import { ensurePrivateDir, writePrivateFile } from '../private-fs.js';
import { launchConfined, reconcileConfinement } from './confine.js';

export class ConfinementAvailability {
  report: ConfinementReport | undefined;
  private accepted = false;
  private running: Promise<void> | undefined;

  constructor(
    private readonly options: {
      home: string;
      platform?: string;
      owner?: string;
      me(): Promise<{ capabilities?: MachineCapabilities | null }>;
      send(): Promise<void>;
      launch?: typeof launchConfined;
      reconcile?: typeof reconcileConfinement;
    },
  ) {}

  get ready(): boolean {
    return (
      this.accepted && (this.report?.state === 'ready' || this.report?.state === 'not-applicable')
    );
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
        owner:
          this.options.owner ??
          readFileSync('/proc/self/cgroup', 'utf8').trim().split('/').at(-1) ??
          '',
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
    } catch {
      if (!cleanup && !existsSync(file) && scratch)
        rmSync(scratch, { recursive: true, force: true });
      this.report = {
        ...this.report,
        state: 'unavailable',
        reason: cleanup || existsSync(file) ? 'cleanup-failed' : 'startup-failed',
      };
    }
    await this.options.send();
    this.accepted = true;
  }
}
