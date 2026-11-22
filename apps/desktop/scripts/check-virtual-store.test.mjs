import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkVirtualStore } from './check-virtual-store.mjs';

test('rejects package payloads in the virtual store but allows hoisted nested copies', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-virtual-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const nested = join(root, 'node_modules', 'parent', 'node_modules', 'child');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'package.json'), '{}');
  assert.doesNotThrow(() => checkVirtualStore(root));
  const payload = join(root, 'node_modules', '.pnpm', 'child', 'node_modules', 'child');
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, 'package.json'), '{}');
  assert.throws(() => checkVirtualStore(root), /package payload or symlink in virtual store/);
  rmSync(payload, { recursive: true });
  symlinkSync(nested, payload, 'dir');
  assert.throws(() => checkVirtualStore(root), /package payload or symlink in virtual store/);
});
