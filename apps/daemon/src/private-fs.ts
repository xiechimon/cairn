import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(dir, PRIVATE_DIR_MODE);
}

export function writePrivateFile(path: string, contents: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  try {
    writeSync(fd, contents);
    fchmodSync(fd, PRIVATE_FILE_MODE);
  } finally {
    closeSync(fd);
  }
}
