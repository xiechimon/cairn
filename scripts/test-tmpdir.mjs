import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const stateKey = Symbol.for('cairn.test-tmpdir');
if (!globalThis[stateKey]) {
  globalThis[stateKey] = {
    dirs: new Set(),
    exitHooked: false,
  };
}
const STATE = globalThis[stateKey];
const TMP_ROOT = resolve(tmpdir());

function removePath(path) {
  const resolved = resolve(path);
  if (resolved === TMP_ROOT || !resolved.startsWith(`${TMP_ROOT}${sep}`)) return;
  STATE.dirs.delete(resolved);
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
}

export function cleanupTestDirs(paths) {
  for (const path of paths) removePath(path);
}

export function cleanupAllTestDirs() {
  for (const dir of [...STATE.dirs]) removePath(dir);
}

function hookExit() {
  if (STATE.exitHooked) return;
  STATE.exitHooked = true;
  process.on('exit', () => {
    for (const dir of [...STATE.dirs]) {
      try {
        removePath(dir);
      } catch {
        STATE.dirs.add(dir);
      }
    }
  });
}

hookExit();

export function makeTestTempDir(prefix) {
  const stem = prefix.endsWith('-') ? prefix : `${prefix}-`;
  const dir = resolve(mkdtempSync(join(TMP_ROOT, stem)));
  STATE.dirs.add(dir);
  hookExit();
  const manifest = process.env.CAIRN_TEST_TMP_MANIFEST;
  if (manifest) appendFileSync(manifest, `${dir}\n`);
  return dir;
}
