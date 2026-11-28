import { cpSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

export interface MoveToTrashOpts {
  platform?: NodeJS.Platform;
  homeDir?: string;
  cairnHome?: string;
  xdgDataHome?: string;
  now?: Date;
}

export function moveToTrash(target: string, opts: MoveToTrashOpts = {}): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? homedir();
  const name = basename(target);
  if (platform === 'darwin') {
    try {
      return intoDir(join(home, '.Trash'), target, name);
    } catch (error) {
      if (!isSystemRefusal(error)) throw error;
      return intoCairnTrash(opts, target, name);
    }
  }
  if (platform === 'linux') {
    const dataHome = opts.xdgDataHome ?? process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
    const filesDir = join(dataHome, 'Trash', 'files');
    const infoDir = join(dataHome, 'Trash', 'info');
    mkdirSync(filesDir, { recursive: true });
    mkdirSync(infoDir, { recursive: true });
    const dest = freeName(
      filesDir,
      name,
      (candidate) => taken(candidate) || taken(trashInfo(infoDir, candidate)),
    );
    const info = trashInfo(infoDir, dest);
    try {
      writeFileSync(
        info,
        `[Trash Info]\nPath=${encodePath(target)}\nDeletionDate=${deletionDate(opts.now ?? new Date())}\n`,
        { flag: 'wx' },
      );
      moveInto(target, dest);
    } catch (error) {
      rmSync(info, { force: true });
      throw error;
    }
    return dest;
  }
  return intoCairnTrash(opts, target, name);
}

export function cairnTrashDir(opts: MoveToTrashOpts = {}): string {
  return join(opts.cairnHome ?? join(opts.homeDir ?? homedir(), '.cairn'), 'trash');
}

export function isCairnTrashPath(path: string, opts: MoveToTrashOpts = {}): boolean {
  return path.startsWith(`${cairnTrashDir(opts)}/`);
}

function isSystemRefusal(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EROFS' || code === 'EXDEV';
}

function intoCairnTrash(opts: MoveToTrashOpts, target: string, name: string): string {
  const stamp = deletionDate(opts.now ?? new Date()).replace(/[-:T]/g, '');
  return intoDir(cairnTrashDir(opts), target, `${stamp}-${name}`);
}

function trashInfo(infoDir: string, dest: string): string {
  return join(infoDir, `${basename(dest)}.trashinfo`);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function deletionDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function intoDir(dir: string, target: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const dest = freeName(dir, name, taken);
  moveInto(target, dest);
  return dest;
}

function moveInto(target: string, dest: string): void {
  try {
    renameSync(target, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    cpSync(target, dest, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    rmSync(target, { recursive: true, force: true });
  }
}

function freeName(dir: string, name: string, isTaken: (path: string) => boolean): string {
  const ext = extname(name);
  const stem = ext === '' ? name : name.slice(0, -ext.length);
  let candidate = join(dir, name);
  for (let index = 2; isTaken(candidate); index += 1) {
    if (index > 999) throw new Error(`cannot find a free Trash name for ${name} in ${dir}`);
    candidate = join(dir, `${stem} ${index}${ext}`);
  }
  return candidate;
}

function taken(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}
