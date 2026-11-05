import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const POLL_MS = 25;

interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  zombie: boolean;
}

export const COMPUTER_MARKER_ENV = 'CAIRN_COMPUTER_CALL';

async function readLinuxProcesses(): Promise<ProcessRow[]> {
  const names = await readdir('/proc').catch(() => []);
  const rows = await Promise.all(
    names
      .filter((name) => /^\d+$/.test(name))
      .map(async (name): Promise<ProcessRow | undefined> => {
        const stat = await readFile(`/proc/${name}/stat`, 'utf8').catch(() => undefined);
        if (stat === undefined) return undefined;
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return {
          pid: Number(name),
          ppid: Number(fields[1]),
          pgid: Number(fields[2]),
          zombie: fields[0] === 'Z',
        };
      }),
  );
  return rows.filter((row): row is ProcessRow => row !== undefined);
}

async function readPortableProcesses(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync('ps', ['-Ao', 'pid=,ppid=,pgid=,stat=']).catch(() => ({
    stdout: '',
  }));
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const [pid, ppid, pgid, state] = line.trim().split(/\s+/);
    if (pid === undefined || ppid === undefined || pgid === undefined) continue;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      zombie: state?.startsWith('Z') ?? false,
    });
  }
  return rows;
}

async function markerHolders(rows: readonly ProcessRow[], marker: string): Promise<number[]> {
  const needle = `${COMPUTER_MARKER_ENV}=${marker}`;
  const found = await Promise.all(
    rows.map(async (row) => {
      const environ = await readFile(`/proc/${row.pid}/environ`, 'utf8').catch(() => '');
      return environ.split('\0').includes(needle) ? row.pid : undefined;
    }),
  );
  return found.filter((pid): pid is number => pid !== undefined);
}

export class ProcessTree {
  private members = new Set<number>();

  constructor(
    private readonly rootPid: number,
    private readonly marker: string,
    private readonly graceMs: number,
  ) {}

  private async collect(): Promise<ProcessRow[]> {
    const linux = process.platform === 'linux';
    const rows = linux ? await readLinuxProcesses() : await readPortableProcesses();
    const children = new Map<number, number[]>();
    for (const row of rows) {
      const siblings = children.get(row.ppid) ?? [];
      siblings.push(row.pid);
      children.set(row.ppid, siblings);
    }
    const found = new Set<number>(this.members);
    const queue = [this.rootPid];
    while (queue.length > 0) {
      const pid = queue.pop();
      if (pid === undefined || found.has(pid)) continue;
      found.add(pid);
      queue.push(...(children.get(pid) ?? []));
    }
    for (const row of rows) if (row.pgid === this.rootPid) found.add(row.pid);
    if (linux) for (const pid of await markerHolders(rows, this.marker)) found.add(pid);
    found.delete(process.pid);
    found.delete(process.ppid);
    const live = rows.filter((row) => found.has(row.pid));
    this.members = new Set(live.map((row) => row.pid));
    return live;
  }

  private signalAll(signal: NodeJS.Signals): void {
    if (this.rootPid > 1) {
      try {
        process.kill(-this.rootPid, signal);
      } catch {}
    }
    for (const pid of this.members) {
      if (pid <= 1) continue;
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }

  private anyKnownAlive(): boolean {
    const exists = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    };
    return exists(-this.rootPid) || [...this.members].some(exists);
  }

  async kill(): Promise<void> {
    await this.collect();
    this.signalAll('SIGTERM');
    const graceEnds = Date.now() + this.graceMs;
    while (Date.now() < graceEnds && this.anyKnownAlive()) await sleep(POLL_MS);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const live = await this.collect();
      if (!live.some((row) => !row.zombie)) return;
      this.signalAll('SIGKILL');
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
