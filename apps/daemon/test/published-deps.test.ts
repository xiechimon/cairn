import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const requireManifest = createRequire(import.meta.url);
const daemonManifest = requireManifest('../package.json') as {
  dependencies: Record<string, string>;
};
const lockfile = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8');

function resolvedScopedVersions(): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const match of lockfile.matchAll(/^\s+'(@earendil-works\/[^'@]+)@([0-9][0-9.]*)/gm)) {
    const [name, version] = [match[1], match[2]];
    if (name !== undefined && version !== undefined) resolved.set(name, version);
  }
  return resolved;
}

describe('published CLI dependency pinning', () => {
  test('the lockfile resolves scoped packages the daemon ships against', () => {
    expect(resolvedScopedVersions().size).toBeGreaterThan(0);
  });

  test('every scoped package in the lockfile tree is a direct exact dependency', () => {
    for (const [name, version] of resolvedScopedVersions()) {
      const declared = daemonManifest.dependencies[name];
      expect(declared, `${name} missing from daemon dependencies`).toBeDefined();
      expect(declared, `${name} must be pinned exactly to ${version}`).toBe(version);
    }
  });
});
