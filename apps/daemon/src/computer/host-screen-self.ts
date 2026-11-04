import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_DEPTH = 64;
const BROWSER_NAME =
  /chrom|firefox|brave|vivaldi|edge|opera|zen|librewolf|epiphany|safari|browser/i;

export type ParentOf = (pid: number) => Promise<number | undefined>;

export async function parentOfProcess(pid: number): Promise<number | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  if (stat !== undefined) {
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    return Number.isInteger(parent) ? parent : undefined;
  }
  const { stdout } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(pid)]).catch(() => ({
    stdout: '',
  }));
  const parent = Number.parseInt(stdout.trim(), 10);
  return Number.isInteger(parent) ? parent : undefined;
}

export async function isDaemonProcess(
  pid: number,
  daemonPid: number = process.pid,
  parentOf: ParentOf = parentOfProcess,
): Promise<boolean> {
  let current: number | undefined = pid;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current > 1; depth += 1) {
    if (current === daemonPid) return true;
    current = await parentOf(current);
  }
  return false;
}

export function isBrowserApp(appName: string): boolean {
  return BROWSER_NAME.test(appName);
}

export function originHosts(origins: readonly string[]): string[] {
  const hosts: string[] = [];
  for (const origin of origins) {
    const text = origin.trim();
    if (text === '') continue;
    try {
      hosts.push(new URL(text.includes('://') ? text : `https://${text}`).host.toLowerCase());
    } catch {
      hosts.push(text.toLowerCase());
    }
  }
  return hosts;
}

export function showsCairn(texts: readonly string[], hosts: readonly string[]): boolean {
  return texts.some((text) => {
    const lower = text.toLowerCase();
    return hosts.some((host) => lower.includes(host));
  });
}
