import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

export function workspacePackages(rootDir = root) {
  const yaml = readFileSync(resolve(rootDir, 'pnpm-workspace.yaml'), 'utf8');
  const entries = [...yaml.matchAll(/^ {2}- (\S+)\s*$/gm)].map((match) => match[1]);
  const dirs = [];
  for (const entry of entries) {
    const base = entry.endsWith('*') ? entry.slice(0, -1) : null;
    if (base !== null) {
      const children = readdirSync(resolve(rootDir, base), { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => `${base}${dirent.name}`);
      dirs.push(...children);
    } else {
      dirs.push(entry);
    }
  }
  return dirs
    .map((dir) => JSON.parse(readFileSync(resolve(rootDir, dir, 'package.json'), 'utf8')))
    .filter((pkg) => pkg.name);
}

test('the changeset config ignores exactly the private workspace packages and keeps the rest publishable', () => {
  const config = JSON.parse(readFileSync(resolve(root, '.changeset/config.json'), 'utf8'));
  const ignored = new Set(config.ignore ?? []);
  for (const pkg of workspacePackages()) {
    if (pkg.private === true) {
      assert.ok(
        ignored.has(pkg.name),
        `${pkg.name} is private but not in the changeset config ignore list`,
      );
    } else {
      assert.ok(
        !ignored.has(pkg.name),
        `${pkg.name} is publishable but the changeset config ignores it`,
      );
      assert.equal(
        pkg.publishConfig?.access,
        'public',
        `${pkg.name} publishConfig.access must be public`,
      );
    }
  }
});
