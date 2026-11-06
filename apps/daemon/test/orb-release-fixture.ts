import { existsSync, mkdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const root = makeTestTempDir('orb-entry-');
const fixtureRelease = '0.2.2-abcd-dist-aaaaaaaaaaaaaaaa';
const entry = join(root, 'releases', fixtureRelease, 'dist', 'cli.mjs');
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, '');
afterAll(() => releaseTestTempDir(root));

export function orbTestEntry(socketPath: string): string {
  const current = join(dirname(socketPath), '../../dist/current/dist/cli.mjs');
  return existsSync(current) ? current : entry;
}

export function orbTestRelease(socketPath: string): string {
  const current = join(dirname(socketPath), '../../dist/current');
  return existsSync(current) ? basename(readlinkSync(current)) : fixtureRelease;
}
