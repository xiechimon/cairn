import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BROWSER_AUTH_HEADER, DAILY_BACKUP_STALE_AFTER_MS } from '@cairn/shared';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import {
  antigravitySubscription,
  imConnection,
  mailAccount,
  message,
  project,
  provider,
  schedule,
  secret,
  team,
  todo,
  user,
} from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { createKeyfileSecretBox } from '../src/lib/secret-box.js';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  extractTarGzStreamToDir,
  packTarGz,
  sha256Hex,
  unpackTarGz,
} from '../src/services/backup-archive.js';
import { createS3BackupStore, loadBackupS3Config } from '../src/services/backup-s3.js';
import {
  applyPendingRestoreIfAny,
  BackupImportInvalidError,
  BackupInProgressError,
  createBackupService,
  restoreBackupArchiveToDir,
} from '../src/services/backup-service.js';
import { openProviderKey } from '../src/services/providers.js';
import { createSecret, listSecretsWithEnvValues } from '../src/services/secrets.js';
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
      expect(exportEntries.some((e) => e.path === 'environment-id')).toBe(false);
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
  }, 60_000);

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
      const importRes = await s.app.request('/api/server/backup/import', { method: 'POST' });
      expect(importRes.status).toBe(503);
    } finally {
      s.dispose();
    }
  }, 60_000);

  test('exportArchive captures new writes immediately instead of reusing a recent snapshot', async () => {
    await withTempDir(async (root) => {
      const dataDir = join(root, 'src');
      const dbPath = join(dataDir, 'server.db');
      const opened = openDbWithHandle(dbPath);
      opened.db.insert(team).values({ id: 't1', name: 'Source Team', createdAt: 1000 }).run();
      opened.db.insert(project).values({ id: 'p1', teamId: 't1', name: 'Initial Project' }).run();
      let nowMs = 1_800_000_000_000;
      const service = createBackupService({
        dataDir,
        dbPath,
        statusPath: join(dataDir, 'backup-status.json'),
        sqlite: opened.sqlite,
        minFreeBytes: 1024,
        now: () => {
          nowMs += 1000;
          return nowMs;
        },
      });
      await service.runBackup('manual');
      opened.db
        .insert(project)
        .values({ id: 'p2', teamId: 't1', name: 'Fresh Exported Project' })
        .run();
      const exported = await service.exportArchive();
      const entries = unpackTarGz(exported.buffer);
      const manifestEntry = entries.find((e) => e.path === 'manifest.json');
      expect(manifestEntry).toBeDefined();
      const manifest = JSON.parse(manifestEntry?.content.toString('utf8') ?? '{}') as {
        counts?: { projects?: number };
      };
      expect(manifest.counts?.projects).toBe(2);
      opened.close();
    });
  });

  test('prepareImport imports portable archive cleanly across hosts, pauses external connectors, and supports undo', async () => {
    await withTempDir(async (root) => {
      const srcDir = join(root, 'source');
      const srcDbPath = join(srcDir, 'server.db');
      mkdirSync(join(srcDir, 'attachments'), { recursive: true });
      mkdirSync(join(srcDir, 'repos'), { recursive: true });
      mkdirSync(join(srcDir, 'coordinator'), { recursive: true });
      const srcOpened = openDbWithHandle(srcDbPath);
      writeFileSync(join(srcDir, 'environment-id'), 'source-env-id');
      writeFileSync(join(srcDir, 'vapid.json'), '{"publicKey":"src"}');
      const srcBox = createKeyfileSecretBox(join(srcDir, 'secretbox.key'));
      writeFileSync(join(srcDir, 'attachments', 'note.txt'), 'migrated-attachment');
      writeFileSync(join(srcDir, 'repos', 'repo.txt'), 'migrated-repo');
      const srcCoord = new Database(join(srcDir, 'coordinator', 'c1.sqlite'));
      srcCoord.exec("CREATE TABLE c (v TEXT); INSERT INTO c VALUES ('coord-ok');");
      srcCoord.close();

      srcOpened.db.insert(user).values({ id: 'u1', displayName: 'Owner' }).run();
      srcOpened.db.insert(team).values({ id: 't1', name: 'Source Team', createdAt: 1000 }).run();
      srcOpened.db
        .insert(project)
        .values({ id: 'p1', teamId: 't1', name: 'Imported Project' })
        .run();
      srcOpened.db
        .insert(todo)
        .values({
          id: 'td1',
          teamId: 't1',
          projectId: 'p1',
          title: 'Imported Todo',
          phase: 'todo',
          phaseAt: 1000,
          seqNum: 1,
        })
        .run();
      srcOpened.db
        .insert(message)
        .values({
          id: 'm1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'hello export',
          createdAt: 1000,
        })
        .run();
      srcOpened.db
        .insert(imConnection)
        .values({
          id: 'im1',
          teamId: 't1',
          userId: 'u1',
          platform: 'telegram',
          accountLabel: '@source_bot',
          secretCipher: srcBox.seal('{"botToken":"123"}'),
          pairedSenders: [],
          status: 'ready',
          pollOffset: '42',
          createdAt: 1000,
          updatedAt: 1000,
        })
        .run();
      srcOpened.db
        .insert(schedule)
        .values({
          id: 'sch1',
          teamId: 't1',
          projectId: 'p1',
          todoId: 'td1',
          kind: 'cron',
          cron: '0 * * * *',
          prompt: 'ping',
          enabled: true,
          tz: 'UTC',
          createdBy: 'u1',
        })
        .run();
      srcOpened.db
        .insert(mailAccount)
        .values({
          id: 'mail1',
          teamId: 't1',
          userId: 'u1',
          provider: 'imap',
          mailbox: 'ops@example.com',
          status: 'watching',
          createdAt: 1000,
          updatedAt: 1000,
        })
        .run();
      srcOpened.db
        .insert(provider)
        .values({
          id: 'prov1',
          teamId: 't1',
          kind: 'custom',
          providerId: 'custom-llm',
          label: 'Custom LLM',
          baseUrl: 'https://llm.example.com/v1',
          api: 'openai-completions',
          authHeader: true,
          compat: {
            supportsDeveloperRole: true,
          },
          apiKeyCipher: srcBox.seal('sk-source-provider-secret'),
          createdBy: 'u1',
          createdAt: 1000,
          updatedAt: 1000,
        })
        .run();
      createSecret(
        { db: srcOpened.db, box: srcBox },
        {
          teamId: 't1',
          name: 'PORTABLE_ENV_VAR',
          value: 'source-env-secret',
          kind: 'env',
        },
      );

      let nowMs = 1_800_000_000_000;
      const srcService = createBackupService({
        dataDir: srcDir,
        dbPath: srcDbPath,
        statusPath: join(srcDir, 'backup-status.json'),
        sqlite: srcOpened.sqlite,
        minFreeBytes: 1024,
        now: () => {
          nowMs += 1000;
          return nowMs;
        },
      });
      const exported = await srcService.exportArchive();
      srcOpened.close();

      const dstDir = join(root, 'target');
      const dstDbPath = join(dstDir, 'server.db');
      mkdirSync(dstDir, { recursive: true });
      writeFileSync(join(dstDir, 'environment-id'), 'target-env-id-keep');
      writeFileSync(join(dstDir, 'vapid.json'), '{"publicKey":"target-keep"}');
      const dstKeyPath = join(dstDir, 'secretbox.key');
      createKeyfileSecretBox(dstKeyPath);
      const dstKeyHashBefore = sha256Hex(readFileSync(dstKeyPath));

      const dstOpened = openDbWithHandle(dstDbPath);
      dstOpened.db.insert(team).values({ id: 't1', name: 'Target Team', createdAt: 1000 }).run();
      dstOpened.db
        .insert(project)
        .values({ id: 'p-orig', teamId: 't1', name: 'Original Target Project' })
        .run();

      let restarted = false;
      const dstService = createBackupService({
        dataDir: dstDir,
        dbPath: dstDbPath,
        statusPath: join(dstDir, 'backup-status.json'),
        sqlite: dstOpened.sqlite,
        minFreeBytes: 1024,
        onRestart: () => {
          restarted = true;
        },
        now: () => {
          nowMs += 1000;
          return nowMs;
        },
      });

      const importRes = await dstService.prepareImport(exported.buffer);
      expect(importRes.importedId).toBe(exported.snapshotId);
      expect(importRes.restarting).toBe(true);
      expect(importRes.pausedImConnections).toBe(1);
      expect(importRes.pausedSchedules).toBe(1);
      expect(importRes.pausedMailAccounts).toBe(1);
      expect(importRes.clearedCredentials).toBe(3);
      expect(importRes.resealedCredentials).toBe(0);
      expect(importRes.counts).toEqual({ projects: 1, todos: 1, messages: 1 });
      await expect(dstService.prepareImport(exported.buffer)).rejects.toBeInstanceOf(
        BackupInProgressError,
      );
      dstOpened.close();

      const appliedId = applyPendingRestoreIfAny(dstDir, dstDbPath);
      expect(appliedId).toBe(exported.snapshotId);
      expect(readFileSync(join(dstDir, 'environment-id'), 'utf8')).toBe('target-env-id-keep');
      expect(readFileSync(join(dstDir, 'vapid.json'), 'utf8')).toBe('{"publicKey":"target-keep"}');
      expect(sha256Hex(readFileSync(dstKeyPath))).toBe(dstKeyHashBefore);
      expect(readFileSync(join(dstDir, 'attachments', 'note.txt'), 'utf8')).toBe(
        'migrated-attachment',
      );
      expect(readFileSync(join(dstDir, 'repos', 'repo.txt'), 'utf8')).toBe('migrated-repo');

      const afterImportDb = openDbWithHandle(dstDbPath);
      const dstBox = createKeyfileSecretBox(dstKeyPath);
      expect(() =>
        listSecretsWithEnvValues({ db: afterImportDb.db, box: dstBox }, 't1'),
      ).not.toThrow();
      const importedSecrets = listSecretsWithEnvValues({ db: afterImportDb.db, box: dstBox }, 't1');
      expect(importedSecrets[0]?.value).toBeUndefined();
      const importedProv = openProviderKey(
        { db: afterImportDb.db, box: dstBox },
        't1',
        'custom-llm',
      );
      expect(importedProv?.apiKey).toBeNull();
      const importedMail = afterImportDb.sqlite
        .prepare("SELECT status, lastError FROM mail_account WHERE id = 'mail1'")
        .get() as { status: string; lastError: string | null };
      expect(importedMail.status).toBe('disconnected');
      expect(importedMail.lastError).toMatch(/paused/i);
      const importedProj = afterImportDb.sqlite
        .prepare("SELECT name FROM project WHERE id = 'p1'")
        .get() as { name: string } | undefined;
      expect(importedProj?.name).toBe('Imported Project');
      const importedIm = afterImportDb.sqlite
        .prepare(
          "SELECT status, pollOffset, statusDetail, secretCipher FROM im_connection WHERE id = 'im1'",
        )
        .get() as {
        status: string;
        pollOffset: string | null;
        statusDetail: string | null;
        secretCipher: string;
      };
      expect(importedIm.status).toBe('expired');
      expect(importedIm.pollOffset).toBeNull();
      expect(dstBox.open(importedIm.secretCipher)).toBe('{}');
      const importedSch = afterImportDb.sqlite
        .prepare("SELECT enabled, pausedReason FROM schedule WHERE id = 'sch1'")
        .get() as { enabled: number; pausedReason: string | null };
      expect(importedSch.enabled).toBe(0);
      expect(importedSch.pausedReason).toMatch(/paused/i);

      const undoService = createBackupService({
        dataDir: dstDir,
        dbPath: dstDbPath,
        statusPath: join(dstDir, 'backup-status.json'),
        sqlite: afterImportDb.sqlite,
        minFreeBytes: 1024,
      });
      await undoService.prepareRestore(importRes.undoBackupId);
      afterImportDb.close();

      applyPendingRestoreIfAny(dstDir, dstDbPath);
      const restoredDb = openDbWithHandle(dstDbPath);
      const origProj = restoredDb.sqlite
        .prepare("SELECT name FROM project WHERE id = 'p-orig'")
        .get() as { name: string } | undefined;
      expect(origProj?.name).toBe('Original Target Project');
      restoredDb.close();
      expect(typeof restarted).toBe('boolean');
    });
  }, 60_000);

  test('applyPendingRestoreIfAny resolves symlinked dataDir across restarts cleanly', async () => {
    await withTempDir(async (root) => {
      const realHome = join(root, 'real-home');
      const linkHome = join(root, 'link-home');
      mkdirSync(join(realHome, 'server'), { recursive: true });
      symlinkSync(realHome, linkHome);

      const srcDir = join(root, 'src');
      const srcDbPath = join(srcDir, 'server.db');
      const srcOpened = openDbWithHandle(srcDbPath);
      srcOpened.db.insert(team).values({ id: 't1', name: 'T', createdAt: 1000 }).run();
      srcOpened.db
        .insert(project)
        .values({ id: 'p-sym', teamId: 't1', name: 'Symlink Alpha' })
        .run();
      const srcService = createBackupService({
        dataDir: srcDir,
        dbPath: srcDbPath,
        statusPath: join(srcDir, 'backup-status.json'),
        sqlite: srcOpened.sqlite,
        minFreeBytes: 1024,
      });
      const exported = await srcService.exportArchive();
      srcOpened.close();

      const symDataDir = join(linkHome, 'server');
      const symDbPath = join(symDataDir, 'server.db');
      const dstOpened = openDbWithHandle(symDbPath);
      dstOpened.db.insert(team).values({ id: 't1', name: 'T', createdAt: 1000 }).run();
      const dstService = createBackupService({
        dataDir: symDataDir,
        dbPath: symDbPath,
        statusPath: join(symDataDir, 'backup-status.json'),
        sqlite: dstOpened.sqlite,
        minFreeBytes: 1024,
      });
      const imported = await dstService.prepareImport(exported.buffer);
      dstOpened.close();

      const realDataDir = join(realHome, 'server');
      const realDbPath = join(realDataDir, 'server.db');
      const applied = applyPendingRestoreIfAny(realDataDir, realDbPath);
      expect(applied).toBe(imported.importedId);
      const reopened = openDbWithHandle(realDbPath);
      const row = reopened.sqlite.prepare("SELECT name FROM project WHERE id = 'p-sym'").get() as
        | { name: string }
        | undefined;
      expect(row?.name).toBe('Symlink Alpha');
      reopened.close();
    });
  }, 60_000);

  test('prepareImport re-seals all credentials onto target keyfile when archive includes secretbox.key', async () => {
    await withTempDir(async (root) => {
      const srcDir = join(root, 'src-keyed');
      const srcDbPath = join(srcDir, 'server.db');
      const srcOpened = openDbWithHandle(srcDbPath);
      const srcBox = createKeyfileSecretBox(join(srcDir, 'secretbox.key'));
      srcOpened.db.insert(user).values({ id: 'u1', displayName: 'Owner' }).run();
      srcOpened.db.insert(team).values({ id: 't1', name: 'Source', createdAt: 1000 }).run();
      createSecret(
        { db: srcOpened.db, box: srcBox },
        { teamId: 't1', name: 'MY_ENV', value: 'keep-me-across-hosts', kind: 'env' },
      );
      srcOpened.db
        .insert(provider)
        .values({
          id: 'prov1',
          teamId: 't1',
          kind: 'custom',
          providerId: 'my-prov',
          label: 'My Prov',
          baseUrl: 'https://llm.example.com/v1',
          api: 'openai-completions',
          authHeader: true,
          compat: {
            supportsDeveloperRole: true,
          },
          apiKeyCipher: srcBox.seal('sk-reseal-me'),
          createdBy: 'u1',
          createdAt: 1000,
          updatedAt: 1000,
        })
        .run();
      srcOpened.db
        .insert(imConnection)
        .values({
          id: 'im1',
          teamId: 't1',
          userId: 'u1',
          platform: 'telegram',
          accountLabel: '@bot',
          secretCipher: srcBox.seal('{"botToken":"keep-bot"}'),
          pairedSenders: [],
          status: 'ready',
          createdAt: 1000,
          updatedAt: 1000,
        })
        .run();
      srcOpened.db
        .insert(antigravitySubscription)
        .values({
          id: 'agy1',
          teamId: 't1',
          label: 'Personal Google',
          tokenCipher: `oauth-personal:v2:${srcBox.seal(
            JSON.stringify({ token: 'ya29.test', subject: 'sub-1' }),
          )}`,
          createdAt: 1000,
        })
        .run();

      const snapDir = join(root, 'snap-stage');
      mkdirSync(snapDir, { recursive: true });
      await srcOpened.sqlite.backup(join(snapDir, 'server.db'));
      writeFileSync(join(snapDir, 'secretbox.key'), readFileSync(join(srcDir, 'secretbox.key')));
      const serverDbBytes = readFileSync(join(snapDir, 'server.db'));
      const keyBytes = readFileSync(join(snapDir, 'secretbox.key'));
      const manifestBuf = Buffer.from(
        JSON.stringify({
          version: 1,
          id: 'snap-keyed-1',
          createdAt: 1000,
          kind: 'manual',
          files: {
            'server.db': sha256Hex(serverDbBytes),
            'secretbox.key': sha256Hex(keyBytes),
          },
          counts: { projects: 0, todos: 0, messages: 0 },
        }),
      );
      const keyedArchive = packTarGz([
        { path: 'server.db', content: serverDbBytes, mode: 0o600 },
        { path: 'secretbox.key', content: keyBytes, mode: 0o600 },
        { path: 'manifest.json', content: manifestBuf, mode: 0o600 },
      ]);
      srcOpened.close();

      const dstDir = join(root, 'dst-keyed');
      const dstDbPath = join(dstDir, 'server.db');
      const dstKeyPath = join(dstDir, 'secretbox.key');
      const dstBox = createKeyfileSecretBox(dstKeyPath);
      const dstKeyBefore = readFileSync(dstKeyPath, 'utf8');
      const dstOpened = openDbWithHandle(dstDbPath);
      dstOpened.db.insert(team).values({ id: 't1', name: 'Target', createdAt: 1000 }).run();
      const dstService = createBackupService({
        dataDir: dstDir,
        dbPath: dstDbPath,
        statusPath: join(dstDir, 'backup-status.json'),
        sqlite: dstOpened.sqlite,
        minFreeBytes: 1024,
      });
      const res = await dstService.prepareImport(keyedArchive);
      expect(res.resealedCredentials).toBe(4);
      expect(res.clearedCredentials).toBe(0);
      dstOpened.close();

      applyPendingRestoreIfAny(dstDir, dstDbPath);
      expect(readFileSync(dstKeyPath, 'utf8')).toBe(dstKeyBefore);

      const finalOpened = openDbWithHandle(dstDbPath);
      const envRows = listSecretsWithEnvValues({ db: finalOpened.db, box: dstBox }, 't1');
      expect(envRows[0]?.value).toBe('keep-me-across-hosts');
      expect(openProviderKey({ db: finalOpened.db, box: dstBox }, 't1', 'my-prov')?.apiKey).toBe(
        'sk-reseal-me',
      );
      const agyRow = finalOpened.sqlite
        .prepare("SELECT tokenCipher FROM antigravity_subscription WHERE id = 'agy1'")
        .get() as { tokenCipher: string };
      expect(agyRow.tokenCipher.startsWith('oauth-personal:v2:')).toBe(true);
      expect(
        JSON.parse(dstBox.open(agyRow.tokenCipher.slice('oauth-personal:v2:'.length))).token,
      ).toBe('ya29.test');
      const imRow = finalOpened.sqlite
        .prepare("SELECT secretCipher FROM im_connection WHERE id = 'im1'")
        .get() as { secretCipher: string };
      expect(dstBox.open(imRow.secretCipher)).toBe('{"botToken":"keep-bot"}');
      finalOpened.close();

      const sameOpened = openDbWithHandle(dstDbPath);
      const sameService = createBackupService({
        dataDir: dstDir,
        dbPath: dstDbPath,
        statusPath: join(dstDir, 'backup-status.json'),
        sqlite: sameOpened.sqlite,
        minFreeBytes: 1024,
      });
      const sameExport = await sameService.exportArchive();
      const sameRes = await sameService.prepareImport(sameExport.buffer);
      expect(sameRes.clearedCredentials).toBe(0);
      expect(sameRes.resealedCredentials).toBe(0);
      sameOpened.close();
    });
  }, 60_000);

  test('streaming extractor rejects decompression bombs, malformed tar octals, symlinks, and path traversal', async () => {
    await withTempDir(async (root) => {
      const bombRaw = Buffer.alloc(1024 * 1024, 0);
      const bombGz = gzipSync(bombRaw, { level: 9 });
      await expect(
        extractTarGzStreamToDir(bombGz, join(root, 'bomb-out'), { maxTotalBytes: 64 * 1024 }),
      ).rejects.toThrow(/exceeds safe extraction limits/);

      const badOctalHeader = Buffer.alloc(512, 0);
      badOctalHeader.write('evil.txt', 0, 100, 'utf8');
      badOctalHeader.write('0000600\0', 100, 8, 'ascii');
      badOctalHeader.write('10abc\0', 124, 12, 'ascii');
      badOctalHeader.write('0', 156, 1, 'ascii');
      badOctalHeader.write('ustar\0', 257, 6, 'ascii');
      const badOctalTar = gzipSync(Buffer.concat([badOctalHeader, Buffer.alloc(1024, 0)]));
      await expect(extractTarGzStreamToDir(badOctalTar, join(root, 'octal-out'))).rejects.toThrow(
        /malformed tar entry size/,
      );

      const dataDir = join(root, 'safe-host');
      const dbPath = join(dataDir, 'server.db');
      const opened = openDbWithHandle(dbPath);
      opened.db.insert(team).values({ id: 't1', name: 'Safe Team', createdAt: 1000 }).run();
      const service = createBackupService({
        dataDir,
        dbPath,
        statusPath: join(dataDir, 'backup-status.json'),
        sqlite: opened.sqlite,
        minFreeBytes: 1024,
      });

      const symlinkHeader = Buffer.alloc(512, 0);
      symlinkHeader.write('leak.txt', 0, 100, 'utf8');
      symlinkHeader.write('0000777\0', 100, 8, 'ascii');
      symlinkHeader.write('00000000000\0', 124, 12, 'ascii');
      symlinkHeader.write('2', 156, 1, 'ascii');
      symlinkHeader.write('/etc/passwd', 157, 100, 'utf8');
      symlinkHeader.write('ustar\0', 257, 6, 'ascii');
      const symlinkTar = gzipSync(Buffer.concat([symlinkHeader, Buffer.alloc(1024, 0)]));
      await expect(service.prepareImport(symlinkTar)).rejects.toBeInstanceOf(
        BackupImportInvalidError,
      );

      const traversalHeader = Buffer.alloc(512, 0);
      traversalHeader.write('../escape.txt', 0, 100, 'utf8');
      traversalHeader.write('0000600\0', 100, 8, 'ascii');
      traversalHeader.write('00000000000\0', 124, 12, 'ascii');
      traversalHeader.write('0', 156, 1, 'ascii');
      traversalHeader.write('ustar\0', 257, 6, 'ascii');
      const traversalTar = gzipSync(Buffer.concat([traversalHeader, Buffer.alloc(1024, 0)]));
      await expect(service.prepareImport(traversalTar)).rejects.toBeInstanceOf(
        BackupImportInvalidError,
      );

      const health = await service.health();
      expect(health.managed?.snapshots).toEqual([]);
      expect(existsSync(join(dataDir, '.restore-staged'))).toBe(false);
      opened.close();
    });
  }, 60_000);

  test('prepareImport rejects invalid or tampered archives without creating undo snapshots or mutating live data', async () => {
    await withTempDir(async (root) => {
      const dataDir = join(root, 'target');
      const dbPath = join(dataDir, 'server.db');
      const opened = openDbWithHandle(dbPath);
      opened.db.insert(team).values({ id: 't1', name: 'Safe Team', createdAt: 1000 }).run();
      const service = createBackupService({
        dataDir,
        dbPath,
        statusPath: join(dataDir, 'backup-status.json'),
        sqlite: opened.sqlite,
        minFreeBytes: 1024,
      });

      await expect(service.prepareImport(Buffer.from('not-gzip'))).rejects.toBeInstanceOf(
        BackupImportInvalidError,
      );
      const badManifestTar = packTarGz([
        { path: 'server.db', content: Buffer.from('corrupt-sqlite'), mode: 0o600 },
        {
          path: 'manifest.json',
          content: Buffer.from(
            JSON.stringify({
              version: 1,
              id: 'snap-bad-1',
              createdAt: 1000,
              kind: 'manual',
              files: { 'server.db': '0000' },
              counts: { projects: 0, todos: 0, messages: 0 },
            }),
          ),
          mode: 0o600,
        },
      ]);
      await expect(service.prepareImport(badManifestTar)).rejects.toBeInstanceOf(
        BackupImportInvalidError,
      );
      const health = await service.health();
      expect(health.managed?.snapshots).toEqual([]);
      opened.close();
    });
  }, 60_000);

  test('HTTP /api/server/backup/export and /import routes enforce auth, CSRF, size limit, multipart upload, and conflict state', async () => {
    await withTempDir(async (root) => {
      const dataDir = join(root, 'srv');
      const dbPath = join(dataDir, 'server.db');
      const opened = openDbWithHandle(dbPath);
      const seeded = seed(opened.db);
      opened.db
        .insert(project)
        .values({ id: 'p-http', teamId: seeded.team.id, name: 'HTTP Alpha' })
        .run();
      const backupService = createBackupService({
        dataDir,
        dbPath,
        statusPath: join(dataDir, 'backup-status.json'),
        sqlite: opened.sqlite,
        minFreeBytes: 1024,
      });
      const token = 'import-secret-token';
      const s = bootServer({
        db: opened.db,
        dataDir,
        backupService,
        authToken: token,
        webOrigin: 'http://localhost',
      });
      try {
        const unauthRes = await s.app.request('/api/server/backup/import', {
          method: 'POST',
          headers: { 'content-type': 'application/gzip' },
          body: Buffer.from('corrupt'),
        });
        expect(unauthRes.status).toBe(401);

        const sessionRes = await s.app.request('/api/auth/session', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            [BROWSER_AUTH_HEADER]: '1',
            origin: 'http://localhost',
          },
        });
        expect(sessionRes.status).toBe(204);
        const rawCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? '';
        expect(rawCookie).toContain('cairn_auth=');

        const csrfRes = await s.app.request('/api/server/backup/import', {
          method: 'POST',
          headers: {
            cookie: rawCookie,
            origin: 'https://evil.example',
            'content-type': 'application/gzip',
          },
          body: Buffer.from('corrupt'),
        });
        expect(csrfRes.status).toBe(403);

        const oversizedRes = await s.app.request('/api/server/backup/import', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/gzip',
            'content-length': String(257 * 1024 * 1024),
          },
          body: Buffer.from('small'),
        });
        expect(oversizedRes.status).toBe(413);

        const exportRes = await s.app.request('/api/server/backup/export', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(exportRes.status).toBe(200);
        const archive = Buffer.from(await exportRes.arrayBuffer());

        const badRes = await s.app.request('/api/server/backup/import', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
          body: Buffer.from('corrupt'),
        });
        expect(badRes.status).toBe(400);

        const form = new FormData();
        form.set('file', new File([archive], 'backup.tar.gz', { type: 'application/gzip' }));
        const goodRes = await s.app.request('/api/server/backup/import', {
          method: 'POST',
          headers: {
            cookie: rawCookie,
            origin: 'http://localhost',
          },
          body: form,
        });
        expect(goodRes.status).toBe(200);
        const body = (await goodRes.json()) as {
          importedId: string;
          undoBackupId: string;
          counts: { projects: number };
        };
        expect(body.counts.projects).toBe(1);
        expect(body.undoBackupId).toBeTruthy();

        const busyRes = await s.app.request('/api/server/backup/import', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip' },
          body: archive,
        });
        expect(busyRes.status).toBe(409);
      } finally {
        s.dispose();
        opened.close();
      }
    });
  }, 60_000);
});
