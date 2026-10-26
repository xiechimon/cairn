import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const TMP_ROOT = resolve(tmpdir());

export function finishSweep(manifestPath) {
  let text = '';
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const leaked = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const resolved = resolve(trimmed);
    if (resolved === TMP_ROOT || !resolved.startsWith(`${TMP_ROOT}${sep}`)) continue;
    try {
      lstatSync(resolved);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    leaked.push(resolved);
    rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
  rmSync(manifestPath, { force: true });
  if (leaked.length === 0) return leaked;
  console.error(`[tmpdir-sweep] ${leaked.length} temp dir(s) survived the run:`);
  for (const dir of leaked.slice(0, 20)) console.error(`  ${dir}`);
  throw new Error(`${leaked.length} test temp dir(s) were not removed`);
}

export default function setup() {
  const manifest = join(tmpdir(), `cairn-tmp-manifest-${randomBytes(8).toString('hex')}`);
  writeFileSync(manifest, '');
  process.env.CAIRN_TEST_TMP_MANIFEST = manifest;
  return () => finishSweep(manifest);
}
