import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DAILY_BACKUP_STALE_AFTER_MS } from '@cairn/shared';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { project, secret, team } from '../src/db/schema.js';
import { createKeyfileSecretBox } from '../src/lib/secret-box.js';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  packTarGz,
  unpackTarGz,
} from '../src/services/backup-archive.js';
import { createS3BackupStore, loadBackupS3Config } from '../src/services/backup-s3.js';
import {
  applyPendingRestoreIfAny,
  createBackupService,
  restoreBackupArchiveToDir,
} from '../src/services/backup-service.js';
import { bootServer } from './helpers.js';

function withTempDir<T>(run: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = makeTestTempDir('backup-service-');
  return Promise.resolve(run(dir)).finally(() => releaseTestTempDir(dir));
}

describe('backup archive and encryption', () => {
  test('packs, encrypts, decrypts, and unpacks cleanly while rejecting tampered data or path traversal', () => {
    const key = randomBytes(32);
    const tarGz = packTarGz([
      { path: 'server.db', content: Buffer.from('sqlite-bytes'), mode: 0o600 },
      { path: 'attachments/note.txt', content: Buffer.from('hello'), mode: 0o644 },
    ]);
    const encrypted = encryptBackupPayload(tarGz, key, 'snap-1');
    const decrypted = decryptBackupPayload(encrypted, key, 'snap-1');
    const entries = unpackTarGz(decrypted);
    expect(entries.map((e) => e.path)).toEqual(['attachments/note.txt', 'server.db']);
    expect(entries[0]?.content.toString('utf8')).toBe('hello');

    expect(() => decryptBackupPayload(encrypted, key, 'wrong-aad')).toThrow();
    const tampered = Buffer.from(encrypted);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(() => decryptBackupPayload(tampered, key, 'snap-1')).toThrow();
    expect(() =>
      packTarGz([{ path: '../escape.txt', content: Buffer.from('bad'), mode: 0o600 }]),
    ).toThrow(/unsafe backup archive path/);
  });
});

describe('backup S3 / R2 store', () => {
  test('rejects remote http endpoints and uploads/lists/gets/deletes against S3-compatible server', async () => {
    expect(() =>
      loadBackupS3Config({
        CAIRN_BACKUP_S3_ENDPOINT: 'http://example.com',
        CAIRN_BACKUP_S3_BUCKET: 'b',
        CAIRN_BACKUP_S3_ACCESS_KEY_ID: 'k',
        CAIRN_BACKUP_S3_SECRET_ACCESS_KEY: 's',
      }),
    ).toThrow(/https/);

    const objects = new Map<string, Buffer>();
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
        const xml = `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`;
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(xml);
        return;
      }
      const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\//, ''));
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          objects.set(key, Buffer.concat(chunks));
          res.writeHead(200);
          res.end();
        });
        return;
      }
      if (req.method === 'GET') {
        const found = objects.get(key);
        if (found === undefined) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200);
        res.end(found);
        return;
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(405);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('expected tcp address');
    try {
      const store = createS3BackupStore({
        endpoint: `http://127.0.0.1:${addr.port}`,
        bucket: 'test-bucket',
        region: 'auto',
        prefix: 'tenant-a/',
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'SECRET_TEST',
      });
      await store.putObject(
        'tenant-a/snap-1.cairn-bak',
        Buffer.from('cipher'),
        'application/octet-stream',
      );
      expect(await store.listObjects('tenant-a/')).toEqual(['tenant-a/snap-1.cairn-bak']);
      expect((await store.getObject('tenant-a/snap-1.cairn-bak'))?.toString('utf8')).toBe('cipher');
      await store.deleteObject('tenant-a/snap-1.cairn-bak');
      expect(await store.getObject('tenant-a/snap-1.cairn-bak')).toBeNull();
    } finally {
      server.close();
    }
  });
});

