import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../test-tmpdir.mjs';

for (const unavailable of ['node', 'python3', 'sqlite3', 'rsync', 'gzip', 'tsx', null])
  test(`configured service launcher ${unavailable ? `rejects missing ${unavailable}` : 'uses the configured checkout and fresh mode'}`, () => {
    const dir = makeTestTempDir('restore-service-');
    const checkout = join(dir, 'checkout with spaces');
    const bin = join(dir, 'bin');
    mkdirSync(join(checkout, 'apps/server'), { recursive: true });
    mkdirSync(join(checkout, 'scripts/ops'), { recursive: true });
    mkdirSync(bin);
    symlinkSync('/bin/bash', join(bin, 'bash'));
    for (const tool of ['node', 'python3', 'sqlite3', 'rsync', 'gzip']) {
      if (tool === unavailable) continue;
      const path = join(bin, tool);
      writeFileSync(path, `#!/bin/sh\nexit ${tool === 'node' && unavailable === 'tsx' ? 42 : 0}\n`);
      chmodSync(path, 0o700);
    }
    writeFileSync(
      join(checkout, 'scripts/ops/restore-drill.sh'),
      '#!/bin/bash\nprintf "%s\\n" "$PWD" "$@"\n',
    );
    const result = spawnSync('/bin/bash', [join(import.meta.dirname, 'restore-drill-service.sh')], {
      encoding: 'utf8',
      env: {
        PATH: bin,
        CAIRN_CHECKOUT: checkout,
        LIVE_DB: '/fixture/server.db',
        BACKUP_ATTACHMENTS: '/fixture/archive',
        BACKUP_DB: '/fixture/backups',
        LIVE_ATTACHMENTS: '/fixture/attachments',
        SECRETBOX_KEY: '/fixture/key',
        RESTORE_DRILL_SCRATCH: '/fixture/scratch',
        RESTORE_DRILL_REPORT: '/fixture/report',
      },
    });
    if (unavailable) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`dependency unavailable: ${unavailable}`));
      assert.equal(result.stdout, '');
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.startsWith(`${checkout}\n--mode\nfresh\n`));
      assert.match(result.stdout, /--mode\nhourly/);
      assert.match(result.stdout, /--scratch\n\/fixture\/scratch-fresh/);
      assert.match(result.stdout, /--report\n\/fixture\/report-hourly/);
    }
  });
