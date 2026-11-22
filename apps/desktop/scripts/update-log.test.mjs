import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendUpdateLog, updateLogPath } from '../src/update-log.ts';

test('every rolled-back update leaves one dated line in its own log', () => {
  const userData = mkdtempSync(join(tmpdir(), 'cairn-update-log-'));
  appendUpdateLog(userData, 'rolled back 0.1.536 to 0.1.535: exit code 1', new Date(0));
  appendUpdateLog(userData, 'second line', new Date(0));
  const path = updateLogPath(userData);
  assert.equal(
    readFileSync(path, 'utf8'),
    '1970-01-01T00:00:00.000Z rolled back 0.1.536 to 0.1.535: exit code 1\n1970-01-01T00:00:00.000Z second line\n',
  );
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
