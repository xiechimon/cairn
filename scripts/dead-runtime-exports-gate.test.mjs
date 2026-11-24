import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { scanDeadRuntimeExports } from './dead-runtime-exports-gate.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

function makeRepo(files) {
  const dir = makeTestTempDir('dead-exports-');
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('flags zero-caller runtime exports and ignores used exports, types, ui registry and re-exports', () => {
  const dir = makeRepo({
    'packages/shared/src/a.ts': [
      'export function deadFn() { return 1; }',
      'export const DEAD_CONST = 2;',
      'export function liveFn() { return 3; }',
      'export function internalLive() { return 4; }',
      'export const usesInternal = internalLive();',
      'export type UnusedType = string;',
      'export interface UnusedIface { x: number }',
    ].join('\n'),
    'packages/shared/src/index.ts': "export { deadFn, liveFn } from './a.js';\n",
    'apps/server/src/consumer.ts':
      "import { liveFn, usesInternal } from '@cairn/shared';\nconsole.log(liveFn(), usesInternal);\n",
    'apps/web/src/components/ui/button.tsx': 'export function uiRegistryExport() {}\n',
  });
  try {
    const result = scanDeadRuntimeExports(dir, []);
    assert.deepEqual(
      result.violations.map((v) => `${v.path}:${v.name}`),
      ['packages/shared/src/a.ts:deadFn', 'packages/shared/src/a.ts:DEAD_CONST'],
    );
    assert.deepEqual(result.stale, []);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('honors valid allowlist entries and rejects stale allowlist entries', () => {
  const dir = makeRepo({
    'apps/server/src/a.ts': [
      'export const keptDead = 1;',
      'export const nowUsed = 2;',
      'console.log(nowUsed);',
    ].join('\n'),
  });
  try {
    const allowlist = [
      { path: 'apps/server/src/a.ts', name: 'keptDead', reason: 'Retained.' },
      { path: 'apps/server/src/a.ts', name: 'nowUsed', reason: 'Was dead before.' },
      { path: 'apps/server/src/gone.ts', name: 'deleted', reason: 'Removed file.' },
    ];
    const result = scanDeadRuntimeExports(dir, allowlist);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(
      result.stale.map((s) => `${s.path}:${s.name}`),
      ['apps/server/src/a.ts:nowUsed', 'apps/server/src/gone.ts:deleted'],
    );
  } finally {
    releaseTestTempDir(dir);
  }
});
