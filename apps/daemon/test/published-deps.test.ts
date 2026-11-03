import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const requireManifest = createRequire(import.meta.url);
const daemonManifest = requireManifest('../package.json') as {
  dependencies: Record<string, string>;
};
const lockfile = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');

const SCOPED = /^'?(@earendil-works\/[^'@]+)'?: '?([0-9][^'\s]*)'?$/;

function daemonImporterLines(): string[] {
  const lines = lockfile.split('\n');
  const start = lines.indexOf('  apps/daemon:');
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  return lines.slice(start + 1, end);
}

function snapshotDependencies(key: string): [string, string][] {
  const snapshots = lockfile.slice(lockfile.lastIndexOf('\nsnapshots:'));
  const lines = snapshots.split('\n');
  const start = lines.findIndex((line) => line === `  '${key}':` || line === `  ${key}:`);
  if (start === -1) return [];
  const deps: [string, string][] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('    ')) break;
    const match = SCOPED.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) deps.push([match[1], match[2]]);
  }
  return deps;
}

function resolvedScopedVersions(): Map<string, string> {
  const importer = daemonImporterLines();
  const queue: [string, string][] = [];
  importer.forEach((line, i) => {
    const name = /^ {6}'(@earendil-works\/[^']+)':$/.exec(line)?.[1];
    const version = /^ {8}version: (\S+)$/.exec(importer[i + 2] ?? '')?.[1];
    if (name !== undefined && version !== undefined) queue.push([name, version]);
  });
  const resolved = new Map<string, string>();
  const seen = new Set<string>();
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [name, version] = next;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.set(name, version.replace(/\(.*$/, ''));
    queue.push(...snapshotDependencies(key));
  }
  return resolved;
}

describe('published CLI dependency pinning', () => {
  test('the lockfile resolves scoped packages the daemon ships against', () => {
    expect(resolvedScopedVersions().size).toBeGreaterThan(0);
  });

  test("every scoped package in the daemon's lockfile tree is a direct exact dependency", () => {
    for (const [name, version] of resolvedScopedVersions()) {
      const declared = daemonManifest.dependencies[name];
      expect(declared, `${name} missing from daemon dependencies`).toBeDefined();
      expect(declared, `${name} must be pinned exactly to ${version}`).toBe(version);
    }
  });
});
