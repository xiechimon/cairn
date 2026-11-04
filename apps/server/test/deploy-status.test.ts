import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { deployRecordPathOf } from '../src/config.js';
import { readDeployStatus } from '../src/services/deploy-status.js';
import { bootServer } from './helpers.js';

const OWNER_TOKEN = 'cairn-owner-deploy-status-2427';

const RECORD = {
  sha: 'a'.repeat(40),
  previous: 'b'.repeat(40),
  result: 'ok',
  failed: '',
  snapshot: 'snap-1',
  at: '2026-11-03T10:00:00Z',
  host: 'omarchy',
};

function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = makeTestTempDir('deploy-status-');
  return run(dir).finally(() => releaseTestTempDir(dir));
}

describe('deploy record path', () => {
  test('lives next to server.db in the data dir', () => {
    expect(deployRecordPathOf({ dbPath: '/srv/cairn/server/server.db' })).toBe(
      '/srv/cairn/server/deploy.json',
    );
  });
});

describe('readDeployStatus', () => {
  test('a missing, malformed or wrong-shaped file reads as not deployed', () =>
    withTempDir(async (dir) => {
      const path = join(dir, 'deploy.json');
      expect(readDeployStatus(path)).toEqual({ deployed: null });
      expect(readDeployStatus(undefined)).toEqual({ deployed: null });
      writeFileSync(path, '{"sha":');
      expect(readDeployStatus(path)).toEqual({ deployed: null });
      writeFileSync(path, JSON.stringify({ sha: 7 }));
      expect(readDeployStatus(path)).toEqual({ deployed: null });
      writeFileSync(path, '[]');
      expect(readDeployStatus(path)).toEqual({ deployed: null });
      expect(readDeployStatus(dir)).toEqual({ deployed: null });
    }));
});

describe('GET /api/server/deploy', () => {
  test('reports the record on every request, so a rollback shows without a restart', () =>
    withTempDir(async (dir) => {
      const path = join(dir, 'deploy.json');
      const s = bootServer({ deployRecordPath: path });
      const none = await s.app.request('/api/server/deploy');
      expect(none.status).toBe(200);
      expect(await none.json()).toEqual({ deployed: null });
      writeFileSync(path, JSON.stringify(RECORD));
      const ok = await s.app.request('/api/server/deploy');
      expect(await ok.json()).toEqual({ deployed: RECORD });
      const rolledBack = { ...RECORD, sha: RECORD.previous, result: 'rolled-back' };
      writeFileSync(path, JSON.stringify(rolledBack));
      const after = await s.app.request('/api/server/deploy');
      expect(await after.json()).toEqual({ deployed: rolledBack });
    }));

  test('a server without a record path reports not deployed', async () => {
    const s = bootServer();
    const res = await s.app.request('/api/server/deploy');
    expect(await res.json()).toEqual({ deployed: null });
  });

  test('an anonymous request is rejected when auth is on', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    expect((await s.app.request('/api/server/deploy')).status).toBe(401);
    const ok = await s.app.request('/api/server/deploy', {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(ok.status).toBe(200);
  });
});