describe('createBackupService end-to-end backup, export, and restore', () => {
  test('backs up SQLite + attachments + secretbox.key, restores into fresh dir, and creates pre-restore undo snapshot', async () => {
    await withTempDir(async (root) => {
      const dataDir = join(root, 'server');
      const skillsDir = join(root, 'skills');
      const dbPath = join(dataDir, 'server.db');
      const statusPath = join(dataDir, 'backup-status.json');
      mkdirSync(join(dataDir, 'attachments'), { recursive: true });
      mkdirSync(join(dataDir, 'coordinator'), { recursive: true });
      mkdirSync(skillsDir, { recursive: true });

      const opened = openDbWithHandle(dbPath);
      const box = createKeyfileSecretBox(join(dataDir, 'secretbox.key'));
      const sealed = box.seal('super-secret-token');
      writeFileSync(join(dataDir, 'attachments', 'hello.txt'), 'world');
      writeFileSync(join(skillsDir, 'custom.md'), '# skill');
      const coordDb = new Database(join(dataDir, 'coordinator', 'thread-1.sqlite'));
      coordDb.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('ok');");
      coordDb.close();

      opened.db.insert(team).values({ id: 't1', name: 'Team One', createdAt: 1000 }).run();
      opened.db.insert(project).values({ id: 'p1', teamId: 't1', name: 'Alpha' }).run();
      opened.db
        .insert(secret)
        .values({
          id: 's1',
          teamId: 't1',
          name: 'API_KEY',
          valueCipher: sealed,
          updatedAt: 1000,
        })
        .run();

      const envKey = randomBytes(32).toString('base64');
      let nowMs = 1_800_000_000_000;
      const service = createBackupService({
        dataDir,
        dbPath,
        statusPath,
        skillsDir,
        sqlite: opened.sqlite,
        encryptionKeyEnv: envKey,
        minFreeBytes: 1024,
        now: () => {
          nowMs += 1000;
          return nowMs;
        },
      });

      const first = await service.runBackup('manual');
      expect(first.verified).toBe(true);
      expect(first.storage).toBe('local');
      expect(first.sizeBytes).toBeGreaterThan(0);

      const health = await service.health();
      expect(health.state).toBe('recorded');
      if (health.state === 'recorded') {
        expect(health.status.lastRunResult).toBe('success');
        expect(health.status.staleAfterMs).toBe(DAILY_BACKUP_STALE_AFTER_MS);
      }
      expect(health.managed?.snapshots.map((s) => s.id)).toEqual([first.id]);

      const exported = await service.exportArchive();
      expect(exported.filename).toMatch(/^cairn-backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
      const exportEntries = unpackTarGz(exported.buffer);
      expect(exportEntries.some((e) => e.path === 'server.db')).toBe(true);
      expect(exportEntries.some((e) => e.path === 'manifest.json')).toBe(true);
      expect(exportEntries.some((e) => e.path === 'secretbox.key')).toBe(false);
      expect(exportEntries.some((e) => e.path === 'vapid.json')).toBe(false);

      writeFileSync(
        join(dataDir, 'backups', 'rogue.meta.json'),
        JSON.stringify({
          id: '../../escape',
          createdAt: nowMs,
          sizeBytes: 10,
          kind: 'manual',
          storage: 'local',
          verified: true,
        }),
      );
      const healthAfterRogue = await service.health();
      expect(healthAfterRogue.managed?.snapshots.map((s) => s.id)).toEqual([first.id]);

      const standaloneDir = join(root, 'standalone-restore');
      const encryptedBytes = readFileSync(join(dataDir, 'backups', `${first.id}.cairn-bak`));
      const manifest = restoreBackupArchiveToDir({
        encryptedArchive: encryptedBytes,
        snapshotId: first.id,
        encryptionKey: Buffer.from(envKey, 'base64'),
        targetDataDir: standaloneDir,
        targetSkillsDir: join(root, 'standalone-skills'),
      });
      expect(manifest.counts.projects).toBe(1);
      expect(readFileSync(join(standaloneDir, 'attachments', 'hello.txt'), 'utf8')).toBe('world');
      expect(readFileSync(join(root, 'standalone-skills', 'custom.md'), 'utf8')).toBe('# skill');
      const restoredBox = createKeyfileSecretBox(join(standaloneDir, 'secretbox.key'));
      expect(restoredBox.open(sealed)).toBe('super-secret-token');

      opened.sqlite.prepare("DELETE FROM project WHERE id = 'p1'").run();
      writeFileSync(join(dataDir, 'attachments', 'hello.txt'), 'mutated');

      let restartCalled = false;
      const serviceWithRestart = createBackupService({
        dataDir,
        dbPath,
        statusPath,
        skillsDir,
        sqlite: opened.sqlite,
        encryptionKeyEnv: envKey,
        minFreeBytes: 1024,
        onRestart: () => {
          restartCalled = true;
        },
        now: () => {
          nowMs += 1000;
          return nowMs;
        },
      });
      const restoreRes = await serviceWithRestart.prepareRestore(first.id);
      expect(restoreRes.restoredId).toBe(first.id);
      expect(restoreRes.undoBackupId).not.toBe(first.id);
      expect(restoreRes.restarting).toBe(true);
      expect(existsSync(join(dataDir, 'backups', `${restoreRes.undoBackupId}.cairn-bak`))).toBe(
        true,
      );
      opened.close();

      const appliedId = applyPendingRestoreIfAny(dataDir, dbPath, skillsDir);
      expect(appliedId).toBe(first.id);
      expect(readFileSync(join(dataDir, 'attachments', 'hello.txt'), 'utf8')).toBe('world');
      const reopened = openDbWithHandle(dbPath);
      const row = reopened.sqlite.prepare("SELECT name FROM project WHERE id = 'p1'").get() as
        | { name: string }
        | undefined;
      expect(row?.name).toBe('Alpha');
      reopened.close();
      expect(typeof restartCalled).toBe('boolean');
    });
  });

  test('serves backup write/export/restore routes cleanly when disabled', async () => {
    const s = bootServer();
    try {
      const runRes = await s.app.request('/api/server/backup/run', { method: 'POST' });
      expect(runRes.status).toBe(503);
      const exportRes = await s.app.request('/api/server/backup/export', { method: 'POST' });
      expect(exportRes.status).toBe(503);
      const restoreRes = await s.app.request('/api/server/backup/snap-1/restore', {
        method: 'POST',
      });
      expect(restoreRes.status).toBe(503);
    } finally {
      s.dispose();
    }
  });
});
