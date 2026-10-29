import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(dir, PRIVATE_DIR_MODE);
}

export function writePrivateFile(path: string, contents: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing to write through symlink: ${path}`);
  }
  writeFileSync(path, contents, { mode: PRIVATE_FILE_MODE });
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing to chmod through symlink: ${path}`);
  }
  chmodSync(path, PRIVATE_FILE_MODE);
}
