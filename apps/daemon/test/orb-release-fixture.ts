import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'orb-entry-'));
const fixtureRelease = '0.2.2-abcd-dist-aaaaaaaaaaaaaaaa';
const entry = join(root, 'releases', fixtureRelease, 'dist', 'cli.mjs');
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, '');
afterAll(() => rmSync(root, { recursive: true, force: true }));

export function orbTestEntry(socketPath: string): string {
  const current = join(dirname(socketPath), '../../dist/current/dist/cli.mjs');
  return existsSync(current) ? current : entry;
}

export function orbTestRelease(socketPath: string): string {
  const current = join(dirname(socketPath), '../../dist/current');
  return existsSync(current) ? basename(readlinkSync(current)) : fixtureRelease;
}
