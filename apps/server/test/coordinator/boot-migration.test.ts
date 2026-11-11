import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { loadConfig } from '../../src/config.js';
import { warnTeamsWithoutCoordinatorRule } from '../../src/coordinator/boot-guard.js';
import { migrateSidecarState, moveStoreFile } from '../../src/coordinator/boot-migration.js';
import { machine, routingRule } from '../../src/db/schema.js';
import { bootServer, issueApiKey } from '../helpers.js';

const dirs: string[] = [];
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function dirsFor() {
  const home = makeTestTempDir('coord-boot-');
  dirs.push(home);
  return { home, storage: join(home, 'server', 'coordinator') };
}

describe('Coordinator sidecar boot migration', () => {
  it('copies and removes a store file when the rename crosses filesystems', () => {
    const { home } = dirsFor();
    const source = join(home, 'chief-x.sqlite');
    const destination = join(home, 'moved.sqlite');
    writeFileSync(source, 'x');
    const crossDevice = () => {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    };

    moveStoreFile(source, destination, crossDevice);

    expect(existsSync(source)).toBe(false);
    expect(readFileSync(destination, 'utf8')).toBe('x');
  });

  it('rethrows a rename failure that is not a cross-device move', () => {
    const { home } = dirsFor();
    const denied = () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    };
    expect(() => moveStoreFile(join(home, 'a'), join(home, 'b'), denied)).toThrow('denied');
  });

  it('moves a sidecar store that has no destination and leaves an existing one alone', () => {
    const { home, storage } = dirsFor();
    const legacy = join(home, 'coordinator', 'threads');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'chief-a.sqlite'), 'a');
    writeFileSync(join(legacy, 'chief-a.sqlite-wal'), 'wal');
    writeFileSync(join(legacy, 'chief-b.sqlite'), 'b');
    mkdirSync(storage, { recursive: true });
    writeFileSync(join(storage, 'chief-b.sqlite'), 'kept');
    const s = bootServer();
    disposers.push(() => s.dispose());

    const result = migrateSidecarState({
      machine: s,
      homeDir: home,
      storageDir: storage,
      sidecarMachineId: null,
      logger,
    });

    expect(result.moved).toEqual(['chief-a.sqlite']);
    expect(readdirSync(storage).sort()).toEqual([
      'chief-a.sqlite',
      'chief-a.sqlite-wal',
      'chief-b.sqlite',
    ]);
    expect(existsSync(join(legacy, 'chief-b.sqlite'))).toBe(true);
    expect(
      migrateSidecarState({
        machine: s,
        homeDir: home,
        storageDir: storage,
        sidecarMachineId: null,
        logger,
      }).moved,
    ).toEqual([]);
  });

  it('leaves the legacy main file in place when the WAL move fails', () => {
    const { home, storage } = dirsFor();
    const legacy = join(home, 'coordinator', 'threads');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'chief-a.sqlite'), 'a');
    writeFileSync(join(legacy, 'chief-a.sqlite-wal'), 'wal');
    mkdirSync(join(storage, 'chief-a.sqlite-wal'), { recursive: true });
    writeFileSync(join(storage, 'chief-a.sqlite-wal', 'blocker'), 'x');
    const s = bootServer();
    disposers.push(() => s.dispose());

    expect(() =>
      migrateSidecarState({
        machine: s,
        homeDir: home,
        storageDir: storage,
        sidecarMachineId: null,
        logger,
      }),
    ).toThrow();

    expect(existsSync(join(legacy, 'chief-a.sqlite'))).toBe(true);
    expect(readFileSync(join(legacy, 'chief-a.sqlite'), 'utf8')).toBe('a');
    expect(existsSync(join(storage, 'chief-a.sqlite'))).toBe(false);
  });

  it('revokes the machine named by the retired CAIRN_COORDINATOR_MACHINE_ID', async () => {
    const { home, storage } = dirsFor();
    const s = bootServer();
    disposers.push(() => s.dispose());
    const key = await issueApiKey(s);
    const enrolled = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: s.team.id, name: 'old-sidecar', cliVersion: '9.9.9' }),
    });
    expect(enrolled.status).toBeLessThan(300);
    const row = s.db.select().from(machine).get();
    expect(row?.tokenHash).not.toBeNull();

    const result = migrateSidecarState({
      machine: s,
      homeDir: home,
      storageDir: storage,
      sidecarMachineId: row?.id ?? null,
      logger,
    });

    expect(result.revoked).toBe(true);
    expect(
      s.db
        .select()
        .from(machine)
        .where(eq(machine.id, row?.id ?? ''))
        .get()?.tokenHash,
    ).toBeNull();
  });

  it('turns the in-server Coordinator on unless the flag is explicitly off', () => {
    const saved = process.env.CAIRN_COORDINATOR_IN_SERVER;
    try {
      delete process.env.CAIRN_COORDINATOR_IN_SERVER;
      expect(loadConfig().coordinatorInServer).toBe(true);
      process.env.CAIRN_COORDINATOR_IN_SERVER = '0';
      expect(loadConfig().coordinatorInServer).toBe(false);
      process.env.CAIRN_COORDINATOR_IN_SERVER = '1';
      expect(loadConfig().coordinatorInServer).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.CAIRN_COORDINATOR_IN_SERVER;
      else process.env.CAIRN_COORDINATOR_IN_SERVER = saved;
    }
  });

  it('logs one error per team without a coordinator rule and stays quiet once it has one', () => {
    const s = bootServer();
    disposers.push(() => s.dispose());
    const errors: object[] = [];
    const capture = { ...logger, error: (obj: object) => errors.push(obj) };

    expect(warnTeamsWithoutCoordinatorRule(s.db, capture)).toEqual([s.team.id]);
    expect(errors).toEqual([{ teamId: s.team.id }]);

    s.db
      .insert(routingRule)
      .values({
        id: 'rule-1',
        teamId: s.team.id,
        use: 'coordinator',
        provider: 'vani',
        modelId: 'deepseek/deepseek-v4.1-flash',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(warnTeamsWithoutCoordinatorRule(s.db, capture)).toEqual([]);
  });
});
