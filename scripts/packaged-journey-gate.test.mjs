import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { analyze } from './packaged-journey-gate.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';
import { cleanupTestTempDirs, makeTestTempDir } from './test-tmpdir.mjs';

const REGISTRY = '.claude/skills/verify-cairn/packaged-journeys.json';
const INITIAL_REGISTRY_COMMIT = '6f5c86d50';
const REAL_MISSES = [
  ['the 11-25 Antigravity re-sign-in', 'bbf7d78bd', 'providers'],
  ['the update button that was dead in remote mode', '67299d5d4', 'server-status'],
];

for (const [name, commit, feature] of REAL_MISSES) {
  test(`${name} (${commit}) is red against the initial registry and names ${feature}`, () => {
    const result = analyze({
      base: `${commit}^`,
      head: commit,
      coverageFrom: INITIAL_REGISTRY_COMMIT,
    });
    assert.deepEqual(result.registryErrors, []);
    assert.deepEqual(result.missing.find((row) => row.id === feature)?.modes, [
      'local-server',
      'remote-server',
    ]);
  });
}

test('HEAD registry remains valid against historical feature commits', () => {
  const result = analyze({ base: '67299d5d4^', head: '67299d5d4', coverageFrom: 'HEAD' });
  assert.deepEqual(result.registryErrors, []);
  assert.deepEqual(result.missing.find((row) => row.id === 'server-status')?.modes, [
    'local-server',
    'remote-server',
  ]);
});

test('a diff outside every feature row is green', () => {
  const commit = 'f9b6c33409949dcaf66ea5cbea5e2e7b4d9a3767';
  assert.deepEqual(analyze({ base: `${commit}^`, head: commit }).missing, []);
});

test('listing a feature on a journey that never drives it is red', () => {
  const directory = makeTestTempDir('cairn-journey-gate-');
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, env: scrubGitEnv({ ...process.env }) });
  try {
    for (const path of [
      REGISTRY,
      '.claude/skills/verify-cairn/feature-map.json',
      'apps/desktop/scripts/journeys',
      '.github/workflows/desktop-mac.yml',
      '.github/workflows/desktop-release.yml',
    ]) {
      cpSync(path, join(directory, path), { recursive: true });
    }
    git('init', '-q');
    const registry = JSON.parse(readFileSync(join(directory, REGISTRY), 'utf8'));
    registry.journeys['new-task'].features.push('providers');
    writeFileSync(join(directory, REGISTRY), JSON.stringify(registry));
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'padded');
    const result = analyze({ base: 'HEAD', head: 'HEAD', cwd: directory });
    assert.equal(result.registryErrors.length, 1);
    assert.match(result.registryErrors[0], /claims providers but .* drives none of its anchors/);
  } finally {
    cleanupTestTempDirs();
  }
});
