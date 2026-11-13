import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { machine } from '../db/schema.js';
import type { MachineDeps } from '../services/machine-deps.js';
import { revokeMachineToken } from '../services/machine-revoke.js';
import type { CoordinatorLogger } from './index.js';

const STORE_SUFFIXES = ['-shm', '-wal', ''];

export interface SidecarMigrationInput {
  machine: Pick<MachineDeps, 'db' | 'hub' | 'machineHub'>;
  homeDir: string;
  storageDir: string;
  sidecarMachineId: string | null;
  logger: CoordinatorLogger;
}

export function moveStoreFile(
  source: string,
  destination: string,
  rename: typeof renameSync = renameSync,
): void {
  try {
    rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    copyFileSync(source, destination);
    unlinkSync(source);
  }
}

export function migrateSidecarState(input: SidecarMigrationInput): {
  revoked: boolean;
  moved: string[];
} {
  const { machine: deps, homeDir, storageDir, sidecarMachineId, logger } = input;
  let revoked = false;
  if (sidecarMachineId !== null) {
    logger.warn(
      { machineId: sidecarMachineId },
      'CAIRN_COORDINATOR_MACHINE_ID is set but the Coordinator sidecar is gone; revoking that machine',
    );
    const row = deps.db.select().from(machine).where(eq(machine.id, sidecarMachineId)).get();
    if (row !== undefined) {
      revokeMachineToken(deps, row.id);
      revoked = true;
    }
  }
  const moved: string[] = [];
  const legacyDir = join(homeDir, 'coordinator', 'threads');
  if (!existsSync(legacyDir)) return { revoked, moved };
  mkdirSync(storageDir, { recursive: true });
  for (const name of readdirSync(legacyDir)) {
    if (!name.endsWith('.sqlite')) continue;
    const destination = join(storageDir, name);
    if (existsSync(destination)) continue;
    for (const suffix of STORE_SUFFIXES) {
      const source = join(legacyDir, `${name}${suffix}`);
      if (existsSync(source)) moveStoreFile(source, `${destination}${suffix}`);
    }
    moved.push(name);
  }
  if (moved.length > 0) logger.info({ moved }, 'moved sidecar Coordinator stores into the server');
  return { revoked, moved };
}
