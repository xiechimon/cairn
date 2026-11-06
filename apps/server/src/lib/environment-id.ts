import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ENVIRONMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_MODE = 0o600;

export function environmentIdPathOf(dataDir: string): string {
  return join(dataDir, 'environment-id');
}

function readValid(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return ENVIRONMENT_ID_PATTERN.test(raw) ? raw : null;
}

export function loadOrCreateEnvironmentId(path: string): string {
  const existing = readValid(path);
  if (existing !== null) return existing;
  mkdirSync(dirname(path), { recursive: true });
  const candidate = randomUUID();
  const temp = `${path}.${process.pid}.${candidate.slice(0, 8)}.tmp`;
  writeFileSync(temp, `${candidate}\n`, { mode: FILE_MODE });
  try {
    try {
      linkSync(temp, path);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const winner = readValid(path);
    if (winner !== null) return winner;
    unlinkSync(path);
    linkSync(temp, path);
    return candidate;
  } finally {
    unlinkSync(temp);
  }
}
