import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
export const SESSION_TREE_ENV = 'CAIRN_SESSION_TREE';
export const STEP_TREE_ENV = 'CAIRN_STEP_TREE';

export interface TreeMarker {
  env: string;
  value: string;
}

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

async function markerHolders(rows: readonly ProcessRow[], marker: TreeMarker): Promise<number[]> {
  const needle = `${marker.env}=${marker.value}`;
  const found = await Promise.all(
    rows.map(async (row) => {
      const environ = await readFile(`/proc/${row.pid}/environ`, 'utf8').catch(() => '');
      return environ.split('\0').includes(needle) ? row.pid : undefined;
    }),
  );
  return found.filter((pid): pid is number => pid !== undefined);
}

const DARWIN_PS_MAX_BYTES = 32 * 1024 * 1024;

async function darwinMarkerHolders(
  rows: readonly ProcessRow[],
  marker: TreeMarker,
  known: ReadonlySet<number>,
): Promise<number[]> {
  const needle = `${marker.env}=${marker.value}`;
  const candidates = rows.filter((row) => row.pid > 1 && !known.has(row.pid)).map((row) => row.pid);
  if (candidates.length === 0) return [];
  const listing = await execFileAsync(
    'ps',
    ['-E', '-o', 'pid=,command=', '-p', candidates.join(',')],
    {
      maxBuffer: DARWIN_PS_MAX_BYTES,
    },
  ).catch(() => ({ stdout: '' }));
  const holders: number[] = [];
  for (const line of listing.stdout.split('\n')) {
    const [pid, ...tokens] = line.trim().split(/\s+/);
    if (pid === undefined || !/^\d+$/.test(pid) || !tokens.includes(needle)) continue;
    holders.push(Number(pid));
  }
  return holders;
}

export class ProcessTree {
  private members = new Set<number>();

  constructor(
    private readonly rootPid: number,
    private readonly marker: TreeMarker,
    private readonly graceMs: number,
  ) {}

  private async collect(portableMarkerScan: boolean): Promise<ProcessRow[]> {
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
    if (linux) {
      for (const pid of await markerHolders(rows, this.marker)) found.add(pid);
    } else if (portableMarkerScan && process.platform === 'darwin') {
      for (const pid of await darwinMarkerHolders(rows, this.marker, found)) found.add(pid);
    }
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

  async snapshot(): Promise<void> {
    await this.collect(false);
  }

  async kill(): Promise<void> {
    await this.collect(true);
    this.signalAll('SIGTERM');
    const graceEnds = Date.now() + this.graceMs;
    while (Date.now() < graceEnds && this.anyKnownAlive()) await sleep(POLL_MS);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const live = await this.collect(true);
      if (!live.some((row) => !row.zombie)) return;
      this.signalAll('SIGKILL');
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function processStartTime(pid: number): string | null {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      if (close < 0) return null;
      const start = Number(stat.slice(close + 2).split(' ')[19]);
      return Number.isInteger(start) ? String(start) : null;
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export class StepReaper {
  private readonly starts = new Map<number, string | null>();

  constructor(
    private readonly marker: TreeMarker,
    private readonly graceMs: number,
  ) {}

  private async members(): Promise<Map<number, ProcessRow>> {
    const linux = process.platform === 'linux';
    const rows = linux ? await readLinuxProcesses() : await readPortableProcesses();
    const byId = new Map(rows.map((row) => [row.pid, row]));
    let holders: number[] = [];
    if (linux) holders = await markerHolders(rows, this.marker);
    else if (process.platform === 'darwin')
      holders = await darwinMarkerHolders(rows, this.marker, new Set());
    const members = new Map<number, ProcessRow>();
    for (const pid of holders) {
      if (pid === process.pid || pid === process.ppid) continue;
      const row = byId.get(pid);
      if (row !== undefined) members.set(pid, row);
    }
    for (const pid of [...this.starts.keys()]) if (!members.has(pid)) this.starts.delete(pid);
    for (const pid of members.keys()) this.starts.set(pid, processStartTime(pid));
    return members;
  }

  private signal(members: ReadonlyMap<number, ProcessRow>, signal: NodeJS.Signals): void {
    for (const pid of members.keys()) {
      if (pid <= 1) continue;
      const recorded = this.starts.get(pid);
      const current = processStartTime(pid);
      if (recorded != null && current !== null && recorded !== current) continue;
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }

  async reap(): Promise<number> {
    let live = await this.members();
    const seen = live.size;
    if (live.size === 0) return seen;
    this.signal(live, 'SIGTERM');
    const graceEnds = Date.now() + this.graceMs;
    while (Date.now() < graceEnds) {
      await sleep(POLL_MS);
      live = await this.members();
      if (![...live.values()].some((row) => !row.zombie)) return seen;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      this.signal(live, 'SIGKILL');
      await sleep(POLL_MS);
      live = await this.members();
      if (![...live.values()].some((row) => !row.zombie)) return seen;
    }
    return seen;
  }
}
